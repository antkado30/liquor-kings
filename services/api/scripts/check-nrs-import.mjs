#!/usr/bin/env node
/**
 * One-off diagnostic (2026-06-13): audit-upc-mappings.mjs reported "0 NRS
 * source names" against prod, meaning every one of the 16,771 upc_mappings
 * rows landed in UNVERIFIED. project_nrs_coverage memory says prod had
 * ~1,000 nrs_import rows as of 2026-06-04 — this checks whether that table
 * is actually empty now, or whether the audit script's column-name
 * detection just didn't match this table's real columns.
 *
 * USAGE (services/api/):
 *   node scripts/check-nrs-import.mjs
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
console.log(`[check] using ${SUPABASE_URL}`);

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

async function main() {
  const { count, error: countErr } = await supabase
    .from("nrs_import")
    .select("*", { count: "exact", head: true });
  console.log("[check] nrs_import count:", count, "error:", countErr?.message ?? null);

  const { data, error: rowErr } = await supabase.from("nrs_import").select("*").limit(1);
  console.log("[check] sample row error:", rowErr?.message ?? null);
  if (data?.length) {
    console.log("[check] sample row columns:", Object.keys(data[0]));
    console.log("[check] sample row:", data[0]);
  } else {
    console.log("[check] sample row: (none)");
  }
}

main().catch((e) => {
  console.error("[check] fatal", e);
  process.exit(1);
});
