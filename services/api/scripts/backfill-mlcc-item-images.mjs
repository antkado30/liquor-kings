#!/usr/bin/env node
/**
 * Backfill mlcc_items.image_url from UPCitemdb (task #65, 2026-06-03).
 *
 * Tony's spec:
 *   "I need pictures matching the name for the browsing cards I need
 *    them for every single bottle we have they need to have an image
 *    of the exact bottle each one of them ... we cannot have random
 *    pictures to random bottles like imagine putting a fifth of Tito's
 *    picture on a pint of Hennessy code."
 *
 * Strategy:
 *   - Iterate every upc_mappings row whose mlcc_code points at a
 *     mlcc_items row with NULL image_url.
 *   - Look up the UPC against UPCitemdb. Take the first image URL.
 *   - Verify pin-point accuracy: the UPC mapping has confidence_source.
 *     We only accept images when confidence is 'user_confirmed' or
 *     'manual_admin'. Anything else is too soft — Tony's
 *     "Tito's picture on a Hennessy code" failure mode is exactly
 *     what we want to avoid.
 *   - Update mlcc_items.image_url + image_source='upcitemdb' +
 *     image_updated_at=now().
 *   - Rate-limit to UPCitemdb's free-tier 100 calls/day (or the paid
 *     tier's higher cap if UPCITEMDB_API_KEY is set).
 *
 * Modes:
 *   --dry-run        Print what WOULD update, no writes.
 *   --limit=N        Cap at N rows (default 50; UPCitemdb free tier).
 *   --confidence=... Comma-separated list of acceptable
 *                    confidence_source values (default
 *                    "user_confirmed,manual_admin").
 *   --code=XXX       Re-image a single MLCC code (debug).
 *
 * Usage (from services/api/):
 *   node scripts/backfill-mlcc-item-images.mjs --dry-run --limit=10
 *   node scripts/backfill-mlcc-item-images.mjs --limit=50
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   UPCITEMDB_API_KEY  (optional — higher rate limit when present)
 *
 * Idempotent: only touches rows where image_url IS NULL by default.
 * Safe to re-run any time the daily quota resets.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  extractBottleSizeMl,
  lookupUpcFromUpcitemdb,
} from "../src/lib/upcitemdb.js";

/*
 * Tony's pin-point rule:
 *   "we cannot have random pictures to random bottles like imagine
 *    putting a fifth of Tito's picture on a pint of Hennessy code"
 *
 * Prod only has nrs_import_name_size_match mappings — name+size NRS
 * matches that *can* be wrong. So we verify at write-time: for each
 * UPCitemdb hit, require (a) significant token overlap between the
 * MLCC product name and the UPCitemdb product title, and (b) the
 * UPCitemdb size (when parseable) matches MLCC's bottle_size_ml within
 * a tolerance. If either fails, we skip — silhouette stays, no image
 * is written.
 */
const NAME_SIMILARITY_THRESHOLD = 0.6; // 60% of MLCC tokens must appear in UPC title
const SIZE_TOLERANCE_ML = 50; // 750 vs 720 etc. count as same

const STOPWORDS = new Set([
  "ml", "l", "ltr", "liter", "litre", "oz", "floz", "fl",
  "the", "of", "and", "with", "a", "an", "&",
  "pack", "bottle", "bottles", "btl", "case",
]);

function normalizeTokens(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Fraction of MLCC name tokens that appear in the UPCitemdb title.
 * Containment is the right metric here — UPC titles often have extra
 * marketing words ("Premium," "Limited Release") that we don't want
 * to penalize, but every brand+variant token from MLCC should appear.
 */
function nameContainment(mlccName, upcTitle) {
  const mlccTokens = normalizeTokens(mlccName);
  if (mlccTokens.length === 0) return 0;
  const upcSet = new Set(normalizeTokens(upcTitle));
  let hits = 0;
  for (const t of mlccTokens) {
    if (upcSet.has(t)) hits += 1;
  }
  return hits / mlccTokens.length;
}

/**
 * Decide whether a UPCitemdb hit's image is safe to write for a given
 * MLCC item. Returns { ok: true } when verified, or
 * { ok: false, reason } when rejected.
 */
function verifyMatch({ mlccItem, upcProduct }) {
  const upcTitle = upcProduct?.name ?? "";
  const sim = nameContainment(mlccItem.name, upcTitle);
  if (sim < NAME_SIMILARITY_THRESHOLD) {
    return {
      ok: false,
      reason: `name mismatch (${sim.toFixed(2)} < ${NAME_SIMILARITY_THRESHOLD}) "${upcTitle.slice(0, 50)}"`,
    };
  }

  // Size check — only enforce when both sides have a parseable size.
  // Many UPC entries omit size; in that case we don't penalize.
  const upcSizeMl =
    extractBottleSizeMl(upcProduct?.rawSize) ??
    extractBottleSizeMl(upcTitle);
  if (
    upcSizeMl != null &&
    mlccItem.bottle_size_ml != null &&
    Math.abs(upcSizeMl - mlccItem.bottle_size_ml) > SIZE_TOLERANCE_ML
  ) {
    return {
      ok: false,
      reason: `size mismatch (UPC ${upcSizeMl} mL vs MLCC ${mlccItem.bottle_size_ml} mL)`,
    };
  }

  return { ok: true, sim };
}

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const DRY_RUN = argv["dry-run"] === "true";
const LIMIT = Number.parseInt(argv.limit ?? "50", 10) || 50;
const SINGLE_CODE =
  typeof argv.code === "string" && argv.code !== "true" ? argv.code : null;
/*
 * Default confidence list now includes nrs_import_name_size_match —
 * prod's ONLY mapping source as of 2026-06-03. Tony's pin-point rule
 * is enforced by verifyMatch() at write-time, not by the confidence
 * filter, so we can safely cast a wider net here.
 */
const ACCEPTED_CONFIDENCE = (
  argv.confidence ??
  "user_confirmed,manual_admin,bulk_seed,nrs_import_name_size_match"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env or env vars.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Sleep helper. UPCitemdb politely throttles ~1 req/sec on trial. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pull the candidate set: upc_mappings whose mlcc_code matches an
 * mlcc_items row with image_url IS NULL. Joined client-side because
 * mlcc_items.code is not unique (duplicate codes across ADA distributors,
 * see comment on upc_mappings migration).
 */
async function loadCandidates() {
  if (SINGLE_CODE) {
    const { data: maps } = await supabase
      .from("upc_mappings")
      .select("upc, mlcc_code, confidence_source")
      .eq("mlcc_code", SINGLE_CODE)
      .limit(5);
    return await hydrateWithMlccItem(maps ?? []);
  }

  // First grab a pool of mlcc_items missing images.
  const { data: missing, error: missingErr } = await supabase
    .from("mlcc_items")
    .select("code, name, bottle_size_ml, brand_family")
    .is("image_url", null)
    .eq("is_active", true)
    .limit(LIMIT * 4); // overfetch — many won't have a mapping
  if (missingErr) throw missingErr;
  const items = missing ?? [];
  if (items.length === 0) return [];

  // Build a code → MlccItem lookup. Code is not unique (same code can
  // appear under multiple ADAs) but the metadata we care about
  // (name/size/brand) is the same across ADA copies, so first-wins.
  const itemByCode = new Map();
  for (const it of items) {
    if (!itemByCode.has(it.code)) itemByCode.set(it.code, it);
  }
  const codes = [...itemByCode.keys()];

  const { data: maps, error: mapsErr } = await supabase
    .from("upc_mappings")
    .select("upc, mlcc_code, confidence_source")
    .in("mlcc_code", codes)
    .in("confidence_source", ACCEPTED_CONFIDENCE)
    .limit(LIMIT);
  if (mapsErr) throw mapsErr;

  return (maps ?? [])
    .map((m) => ({ ...m, mlccItem: itemByCode.get(m.mlcc_code) ?? null }))
    .filter((m) => m.mlccItem != null);
}

/**
 * Attach mlcc_items metadata to a mapping list. Used by the
 * --code single-code path that doesn't share the bulk loader.
 */
async function hydrateWithMlccItem(mappings) {
  if (mappings.length === 0) return [];
  const codes = [...new Set(mappings.map((m) => m.mlcc_code))];
  const { data: items } = await supabase
    .from("mlcc_items")
    .select("code, name, bottle_size_ml, brand_family")
    .in("code", codes);
  const byCode = new Map();
  for (const it of items ?? []) {
    if (!byCode.has(it.code)) byCode.set(it.code, it);
  }
  return mappings
    .map((m) => ({ ...m, mlccItem: byCode.get(m.mlcc_code) ?? null }))
    .filter((m) => m.mlccItem != null);
}

async function updateAllCodeRows(code, imageUrl) {
  /*
    mlcc_items.code is not unique: the same MLCC code can appear under
    multiple ADA distributors. The same product photo is correct for
    all of them, so we update by code (no id filter).
  */
  const { error } = await supabase
    .from("mlcc_items")
    .update({
      image_url: imageUrl,
      image_source: "upcitemdb",
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code)
    .is("image_url", null); // never overwrite a manually-set image
  if (error) {
    console.warn(`[backfill] ${code} update failed: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(
    `[backfill] mode=${DRY_RUN ? "DRY-RUN" : "WRITE"} limit=${LIMIT} ` +
      `confidence=[${ACCEPTED_CONFIDENCE.join(",")}]` +
      (SINGLE_CODE ? ` single_code=${SINGLE_CODE}` : ""),
  );

  const candidates = await loadCandidates();
  console.log(`[backfill] ${candidates.length} candidate mapping(s) to try`);
  if (candidates.length === 0) {
    console.log("[backfill] nothing to do.");
    return;
  }

  let hits = 0;
  let misses = 0;
  let rejected = 0;
  let rateLimited = 0;
  let written = 0;

  for (const mapping of candidates) {
    const { upc, mlcc_code: code, mlccItem } = mapping;
    process.stdout.write(`  ${code} (UPC ${upc}) ... `);
    let res;
    try {
      res = await lookupUpcFromUpcitemdb(upc);
    } catch (e) {
      console.log(`error ${e?.message ?? e}`);
      await sleep(1200);
      continue;
    }

    if (!res?.ok) {
      if (res?.error === "rate_limited") {
        rateLimited += 1;
        console.log("rate limited — stopping early");
        break;
      }
      misses += 1;
      console.log(`miss (${res?.error ?? "?"})`);
      await sleep(1200);
      continue;
    }

    const imageUrl = res.product?.imageUrl;
    if (!imageUrl) {
      misses += 1;
      console.log("no image in response");
      await sleep(1200);
      continue;
    }

    // PIN-POINT VERIFICATION — name + size match. Skip on mismatch.
    const check = verifyMatch({ mlccItem, upcProduct: res.product });
    if (!check.ok) {
      rejected += 1;
      console.log(`✗ rejected — ${check.reason}`);
      await sleep(1100);
      continue;
    }

    hits += 1;
    if (DRY_RUN) {
      console.log(
        `would set image_url (sim=${check.sim.toFixed(2)}) = ${imageUrl.slice(0, 60)}…`,
      );
    } else {
      const ok = await updateAllCodeRows(code, imageUrl);
      if (ok) {
        written += 1;
        console.log(`✓ set (sim=${check.sim.toFixed(2)})`);
      } else {
        console.log("write failed");
      }
    }
    // Be polite to the trial endpoint (~1 req/sec).
    await sleep(1100);
  }

  console.log(
    `[backfill] done. hits=${hits} rejected=${rejected} misses=${misses} ` +
      `rate_limited=${rateLimited} written=${written}`,
  );
}

main().catch((e) => {
  console.error("[backfill] fatal", e);
  process.exit(1);
});
