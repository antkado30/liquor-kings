/**
 * Rebuild order-frequency stats from history (PROD) — relevance v3.
 *
 * WHAT: recomputes, FROM SCRATCH, the two derived stats the 20260717
 * migrations added:
 *   - store_item_order_stats (per-store: order_count / total_quantity /
 *     last_ordered_at per MLCC code) — powers the "Ordered before" filter
 *   - mlcc_items.ordered_count (global distinct-order count per code) —
 *     feeds featured_sort v3 ("most relevant = what stores actually order")
 *
 * SOURCE OF TRUTH: milo_order_confirmations (an order that really
 * happened) → its execution run's payload_snapshot lines
 * (items[].bottle.mlcc_code × quantity). Confirmations without a
 * surviving run (manual/backfilled rows) are counted as skipped — no
 * lines available, nothing to invent.
 *
 * FULL-REBUILD SEMANTICS (not incremental): zero out both stats, then
 * write computed absolutes. Safe to re-run any time; this is also the
 * self-heal for any live-bump drift. Requires the 20260717010000
 * migration to be applied first (fails loud if not).
 *
 * SAFETY: LK_PROD_* env only, prints target host, refuses localhost.
 * DRY-RUN by default (prints what it would write); --apply to write.
 *
 * USAGE (from services/api/):
 *   node scripts/backfill-order-stats.mjs           # dry-run
 *   node scripts/backfill-order-stats.mjs --apply   # write
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractOrderedLines } from "../src/services/order-stats.service.js";

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL;
const SUPABASE_KEY = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("LK_PROD_SUPABASE_URL points at the LOCAL dev stack — refusing.");
  process.exit(1);
}
console.log("target:", new URL(SUPABASE_URL).host);
console.log(`[order-stats-backfill] mode=${APPLY ? "APPLY (rebuild + write)" : "DRY-RUN (compute + report only)"}`);

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// 1. Every confirmed order: distinct (execution_run_id, store_id, placed_at).
//    Paged past the 1000-row cap (the scar), though today's volume is tiny.
const PAGE = 1000;
/** @type {Map<string, { storeId: string, placedAt: string | null }>} */
const runs = new Map();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("milo_order_confirmations")
    .select("execution_run_id, store_id, placed_at")
    .not("execution_run_id", "is", null)
    .order("placed_at", { ascending: true, nullsFirst: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error("[order-stats-backfill] confirmations read failed:", error.message);
    process.exit(1);
  }
  for (const row of data ?? []) {
    const prev = runs.get(row.execution_run_id);
    // Keep the latest placed_at seen for the run (per-ADA rows share a run).
    if (!prev || String(row.placed_at ?? "") > String(prev.placedAt ?? "")) {
      runs.set(row.execution_run_id, { storeId: row.store_id, placedAt: row.placed_at ?? null });
    }
  }
  if (!data || data.length < PAGE) break;
}
console.log(`[order-stats-backfill] ${runs.size} confirmed order run(s) found`);

// 2. Pull each run's snapshot lines.
/** @type {Map<string, { orderCount: number, totalQty: number, lastAt: string | null }>} perStoreCode key `${storeId}|${code}` */
const perStoreCode = new Map();
/** @type {Map<string, number>} global distinct-order count per code */
const globalCode = new Map();
let runsWithLines = 0;
let runsSkipped = 0;

const runIds = [...runs.keys()];
for (let i = 0; i < runIds.length; i += 100) {
  const chunk = runIds.slice(i, i + 100);
  const { data, error } = await db
    .from("execution_runs")
    .select("id, payload_snapshot")
    .in("id", chunk);
  if (error) {
    console.error("[order-stats-backfill] runs read failed:", error.message);
    process.exit(1);
  }
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  for (const id of chunk) {
    const meta = runs.get(id);
    const run = byId.get(id);
    const lines = run ? extractOrderedLines(run.payload_snapshot) : [];
    if (!run || lines.length === 0) {
      runsSkipped += 1;
      continue;
    }
    runsWithLines += 1;
    for (const { code, qty } of lines) {
      const key = `${meta.storeId}|${code}`;
      const cur = perStoreCode.get(key) ?? { orderCount: 0, totalQty: 0, lastAt: null };
      cur.orderCount += 1;
      cur.totalQty += qty;
      if (!cur.lastAt || String(meta.placedAt ?? "") > String(cur.lastAt)) cur.lastAt = meta.placedAt;
      perStoreCode.set(key, cur);
      globalCode.set(code, (globalCode.get(code) ?? 0) + 1);
    }
  }
}

console.log(
  `[order-stats-backfill] computed: ${runsWithLines} run(s) with lines, ${runsSkipped} skipped (no run/lines), ` +
    `${perStoreCode.size} store-code row(s), ${globalCode.size} distinct code(s)`,
);
const top = [...globalCode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("[order-stats-backfill] top ordered codes:", top.map(([c, n]) => `${c}×${n}`).join(", ") || "(none)");

if (!APPLY) {
  console.log("[order-stats-backfill] DRY-RUN done — happy? re-run with --apply");
  process.exit(0);
}

// 3. APPLY — full rebuild. Requires the migration (fails loud otherwise).
// 3a. Zero global counts (absolute writes — this script owns the truth).
{
  const { error } = await db.from("mlcc_items").update({ ordered_count: 0 }).gt("ordered_count", 0);
  if (error) {
    console.error("[order-stats-backfill] zeroing ordered_count failed (migration applied?):", error.message);
    process.exit(1);
  }
}
// 3b. Clear the per-store table.
{
  const { error } = await db.from("store_item_order_stats").delete().not("store_id", "is", null);
  if (error) {
    console.error("[order-stats-backfill] clearing store_item_order_stats failed (migration applied?):", error.message);
    process.exit(1);
  }
}
// 3c. Write per-store rows.
const statRows = [...perStoreCode.entries()].map(([key, v]) => {
  const [store_id, code] = key.split("|");
  return {
    store_id,
    code,
    order_count: v.orderCount,
    total_quantity: v.totalQty,
    last_ordered_at: v.lastAt,
  };
});
for (let i = 0; i < statRows.length; i += 500) {
  const { error } = await db.from("store_item_order_stats").insert(statRows.slice(i, i + 500));
  if (error) {
    console.error("[order-stats-backfill] stats insert failed:", error.message);
    process.exit(1);
  }
}
// 3d. Write global counts (absolute, per code — updates every ADA row of the code).
let codesWritten = 0;
for (const [code, n] of globalCode.entries()) {
  const { error } = await db.from("mlcc_items").update({ ordered_count: n }).eq("code", code);
  if (error) {
    console.error(`[order-stats-backfill] ordered_count write failed for ${code}:`, error.message);
    process.exit(1);
  }
  codesWritten += 1;
}

console.log(
  `[order-stats-backfill] APPLIED — ${statRows.length} store-code row(s), ordered_count set on ${codesWritten} code(s). ` +
    `featured_sort v3 recomputed itself (generated column).`,
);
