#!/usr/bin/env node
/**
 * verify-catalog-photos.mjs — the overnight photo truth pass.
 *
 * (2026-08-14, Tony's green light on the sized problem: 14,437 active ·
 * 2,446 no photo · 11,991 serper-scraped unverified. "make sure it is
 * 100% accurate have it double triple check from different sources.")
 *
 * For every active item with a SCRAPED photo (image_source =
 * 'serper_google_images'), this shows the photo to the vision model
 * beside the product's MLCC identity and runs the TWO-PASS check
 * (skeptic → defender; see src/lib/photo-verify.js). Verdicts land in
 * public.catalog_photo_verifications + a CSV. Nothing changes in the
 * catalog until you run --apply, which clears ONLY confirmed_wrong
 * images (image_url null, image_source='verify_failed') so the app
 * shows the honest placeholder instead of a lie.
 *
 * USAGE (from services/api/ — needs ANTHROPIC_API_KEY + the SUPABASE_*
 * or LK_PROD_* pair in .env; run overnight, it is polite but long):
 *   node scripts/verify-catalog-photos.mjs                # verify all unchecked (resumable)
 *   node scripts/verify-catalog-photos.mjs --limit 50     # small taste first — READ the CSV
 *   node scripts/verify-catalog-photos.mjs --recheck      # re-verify even already-checked codes
 *   node scripts/verify-catalog-photos.mjs --apply        # clear confirmed_wrong images
 *
 * Cost/time guardrails: --concurrency 4 default (Anthropic-polite),
 * images downscaled server-side by fetching the THUMB url when present.
 * Resumable by design: already-verified codes are skipped unless
 * --recheck, so a stopped run continues where it left off.
 * Requires sql/2026-08-14-catalog-photo-verifications.sql applied.
 */
import "dotenv/config";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSkepticPrompt,
  buildDefenderPrompt,
  parseVerdict,
  decideVerdict,
} from "../src/lib/photo-verify.js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or LK_PROD_*) in env");
  process.exit(1);
}
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RECHECK = args.includes("--recheck");
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? Number(args[i + 1]) : dflt;
};
const LIMIT = flag("limit", Infinity);
const CONCURRENCY = flag("concurrency", 4);
const MODEL = process.env.LK_PHOTO_VERIFY_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function applyConfirmedWrong() {
  const { data, error } = await supabase
    .from("catalog_photo_verifications")
    .select("code, verdict, applied_at")
    .eq("verdict", "confirmed_wrong")
    .is("applied_at", null);
  if (error) throw new Error(`apply fetch failed: ${error.message}`);
  const rows = data ?? [];
  console.log(`${rows.length} confirmed_wrong photo(s) to clear`);
  let cleared = 0;
  for (const row of rows) {
    const { error: upErr } = await supabase
      .from("mlcc_items")
      .update({
        image_url: null,
        image_thumb_url: null,
        image_source: "verify_failed",
      })
      .eq("code", row.code)
      .eq("image_source", "serper_google_images"); // never touch in_store/curated
    if (upErr) {
      console.error(`  ${row.code}: clear failed: ${upErr.message}`);
      continue;
    }
    await supabase
      .from("catalog_photo_verifications")
      .update({ applied_at: new Date().toISOString() })
      .eq("code", row.code);
    cleared += 1;
  }
  console.log(`DONE — cleared ${cleared}/${rows.length}. They now show honest placeholders and queue for re-sourcing.`);
}

/*
 * NORMALIZE-TO-1568 (v2.1 — the full-res taste run threw 23/50 errors:
 * 1.5–3MB originals blew past the API's per-image byte cap and leaned
 * on rate limits). Anthropic downscales anything past ~1568px server-
 * side anyway, so pre-shrinking with sharp loses NOTHING the model
 * would see, kills the size errors, and cuts image tokens ~40%. sharp
 * is already a dependency (thumbs script); if it ever fails to load we
 * fall back to raw bytes with a strict cap.
 */
let sharpMod = null;
try {
  sharpMod = (await import("sharp")).default;
} catch {
  console.warn("(sharp unavailable — sending raw images with a strict size cap)");
}

async function fetchImageAsBase64(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const mediaType = ["image/jpeg", "image/png", "image/gif", "image/webp"].find((t) =>
    type.includes(t.split("/")[1]),
  );
  if (!mediaType) throw new Error(`unsupported content-type ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error(`image too large (${buf.length}b)`);

  if (sharpMod) {
    const out = await sharpMod(buf)
      .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mediaType: "image/jpeg", data: out.toString("base64") };
  }
  // No sharp: base64 inflates 4/3, API cap is ~5MB — stay safely under.
  if (buf.length > 3.5 * 1024 * 1024) throw new Error(`image too large without sharp (${buf.length}b)`);
  return { mediaType, data: buf.toString("base64") };
}

async function askVision(anthropic, prompt, img) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function verifyOne(anthropic, item) {
  /*
   * FULL image, never the thumb (v2 law — the taste run proved 360px
   * thumbs make both passes hallucinate label text). Thumb is only a
   * fallback when the full image itself is unfetchable/oversized;
   * verdicts from a thumb can still only land as match/overruled/
   * unsure because the transcription guards catch unstable reads.
   */
  const url = item.image_url || item.image_thumb_url;
  try {
    let img;
    try {
      img = await fetchImageAsBase64(url);
    } catch (e) {
      if (item.image_thumb_url && url !== item.image_thumb_url) {
        img = await fetchImageAsBase64(item.image_thumb_url);
      } else {
        throw e;
      }
    }
    const skepticRaw = await askVision(anthropic, buildSkepticPrompt(item), img);
    const skeptic = parseVerdict(skepticRaw, ["match", "wrong", "unsure"]);
    let defender = null;
    if (skeptic?.verdict === "wrong") {
      const defenderRaw = await askVision(anthropic, buildDefenderPrompt(item), img);
      defender = parseVerdict(defenderRaw, ["defensible", "undeniably_wrong"]);
    }
    const decision = decideVerdict(skeptic, defender, { itemName: item.name });
    return {
      code: item.code,
      verdict: decision.verdict,
      reason: decision.reason,
      image_url_checked: url,
      model: MODEL,
      confidence: skeptic?.confidence ?? null,
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    return {
      code: item.code,
      verdict: "error",
      reason: String(e?.message ?? e).slice(0, 300),
      image_url_checked: url,
      model: MODEL,
      confidence: null,
      checked_at: new Date().toISOString(),
    };
  }
}

async function main() {
  if (APPLY) return applyConfirmedWrong();
  if (!ANTHROPIC_KEY) {
    console.error("Missing ANTHROPIC_API_KEY in env");
    process.exit(1);
  }
  // maxRetries 5: big-image bursts lean on rate limits; the SDK's
  // exponential backoff absorbs 429s instead of surfacing them as
  // error verdicts (v2.1, after the 23/50-error taste run).
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, maxRetries: 5 });

  // Already-checked codes (resume support).
  const done = new Set();
  if (!RECHECK) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("catalog_photo_verifications")
        .select("code, verdict")
        .neq("verdict", "error") // errors retry on the next run
        .range(from, from + 999);
      if (error) throw new Error(`ledger page failed: ${error.message}`);
      for (const r of data ?? []) done.add(r.code);
      if (!data || data.length < 1000) break;
    }
    console.log(`${done.size} codes already verified (resuming past them)`);
  }

  // Scraped-photo items.
  const items = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, bottle_size_ml, bottle_size_label, category, image_url, image_thumb_url")
      .eq("is_active", true)
      .eq("image_source", "serper_google_images")
      .not("image_url", "is", null)
      .order("code", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`catalog page failed: ${error.message}`);
    items.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const queue = items.filter((i) => !done.has(i.code)).slice(0, LIMIT);
  console.log(`${items.length} scraped photos · ${queue.length} to verify this run (model ${MODEL}, x${CONCURRENCY})`);

  const here = dirname(fileURLToPath(import.meta.url));
  const csvPath = join(here, "photo-verify-results.csv");
  writeFileSync(csvPath, "code,verdict,confidence,reason,image\n");

  const tally = {};
  let processed = 0;
  const started = Date.now();
  let cursor = 0;
  async function lane() {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length) return;
      const result = await verifyOne(anthropic, queue[i]);
      tally[result.verdict] = (tally[result.verdict] ?? 0) + 1;
      const { error } = await supabase
        .from("catalog_photo_verifications")
        .upsert(result, { onConflict: "code" });
      if (error) console.error(`  ${result.code}: ledger write failed: ${error.message}`);
      appendFileSync(
        csvPath,
        `${result.code},${result.verdict},${result.confidence ?? ""},"${(result.reason ?? "").replace(/"/g, '""')}",${result.image_url_checked}\n`,
      );
      processed += 1;
      if (processed % 25 === 0) {
        const rate = processed / ((Date.now() - started) / 60000);
        const etaMin = Math.round((queue.length - processed) / Math.max(rate, 0.1));
        console.log(
          `${processed}/${queue.length} · ${JSON.stringify(tally)} · ~${etaMin} min left`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));

  console.log(`\nDONE ${processed} verified → ${JSON.stringify(tally)}`);
  console.log(`CSV: ${csvPath}`);
  console.log(
    `Next: eyeball the confirmed_wrong rows in the CSV, then re-run with --apply to clear them (only confirmed_wrong is ever touched).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
