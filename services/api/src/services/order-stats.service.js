/**
 * order-stats.service — derived order-frequency stats (2026-07-15 spec,
 * ships with the 20260717 migrations; Tony's relevance decision:
 * "most relevant = what stores actually ORDER").
 *
 * Two write paths, one truth:
 *   - LIVE: bumpOrderStatsForRun() — fire-and-forget after a MILO
 *     confirmation persists. Calls the ATOMIC bump_order_stats() SQL
 *     function (per-store rollup + global mlcc_items.ordered_count in
 *     one transaction).
 *   - REBUILD: scripts/backfill-order-stats.mjs — recomputes everything
 *     from execution-run snapshots from scratch. Because stats are
 *     DERIVED data, any drift (e.g. a rare double-bump from a worker
 *     retry) self-heals on the next rebuild.
 *
 * FAIL-OPEN BY LAW: stats can never fail an order write. Every entry
 * point here catches, logs one line, and returns — the confirmation
 * path's result is never coupled to ours.
 */

/**
 * Extract ordered lines from an execution run's payload_snapshot.
 * Pure + defensive: unknown shapes yield [] rather than throwing.
 * Lines are deduped by MLCC code with quantities summed (a cart can
 * carry the same code twice only through legacy paths, but dedupe is
 * cheap and makes the output canonical).
 *
 * @param {object | null | undefined} snapshot - execution_runs.payload_snapshot
 * @returns {{ code: string, qty: number }[]}
 */
export function extractOrderedLines(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  /** @type {Map<string, number>} */
  const byCode = new Map();
  for (const it of items) {
    const code = String(it?.bottle?.mlcc_code ?? "").trim();
    if (!code) continue;
    const qty = Number(it?.quantity);
    const safeQty = Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 0;
    byCode.set(code, (byCode.get(code) ?? 0) + safeQty);
  }
  return [...byCode.entries()].map(([code, qty]) => ({ code, qty }));
}

/**
 * Bump order stats for one submitted order. Fire-and-forget: callers may
 * `void` the promise; all failures are logged and swallowed.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ storeId: string, executionRunId: string, placedAt?: string | null }} args
 * @returns {Promise<{ ok: boolean, lines: number, error?: string }>}
 */
export async function bumpOrderStatsForRun(supabase, { storeId, executionRunId, placedAt }) {
  try {
    if (!storeId || !executionRunId) {
      return { ok: false, lines: 0, error: "missing storeId/executionRunId" };
    }
    const { data: run, error: runErr } = await supabase
      .from("execution_runs")
      .select("payload_snapshot")
      .eq("id", executionRunId)
      .maybeSingle();
    if (runErr || !run) {
      console.warn(
        `[order-stats] run fetch failed for ${executionRunId} (stats skipped): ${runErr?.message ?? "not found"}`,
      );
      return { ok: false, lines: 0, error: runErr?.message ?? "run not found" };
    }
    const lines = extractOrderedLines(run.payload_snapshot);
    if (lines.length === 0) {
      console.warn(`[order-stats] run ${executionRunId} had no extractable lines (stats skipped)`);
      return { ok: false, lines: 0, error: "no lines" };
    }
    const { error: rpcErr } = await supabase.rpc("bump_order_stats", {
      p_store_id: storeId,
      p_placed_at: placedAt ?? new Date().toISOString(),
      p_lines: lines,
    });
    if (rpcErr) {
      // Includes the function-not-created-yet case (migration applies
      // Friday) — one warn line, order flow untouched.
      console.warn(`[order-stats] bump failed for run ${executionRunId} (stats skipped): ${rpcErr.message}`);
      return { ok: false, lines: lines.length, error: rpcErr.message };
    }
    console.log(`[order-stats] bumped ${lines.length} code(s) for run ${executionRunId}`);
    return { ok: true, lines: lines.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[order-stats] unexpected (stats skipped): ${msg}`);
    return { ok: false, lines: 0, error: msg };
  }
}
