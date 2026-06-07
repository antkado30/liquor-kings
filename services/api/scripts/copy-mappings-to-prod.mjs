/**
 * One-time backfill: copy `public.upc_mappings` rows from local Supabase →
 * production Supabase. Used 2026-05-12 because the NRS import endpoint on
 * Fly's shared-cpu-1x machine takes too long (CPU-bound scoring vs 1/8
 * vCPU), but Tony's Mac already produced the mappings yesterday — no need
 * to re-score, just copy the result.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from services/api/.env
 * (local Supabase). Reads PROD_URL + PROD_SERVICE_ROLE_KEY from explicit
 * shell env (so we never accidentally swap which side is source vs target).
 *
 * Run from services/api:
 *   PROD_URL="https://eamoozfhqolshdztbrez.supabase.co" \
 *   PROD_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
 *   node --env-file=.env scripts/copy-mappings-to-prod.mjs
 *
 * Idempotent: uses upsert(onConflict=upc), so re-running is safe.
 */
import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = process.env.SUPABASE_URL;
const LOCAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.PROD_URL;
const PROD_KEY = process.env.PROD_SERVICE_ROLE_KEY;

const required = { LOCAL_URL, LOCAL_KEY, PROD_URL, PROD_KEY };
for (const [k, v] of Object.entries(required)) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

// Sanity: source must be local, target must be prod. Saves us from
// accidentally clobbering prod data with empty local data, or vice versa.
if (!LOCAL_URL.includes("127.0.0.1") && !LOCAL_URL.includes("localhost")) {
  console.error(
    `Refusing to run: LOCAL_URL "${LOCAL_URL}" is not localhost. ` +
      "This script copies LOCAL → PROD. Double-check services/api/.env.",
  );
  process.exit(1);
}
if (PROD_URL === LOCAL_URL) {
  console.error("PROD_URL and LOCAL_URL are identical. Refusing to copy a DB onto itself.");
  process.exit(1);
}

const local = createClient(LOCAL_URL, LOCAL_KEY, { auth: { persistSession: false } });
const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });

const COLUMNS = [
  "upc",
  "mlcc_code",
  "confidence_source",
  "confirmed_by",
  "confirmed_at",
  "scan_count",
  "flag_count",
  "last_scanned_at",
  "last_flagged_at",
  "notes",
].join(", ");

console.log(`source: ${LOCAL_URL}`);
console.log(`target: ${PROD_URL}`);

// Read all rows from local in 1000-row pages (PostgREST server cap).
console.log("\nreading local upc_mappings...");
const allRows = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await local
    .from("upc_mappings")
    .select(COLUMNS)
    .order("upc", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error(`read failed at offset ${from}:`, error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  allRows.push(...data);
  console.log(`  read ${allRows.length} rows so far...`);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`done reading: ${allRows.length} rows`);

if (allRows.length === 0) {
  console.error("\nLocal upc_mappings is empty. Nothing to copy.");
  console.error("Check that your local Supabase is running and seeded.");
  process.exit(1);
}

// Write to prod in 100-row chunks. Small chunks avoid the Kong socket-close
// pattern we hit during NRS import (silent stale-connection drops).
console.log("\nwriting to prod upc_mappings...");
const CHUNK = 100;
let succeeded = 0;
let failed = 0;
const errors = [];
for (let i = 0; i < allRows.length; i += CHUNK) {
  const chunk = allRows.slice(i, i + CHUNK);
  try {
    const { error } = await prod
      .from("upc_mappings")
      .upsert(chunk, { onConflict: "upc" });
    if (error) {
      failed += chunk.length;
      errors.push({ chunkIndex: i / CHUNK, message: error.message, code: error.code });
    } else {
      succeeded += chunk.length;
    }
  } catch (e) {
    failed += chunk.length;
    errors.push({
      chunkIndex: i / CHUNK,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  if ((i / CHUNK) % 5 === 0) {
    console.log(`  progress: ${succeeded}/${allRows.length} written, ${failed} failed`);
  }
}

console.log("\n=== done ===");
console.log(`source rows: ${allRows.length}`);
console.log(`succeeded:   ${succeeded}`);
console.log(`failed:      ${failed}`);
if (errors.length > 0) {
  console.log(`\nfirst ${Math.min(5, errors.length)} errors:`);
  for (const e of errors.slice(0, 5)) {
    console.log("  ", JSON.stringify(e));
  }
}

// Verify: count rows in prod and report.
const { count: prodCount, error: countErr } = await prod
  .from("upc_mappings")
  .select("upc", { count: "exact", head: true });
if (countErr) {
  console.log(`\nprod count query failed: ${countErr.message}`);
} else {
  console.log(`\nprod upc_mappings total rows: ${prodCount}`);
}
