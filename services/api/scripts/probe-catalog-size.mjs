#!/usr/bin/env node
/**
 * probe-catalog-size.mjs — list every MLCC catalog SKU matching a name at a
 * given bottle size. Answers "what does the catalog ACTUALLY have here?" so
 * resolver decisions come from data, not guesses (built 2026-07-23 to settle
 * whether plain 80-proof Smirnoff exists at 200ml).
 *
 * READ-ONLY. Runs on Tony's Mac vs prod (LK_PROD_* in services/api/.env).
 *
 * USAGE (from services/api/):
 *   node scripts/probe-catalog-size.mjs smirnoff 200
 *   node scripts/probe-catalog-size.mjs "jack daniel" 750
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("Points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const search = process.argv[2];
const sizeMl = process.argv[3] ? Number(process.argv[3]) : null;
if (!search) {
  console.error("usage: node scripts/probe-catalog-size.mjs <nameKeyword> [sizeMl]");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
console.log(`target: ${new URL(SUPABASE_URL).host} — search="${search}"${sizeMl ? ` size=${sizeMl}ml` : " (all sizes)"}`);

let q = supabase
  .from("mlcc_items")
  .select("code,name,bottle_size_ml,proof,licensee_price,min_shelf_price,ada_number")
  .ilike("name", `%${search}%`);
if (sizeMl) q = q.eq("bottle_size_ml", sizeMl);
const { data, error } = await q.order("name").limit(200);
if (error) {
  console.error(`query failed: ${error.message}`);
  process.exit(1);
}
if (!data || data.length === 0) {
  console.log("NO MATCHES — nothing in the catalog for that name/size.");
  process.exit(0);
}
console.log(`\n${data.length} match(es):`);
for (const r of data) {
  console.log(
    `  ${r.code} · ${r.name} · ${r.bottle_size_ml}ml · ${r.proof ?? "?"}pf · $${r.licensee_price ?? "?"} · ADA ${r.ada_number ?? "?"}`,
  );
}
