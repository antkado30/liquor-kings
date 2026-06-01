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
 *   - Trigram fuzzy match (mlcc_items has a trigram index already) so a
 *     model output like "Captain Morgan Spiced Rum" finds "CAPT MORGAN
 *     ORIGNAL SPICED RUM" in the catalog without exact-match brittleness.
 *   - We score candidates by combining the model's confidence with the
 *     trigram similarity. Top 5 returned — the scanner UI presents them
 *     for user confirmation (never auto-accept; vision is a fallback,
 *     not a substitute for the barcode's certainty).
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

const router = express.Router();

const VISION_MODEL =
  process.env.ANTHROPIC_VISION_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-6";

const MAX_TOKENS = 512;
const MAX_CANDIDATES_RETURNED = 5;
// Trigram similarity threshold: PG pg_trgm default is 0.3. We use a
// slightly lower bar so "tito's vodka" matches "TITOS HANDMADE VODKA"
// despite the abbreviation. The model output's brand+name is short
// and clean, so noise from low-similarity matches is minimal.
const TRIGRAM_THRESHOLD = 0.2;

const SYSTEM_PROMPT = `You identify liquor bottles from photos. The user is in a Michigan liquor store and the bottle's barcode failed to scan.

Look at the image and identify:
- brand: the brand name (e.g. "Tito's", "Captain Morgan", "Jack Daniel's")
- product_name: the specific variant if visible (e.g. "Handmade Vodka", "Original Spiced Rum", "Old No. 7 Black Label"). If you can only read the brand, leave this empty.
- size_label: the bottle size if visible on the label (e.g. "750ml", "50ml", "1.75L", "1L", "375ml"). If not visible, leave this empty.
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
  return { brand, product_name: productName, size_label: sizeLabel, confidence };
}

/**
 * Search mlcc_items for vision-extracted brand + product name (task
 * #62 fix, 2026-06-01). The previous implementation required ALL
 * tokens to match via ilike AND'd — that broke immediately on the
 * MLCC catalog's abbreviations: vision says "Captain Morgan" but the
 * catalog row reads "CAPT MORGAN ORIG SPICED RUM", so requiring
 * "Captain" as a substring kills every candidate.
 *
 * New approach: brand-prefix search + JS ranking.
 *   1. Brand prefix: take the first 4 chars of the brand token (e.g.
 *      "Captain" → "capt"), search for rows where name ilike %capt%
 *      OR ilike %<first 4 of product_name token 1>%. Catches both
 *      "CAPTAIN" and "CAPT MORGAN" without hand-coded abbreviation
 *      tables.
 *   2. Pull a generous candidate pool (50-100 rows).
 *   3. Rank in JS: count how many of the original tokens (full + 4-
 *      char prefix) appear as substrings in each row's name. Award
 *      bonus points for name prefix-matching the brand and for size
 *      matching the extracted size_label.
 *   4. Return top MAX_CANDIDATES_RETURNED.
 *
 * This is robust to abbreviations (CAPT/Captain, ORIG/Original) and
 * to word-order variation in MLCC names. Trigram index still
 * accelerates the underlying ilike. When we need more accuracy we can
 * promote to a proper trgm_similarity RPC, but this fixes the
 * immediate bug.
 */
function tokenize(raw) {
  return String(raw ?? "")
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ""))
    .filter((t) => t.length >= 2);
}

function shortenForAbbrevMatch(token) {
  // 4-char prefix catches the common MLCC abbreviations:
  //   Captain → CAPT, Original → ORIG, Tennessee → TENN, Whiskey → WHSK.
  // For tokens already < 4 chars, return as-is.
  return token.length <= 4 ? token : token.slice(0, 4);
}

async function searchCatalog(supabase, extracted) {
  const brandTokens = tokenize(extracted.brand);
  const productTokens = tokenize(extracted.product_name);
  if (brandTokens.length === 0 && productTokens.length === 0) {
    return [];
  }

  // The PRIMARY anchor is the brand's first token — it's the strongest
  // signal we have. Search using its 4-char prefix as an ilike pattern.
  // If no brand, fall back to first product token.
  const primaryToken = brandTokens[0] ?? productTokens[0];
  if (!primaryToken) return [];
  const primaryPrefix = shortenForAbbrevMatch(primaryToken).toLowerCase();

  let q = supabase
    .from("mlcc_items")
    .select("*")
    .eq("is_active", true)
    .ilike("name", `%${primaryPrefix}%`);

  // Size filter if extracted. Allow some slop on the label format.
  const sizeRaw = extracted.size_label;
  let sizeMlNumeric = null;
  if (sizeRaw && sizeRaw.length > 0) {
    const sizeMatch = sizeRaw.match(/(\d+(?:\.\d+)?)\s*(ml|l)/i);
    if (sizeMatch) {
      let sizeMl = Number(sizeMatch[1]);
      if (sizeMatch[2].toLowerCase() === "l") sizeMl = sizeMl * 1000;
      if (Number.isFinite(sizeMl) && sizeMl > 0) {
        sizeMlNumeric = Math.round(sizeMl);
        q = q.eq("bottle_size_ml", sizeMlNumeric);
      }
    }
  }

  // Generous pool so the JS ranker has options. 100 rows is fast even
  // without further filtering (trigram index handles the ilike).
  q = q.limit(100);

  let { data, error } = await q;
  if (error) {
    console.warn(`[catalog-vision] catalog search failed: ${error.message}`);
    return [];
  }
  if (!Array.isArray(data)) data = [];

  // If size filter killed all rows AND we had a size, retry WITHOUT
  // the size filter — the vision may have read "750ml" but the
  // catalog SKU is 1000ml and we'd rather show a near-match than
  // nothing.
  if (data.length === 0 && sizeMlNumeric != null) {
    const retry = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("is_active", true)
      .ilike("name", `%${primaryPrefix}%`)
      .limit(100);
    if (!retry.error && Array.isArray(retry.data)) data = retry.data;
  }

  if (data.length === 0) return [];

  /*
    JS ranking — count how many tokens (full + 4-char prefix) appear in
    each row's name. Bonus for name starting with the brand prefix
    (catches "CAPT MORGAN..." being ranked above any other "...capt..."
    coincidence) and for size match when known.
  */
  const allTokens = [...brandTokens, ...productTokens];
  const allTokensLc = allTokens.map((t) => t.toLowerCase());
  const allPrefixesLc = allTokens.map((t) => shortenForAbbrevMatch(t).toLowerCase());

  const ranked = data
    .map((row) => {
      const name = String(row.name ?? "").toLowerCase();
      let hits = 0;
      for (let i = 0; i < allTokens.length; i++) {
        // Count once per token — credit either the full or prefix match.
        if (name.includes(allTokensLc[i]) || name.includes(allPrefixesLc[i])) {
          hits += 1;
        }
      }
      const startsWithBrand = name.startsWith(primaryPrefix) ? 5 : 0;
      const sizeMatches =
        sizeMlNumeric != null && Number(row.bottle_size_ml) === sizeMlNumeric
          ? 3
          : 0;
      const score = hits * 10 + startsWithBrand + sizeMatches;
      return { row, score };
    })
    // Drop rows that match NOTHING beyond the broad brand-prefix pull.
    // A row where only the primary prefix coincidentally appears (e.g.
    // "CAPRI SUN") would score 0 hits + bonuses; not useful.
    .filter((entry) => entry.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES_RETURNED)
    .map((entry) => entry.row);

  return ranked;
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
  // Only search the catalog when we have at least a brand. Empty brand
  // means the model couldn't identify anything — surface that to the
  // user instead of returning random catalog rows.
  if (extracted.brand && extracted.brand.length > 0) {
    candidates = await searchCatalog(supabaseDefault, extracted);
  }

  // Used to track cost per call in observability later — for now just
  // a console log so Fly logs show us what's happening.
  console.log(
    `[catalog-vision] identified brand="${extracted.brand}" name="${extracted.product_name}" size="${extracted.size_label}" conf=${extracted.confidence} → ${candidates.length} candidates`,
  );

  return res.json({
    ok: true,
    extracted,
    candidates,
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
