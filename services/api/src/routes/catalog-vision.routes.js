/**
 * Catalog vision — photo-based bottle identification (task #37, 2026-06-01).
 *
 * When the in-store scanner can't read a barcode (small/curved/plastic
 * labels are the common failure mode — Tony's plastic Captain Morgan
 * shot was the 23-minute case that drove this feature), the user can
 * tap "Take a photo" and we route the frame to Claude vision. Claude
 * extracts brand + product name + size, we fuzzy-match against
 * mlcc_items, and return the top candidates. User picks one → opens
 * ProductCard like a normal scan.
 *
 * Routes:
 *   POST /catalog/identify-from-image
 *     body: { image: "data:image/jpeg;base64,..." }
 *     returns: { ok, candidates: MlccProduct[], extracted: { brand, product_name, size_label, confidence } }
 *
 * Design choices:
 *   - ONE MATCHER LAW (2026-07-26, scanner war phase 2 — Tony's Smirnoff
 *     screenshot: vision correctly read "Smirnoff Vodka" plain and this
 *     route's OWN token ranker recommended SOURS GREEN APPLE anyway,
 *     because plain and flavored Smirnoffs scored identically on brand +
 *     size and a coin flip crowned a flavor). Candidate matching now runs
 *     through resolveOrderLine — the SAME deterministic resolver the AI
 *     chat / paste-order / CLI use, with every law it has learned:
 *     flavor penalty (plain beats flavored for a plain query), flagship
 *     aliases, brand synonyms, proof-line demotion, size honesty. Vision
 *     is only an EXTRACTOR now; it never ranks.
 *   - Top candidates returned — the scanner UI presents them for user
 *     confirmation (never auto-accept; vision is a fallback, not a
 *     substitute for the barcode's certainty).
 *   - Returns extracted fields even when no candidates match, so the
 *     UI can show "Couldn't find this in MLCC — try a clearer photo"
 *     and the user knows what the model saw.
 *   - Image format: accepts a data URI OR raw base64. Defaults media
 *     type to image/jpeg when not in the data URI.
 *
 * Cost: Claude vision costs ~3-5× a text-only call but only fires when
 * a barcode literally couldn't be read — small fraction of total scans.
 * Acceptable.
 *
 * NOTE: this route requires authentication (resolveAuthenticatedStore)
 * because it costs us money per call. Mounted under /catalog so the
 * existing store-resolution middleware applies.
 */

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import supabaseDefault from "../config/supabase.js";
import { resolveOrderLine } from "../lib/resolve-order-lines.js";
import { fetchOrderedCodeSet } from "../lib/order-history-for-codes.js";

const router = express.Router();

const VISION_MODEL =
  process.env.ANTHROPIC_VISION_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-6";

const MAX_TOKENS = 512;

const SYSTEM_PROMPT = `You identify liquor bottles from photos. The user is in a Michigan liquor store and the bottle's barcode failed to scan.

Look at the image and identify:
- brand: the brand name (e.g. "Tito's", "Captain Morgan", "Jack Daniel's")
- product_name: the specific variant if visible (e.g. "Handmade Vodka", "Original Spiced Rum", "Old No. 7 Black Label"). If you can only read the brand, leave this empty.
- size_label: the bottle's size. Read it from the label if it's printed (e.g. "750ml", "50ml", "1.75L", "1L", "375ml"). If the printed size isn't legible but the bottle's proportions make the size obvious, give your best estimate as the nearest standard size. Michigan liquor sizes are 50ml, 100ml, 200ml, 375ml, 750ml, 1L, and 1.75L — always pick the closest one of these. Only leave it empty if you genuinely cannot tell the size at all.
- confidence: your confidence in the identification — "high" (the brand and product are clearly visible and unambiguous), "medium" (you're reasonably sure but the label is partially obscured or the photo is unclear), or "low" (you're guessing).

If the image does NOT show a liquor bottle (e.g. blank, blurry, something else entirely), set brand and product_name to empty strings and confidence to "low".

Respond ONLY with a JSON object in this exact format. No prose, no markdown, no code fence — just the JSON:

{"brand":"...","product_name":"...","size_label":"...","confidence":"high|medium|low"}`;

/**
 * Parse a base64 image input. Accepts either a data URI ("data:image/jpeg;base64,...")
 * or raw base64. Returns { mediaType, data } or null if invalid.
 */
function parseImageInput(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // Strip data URI prefix if present.
  const dataUriMatch = raw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i);
  if (dataUriMatch) {
    return { mediaType: dataUriMatch[1].toLowerCase(), data: dataUriMatch[2].trim() };
  }
  // Plain base64 — default to image/jpeg (camera capture).
  // Basic sanity: must be base64-ish (no whitespace surprises).
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length < 64) return null; // suspiciously small to be a real image
  return { mediaType: "image/jpeg", data: cleaned };
}

/**
 * Extract a JSON object from the model's response. Defensive: handles
 * accidental code fences, leading prose, trailing whitespace.
 */
function extractJsonFromModelOutput(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  // Try direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  // Strip code fences if the model wrapped despite the system prompt.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // ignore
    }
  }
  // Last resort: find the first { ... } substring.
  const braceMatch = trimmed.match(/\{[\s\S]+\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Normalize extracted fields. Coerce missing values to empty strings,
 * trim whitespace, clamp confidence to known levels.
 */
function normalizeExtracted(raw) {
  const brand = typeof raw?.brand === "string" ? raw.brand.trim() : "";
  const productName =
    typeof raw?.product_name === "string" ? raw.product_name.trim() : "";
  const sizeLabel =
    typeof raw?.size_label === "string" ? raw.size_label.trim() : "";
  const confidenceRaw =
    typeof raw?.confidence === "string" ? raw.confidence.toLowerCase().trim() : "";
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? confidenceRaw
      : "low";
  return {
    brand,
    product_name: productName,
    size_label: sizeLabel,
    // Normalized + snapped millilitres (null when unreadable). Lets the
    // catalog filter and the client picker rank by a real size, not a string.
    size_ml: parseSizeToMl(sizeLabel),
    confidence,
  };
}

// The only bottle sizes MLCC sells. Vision size estimates get snapped to the
// nearest of these so the catalog size filter actually matches a real SKU.
const STANDARD_MLCC_SIZES_ML = [50, 100, 200, 375, 750, 1000, 1750];

function snapToStandardSize(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const s of STANDARD_MLCC_SIZES_ML) {
    const diff = Math.abs(s - ml);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  // Snap only when we're within 15% of a standard size (e.g. 700→750,
  // 1800→1750). Otherwise keep the rounded value rather than inventing one.
  if (best != null && bestDiff <= best * 0.15) return best;
  return Math.round(ml);
}

/**
 * Parse a vision-extracted size label into a millilitre integer, tolerant of
 * the many ways a size shows up: "750ml", "1.75 L", "1L", "37.5cl", bare
 * "1.75", and the US trade words (fifth / pint / half pint / handle). The
 * result is snapped to the nearest standard MLCC size so it lines up with the
 * catalog. Returns null when no size is parseable.
 */
function parseSizeToMl(sizeRaw) {
  if (!sizeRaw || typeof sizeRaw !== "string") return null;
  const s = sizeRaw.toLowerCase().trim();
  if (!s) return null;

  // Trade words first (these are unambiguous on US liquor).
  if (/half[\s-]*pint/.test(s)) return 200;
  if (/\bpint\b/.test(s)) return 375;
  if (/\bfifth\b/.test(s)) return 750;
  if (/\bhandle\b/.test(s)) return 1750;
  if (/\bmagnum\b/.test(s)) return 1750;

  // Number + unit.
  let m = s.match(/(\d+(?:\.\d+)?)\s*(ml|cl|litre|liter|l)\b/);
  if (m) {
    let val = Number(m[1]);
    const unit = m[2];
    if (unit === "l" || unit === "liter" || unit === "litre") val *= 1000;
    else if (unit === "cl") val *= 10;
    return snapToStandardSize(val);
  }

  // Bare number — infer by magnitude (≤3 means liters: "1.75" → 1750).
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    let val = Number(m[1]);
    if (val > 0 && val <= 3) val *= 1000;
    return snapToStandardSize(val);
  }
  return null;
}

/**
 * Build a resolver order-line from what vision extracted (ONE MATCHER
 * LAW, 2026-07-26). The photo becomes exactly what a typed order line
 * would be — "Smirnoff Vodka" at 50ml — and resolveOrderLine applies
 * every matching law the resolver knows. rawText carries the size label
 * so proof-number waivers read what the human would have written.
 */
export function visionLineFromExtracted(extracted) {
  const name = [extracted?.brand, extracted?.product_name]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    name,
    sizeMl: extracted?.size_ml ?? null,
    qty: 1,
    rawText: [name, String(extracted?.size_label ?? "").trim()]
      .filter(Boolean)
      .join(" "),
  };
}

router.post("/identify-from-image", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "ANTHROPIC_API_KEY not configured on the server",
    });
  }

  const image = parseImageInput(req.body?.image);
  if (!image) {
    return res.status(400).json({
      ok: false,
      error:
        "image is required as a base64 string or a data:image/...;base64,... URI",
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let modelResponse;
  try {
    modelResponse = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.data,
              },
            },
            {
              type: "text",
              text: "Identify this bottle.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[catalog-vision] Anthropic call failed: ${message}`);
    return res.status(502).json({
      ok: false,
      error: `Vision API call failed: ${message}`,
    });
  }

  // Concatenate any text blocks in the response into one string.
  const responseText = Array.isArray(modelResponse?.content)
    ? modelResponse.content
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("")
    : "";

  const parsed = extractJsonFromModelOutput(responseText);
  if (!parsed) {
    return res.status(502).json({
      ok: false,
      error: "Vision model returned a non-JSON response",
      raw: responseText.slice(0, 500),
    });
  }

  const extracted = normalizeExtracted(parsed);

  let candidates = [];
  let resolve = null;
  // Only search the catalog when we have at least a brand. Empty brand
  // means the model couldn't identify anything — surface that to the
  // user instead of returning random catalog rows.
  if (extracted.brand && extracted.brand.length > 0) {
    // ONE MATCHER LAW: the photo becomes an order line; the resolver ranks.
    // Ordered-before tie-breaker rides along (2026-08-12) — a photographed
    // bare brand resolves to the bottle THIS store actually buys.
    const orderedCodes = await fetchOrderedCodeSet(supabaseDefault, req.store_id ?? null);
    const resolved = await resolveOrderLine(
      supabaseDefault,
      visionLineFromExtracted(extracted),
      { orderedCodes },
    );
    candidates = [resolved.best, ...(resolved.alternates || [])].filter(Boolean);
    resolve = {
      confidence: resolved.confidence,
      sizeMismatch: resolved.sizeMismatch === true,
      leadMissing: resolved.leadMissing === true,
    };
  }

  // Used to track cost per call in observability later — for now just
  // a console log so Fly logs show us what's happening.
  console.log(
    `[catalog-vision] identified brand="${extracted.brand}" name="${extracted.product_name}" size="${extracted.size_label}" conf=${extracted.confidence} → ${candidates.length} candidates (resolver=${resolve?.confidence ?? "n/a"})`,
  );

  return res.json({
    ok: true,
    extracted,
    candidates,
    /*
      Resolver verdict (2026-07-26): how sure the ONE matcher is about
      candidates[0], plus the honesty flags. The picker can surface these;
      today they also make Fly logs diagnosable.
    */
    resolve,
    /*
      Stable hint for the UI when nothing matched but the model DID see
      something. Helps the user understand whether to retake the photo
      (model saw nothing useful) or type the code (model saw something
      but it's not in our catalog).
    */
    hint:
      extracted.brand === ""
        ? "Couldn't identify a bottle in the photo. Try better lighting and a clear shot of the label."
        : candidates.length === 0
          ? `Saw "${extracted.brand}${extracted.product_name ? " " + extracted.product_name : ""}" but couldn't find it in the MLCC catalog. Try typing the MLCC code from the bottle.`
          : null,
  });
});

export default router;

// Test helpers exported for unit tests.
export { extractJsonFromModelOutput, normalizeExtracted, parseImageInput };
