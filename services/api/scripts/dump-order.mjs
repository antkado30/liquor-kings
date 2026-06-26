#!/usr/bin/env node
/**
 * dump-order.mjs — print the exact code × quantity list from the most recent
 * validate run, so you can hand-enter the order on MILO's "Add By Code" page
 * fast (deadline fallback when the in-app submit is fighting a slow MILO).
 *
 * Runs on your Mac vs PROD. Needs LK_PROD_SUPABASE_URL /
 * LK_PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_* fallback) in services/api/.env.
 *
 * USAGE (from services/api/):
 *   node scripts/dump-order.mjs
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

const storeId = process.argv[2] || "e594fc3a-17b7-45d0-9dde-943ebbfa5391"; // Colony primary
const OOS = new Set(["95996", "23118", "2791"]); // flagged out-of-stock — skip on MILO
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from("execution_runs")
  .select("payload_snapshot, created_at")
  .eq("store_id", storeId)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}
const items = Array.isArray(data?.payload_snapshot?.items) ? data.payload_snapshot.items : [];
if (items.length === 0) {
  console.error("No items found on the latest run. Use the app cart as your checklist instead.");
  process.exit(1);
}

console.log(`\nOrder from latest validate (${data.created_at}) — ${items.length} lines:\n`);
console.log("  CODE        QTY   NAME");
console.log("  ----------  ----  -------------------------------");
for (const it of items) {
  const code = String(it.code ?? it.mlcc_code ?? "?");
  const qty = it.quantity ?? it.qty ?? "?";
  const name = it.name ?? it.expected_name ?? "";
  const flag = OOS.has(code) ? "  <-- OUT OF STOCK, SKIP" : "";
  console.log(`  ${code.padEnd(10)}  ${String(qty).padStart(4)}  ${name}${flag}`);
}
console.log("\n  (Skip the OUT OF STOCK lines — MILO won't accept them.)\n");
process.exit(0);
