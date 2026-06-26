#!/usr/bin/env node
/**
 * lookup-codes.mjs — print the bottle name + size + price for MLCC codes.
 * For "the validate flagged 95996/23118/2791 — which bottles are those?"
 *
 * Runs on your Mac vs PROD. Needs LK_PROD_SUPABASE_URL /
 * LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallback) in services/api/.env.
 *
 * USAGE (from services/api/):
 *   node scripts/lookup-codes.mjs 95996 23118 2791
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(URL)) {
  console.error("Points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const codes = process.argv.slice(2).map((c) => String(c).trim()).filter(Boolean);
if (codes.length === 0) {
  console.error("Usage: node scripts/lookup-codes.mjs <code> [code ...]");
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const { data, error } = await supabase
  .from("mlcc_items")
  .select("code, name, bottle_size_ml, bottle_size_label, licensee_price")
  .in("code", codes);
if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

const byCode = new Map((data || []).map((r) => [String(r.code), r]));
console.log("");
for (const c of codes) {
  const r = byCode.get(c);
  if (!r) {
    console.log(`  ${c}  →  (not found in catalog)`);
    continue;
  }
  const size = r.bottle_size_label || (r.bottle_size_ml ? `${r.bottle_size_ml} ML` : "");
  const price = r.licensee_price != null ? `$${r.licensee_price}` : "";
  console.log(`  ${c}  →  ${r.name}   ${size}   ${price}`);
}
console.log("");
process.exit(0);
