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
import { lookupUpcFromUpcitemdb } from "../src/lib/upcitemdb.js";

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
const ACCEPTED_CONFIDENCE = (argv.confidence ?? "user_confirmed,manual_admin")
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
    return maps ?? [];
  }

  // First grab a pool of mlcc_items missing images.
  const { data: missing, error: missingErr } = await supabase
    .from("mlcc_items")
    .select("code")
    .is("image_url", null)
    .eq("is_active", true)
    .limit(LIMIT * 4); // overfetch — many won't have a mapping
  if (missingErr) throw missingErr;
  const codes = [...new Set((missing ?? []).map((r) => r.code))];
  if (codes.length === 0) return [];

  // Now find which of those codes have a high-confidence UPC mapping.
  const { data: maps, error: mapsErr } = await supabase
    .from("upc_mappings")
    .select("upc, mlcc_code, confidence_source")
    .in("mlcc_code", codes)
    .in("confidence_source", ACCEPTED_CONFIDENCE)
    .limit(LIMIT);
  if (mapsErr) throw mapsErr;
  return maps ?? [];
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
  let rateLimited = 0;
  let written = 0;

  for (const mapping of candidates) {
    const { upc, mlcc_code: code } = mapping;
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

    hits += 1;
    if (DRY_RUN) {
      console.log(`would set image_url = ${imageUrl.slice(0, 60)}…`);
    } else {
      const ok = await updateAllCodeRows(code, imageUrl);
      if (ok) {
        written += 1;
        console.log(`✓ set`);
      } else {
        console.log("write failed");
      }
    }
    // Be polite to the trial endpoint (~1 req/sec).
    await sleep(1100);
  }

  console.log(
    `[backfill] done. hits=${hits} misses=${misses} rate_limited=${rateLimited} written=${written}`,
  );
}

main().catch((e) => {
  console.error("[backfill] fatal", e);
  process.exit(1);
});
