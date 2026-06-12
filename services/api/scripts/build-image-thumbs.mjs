#!/usr/bin/env node
/**
 * build-image-thumbs.mjs — retrofit grid thumbnails (and optionally cap
 * oversized fulls) for every catalog photo already in Storage.
 *
 * WHY (quality mandate, 2026-06-12): the serper backfill uploaded ORIGINAL
 * retailer images — frequently 1-3 MB, 1500-3000px. The Browse grid decoded
 * those down to ~150px tiles, dozens at a time, on a phone. That's the
 * overheating/lagging-taps class from the 2026-06-10 real-order failure.
 *
 * WHAT IT DOES (default mode — thumbs):
 *   For every mlcc_items row with image_url set and image_thumb_url NULL:
 *     download original → sharp → 360px-wide WebP q72 (~10-25 KB)
 *     → upload to  thumbs/{code}.webp  (same bucket, upsert)
 *     → set image_thumb_url on every row with that code.
 *   Purely additive: originals untouched, image_url untouched.
 *
 * OPTIONAL MODE (--cap-full):
 *   For rows whose ORIGINAL is oversized (>1600px wide or >400 KB):
 *     re-encode max-1600px WebP q82 → upload to  full/{code}.webp
 *     → point image_url at the capped copy. Original object stays in
 *     Storage untouched (recoverable). Fixes the 2-4s detail-view load.
 *
 * USAGE (Tony's Mac, services/api — needs `npm i` once for sharp):
 *   node scripts/build-image-thumbs.mjs                  # thumbs, all missing
 *   node scripts/build-image-thumbs.mjs --limit=50       # spot-check batch
 *   node scripts/build-image-thumbs.mjs --dry-run        # report only
 *   node scripts/build-image-thumbs.mjs --cap-full       # also cap oversized fulls
 *   node scripts/build-image-thumbs.mjs --code=100009    # single SKU
 *
 * ENV: LK_PROD_SUPABASE_URL, LK_PROD_SUPABASE_SERVICE_ROLE_KEY (prod target;
 * falls back to SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for local).
 *
 * Integrity doctrine: loud failures (every skip logged with its reason,
 * non-zero exit on any hard failure), idempotent (re-run safe — fills only
 * NULL thumbs; upserts are keyed by code), recoverable (originals never
 * deleted), observable (per-code log lines + end summary).
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[thumbs] Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallbacks).",
  );
  process.exit(1);
}

const STORAGE_BUCKET = "bottle-images";
const THUMB_WIDTH = 360;
const THUMB_QUALITY = 72;
const FULL_MAX_WIDTH = 1600;
const FULL_QUALITY = 82;
const FULL_OVERSIZE_BYTES = 400 * 1024;
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};

const DRY_RUN = flag("dry-run");
const CAP_FULL = flag("cap-full");
const SINGLE_CODE = opt("code");
const LIMIT = Number(opt("limit") ?? "100000");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function fetchRowsNeedingThumbs() {
  const byCode = new Map();
  const PAGE = 1000;
  for (let from = 0; byCode.size < LIMIT; from += PAGE) {
    let q = supabase
      .from("mlcc_items")
      .select("code, image_url, image_thumb_url, image_source")
      .not("image_url", "is", null)
      .order("scan_count", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (!CAP_FULL) q = q.is("image_thumb_url", null);
    if (SINGLE_CODE) q = q.eq("code", SINGLE_CODE);
    const { data, error } = await q;
    if (error) throw new Error(`fetch rows failed: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
      if (byCode.size >= LIMIT) break;
    }
    if (data.length < PAGE) break;
  }
  return [...byCode.values()];
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return { ok: false, reason: `not an image (${contentType})` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { ok: false, reason: "empty body" };
  return { ok: true, buf };
}

async function upload(path, buf) {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType: "image/webp", upsert: true });
  if (error) return { ok: false, reason: `upload failed: ${error.message}` };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, reason: "no public url" };
  return { ok: true, publicUrl: data.publicUrl };
}

async function setColumns(code, cols) {
  const { error } = await supabase
    .from("mlcc_items")
    .update(cols)
    .eq("code", code);
  if (error) return { ok: false, reason: `db update failed: ${error.message}` };
  return { ok: true };
}

const stats = { thumbed: 0, capped: 0, skipped: 0, failed: 0 };

async function processCode(row) {
  const { code, image_url: imageUrl, image_thumb_url: existingThumb } = row;
  const tag = `[thumbs] ${code}`;

  const dl = await download(imageUrl);
  if (!dl.ok) {
    stats.failed += 1;
    console.warn(`${tag} SKIP — download: ${dl.reason} (${imageUrl})`);
    return;
  }

  let meta;
  try {
    meta = await sharp(dl.buf).metadata();
  } catch (e) {
    stats.failed += 1;
    console.warn(`${tag} SKIP — unreadable image: ${e.message}`);
    return;
  }

  const updates = {};

  // --- thumb (default mode; also runs under --cap-full for missing thumbs)
  if (!existingThumb) {
    const thumbBuf = await sharp(dl.buf)
      .rotate() // honor EXIF orientation
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    if (DRY_RUN) {
      console.log(
        `${tag} would thumb: ${meta.width}x${meta.height} ${Math.round(dl.buf.length / 1024)}KB → ${Math.round(thumbBuf.length / 1024)}KB`,
      );
    } else {
      const up = await upload(`thumbs/${code}.webp`, thumbBuf);
      if (!up.ok) {
        stats.failed += 1;
        console.warn(`${tag} FAIL — thumb ${up.reason}`);
        return;
      }
      updates.image_thumb_url = up.publicUrl;
    }
    stats.thumbed += 1;
  }

  // --- capped full (opt-in)
  if (CAP_FULL && (meta.width > FULL_MAX_WIDTH || dl.buf.length > FULL_OVERSIZE_BYTES)) {
    const fullBuf = await sharp(dl.buf)
      .rotate()
      .resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toBuffer();
    if (DRY_RUN) {
      console.log(
        `${tag} would cap full: ${Math.round(dl.buf.length / 1024)}KB → ${Math.round(fullBuf.length / 1024)}KB`,
      );
    } else {
      const up = await upload(`full/${code}.webp`, fullBuf);
      if (!up.ok) {
        stats.failed += 1;
        console.warn(`${tag} FAIL — capped full ${up.reason}`);
        return;
      }
      updates.image_url = up.publicUrl;
      updates.image_updated_at = new Date().toISOString();
    }
    stats.capped += 1;
  }

  if (!DRY_RUN && Object.keys(updates).length > 0) {
    const set = await setColumns(code, updates);
    if (!set.ok) {
      stats.failed += 1;
      console.warn(`${tag} FAIL — ${set.reason}`);
      return;
    }
  }

  if (Object.keys(updates).length === 0 && !DRY_RUN) {
    stats.skipped += 1;
  }
}

async function main() {
  console.log(
    `[thumbs] target=${SUPABASE_URL.includes("eamoozfhqolshdztbrez") ? "PROD" : SUPABASE_URL} mode=${CAP_FULL ? "thumbs+cap-full" : "thumbs"}${DRY_RUN ? " DRY-RUN" : ""}`,
  );
  const rows = await fetchRowsNeedingThumbs();
  console.log(`[thumbs] ${rows.length} codes to process`);

  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      try {
        await processCode(row);
      } catch (e) {
        stats.failed += 1;
        console.warn(`[thumbs] ${row.code} FAIL — unexpected: ${e.message}`);
      }
      const done = stats.thumbed + stats.capped + stats.skipped + stats.failed;
      if (done % 100 === 0) {
        console.log(
          `[thumbs] progress: ${done} done (thumbed=${stats.thumbed} capped=${stats.capped} skipped=${stats.skipped} failed=${stats.failed})`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(
    `[thumbs] DONE — thumbed=${stats.thumbed} capped=${stats.capped} skipped=${stats.skipped} failed=${stats.failed}`,
  );
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`[thumbs] FATAL: ${e.message}`);
  process.exit(1);
});
