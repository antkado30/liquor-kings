/**
 * Operator-facing compact summary derived from {@link serializeMlccExecutionReadiness} output.
 * No guard rules — counts come only from `blocking_lines` + `ready` / `error`.
 */

/** @typedef {{ status_code: string; blocked: boolean; blocking_count: number; missing_mlcc_item_id_count: number }} MlccExecutionSummary */

/**
 * First N blocking line entries for operator dashboards (no new rules).
 *
 * @param {{ blocking_lines?: unknown[] | null }} readiness — serialized readiness
 * @param {number} [limit]
 * @returns {unknown[]}
 */
export function deriveBlockingPreview(readiness, limit = 3) {
  const n = Math.max(0, Math.min(20, Number(limit) || 3));
  const lines = Array.isArray(readiness?.blocking_lines) ? readiness.blocking_lines : [];
  return lines.slice(0, n);
}

/**
 * @param {{
 *   ready?: boolean;
 *   error?: string | null;
 *   blocking_lines?: unknown[] | null;
 * }} readiness — output of `serializeMlccExecutionReadiness`
 * @returns {MlccExecutionSummary}
 */
export function deriveMlccExecutionSummaryFromReadiness(readiness) {
  const lines = Array.isArray(readiness?.blocking_lines) ? readiness.blocking_lines : [];
  const blocking_count = lines.length;
  const missing_mlcc_item_id_count = lines.filter(
    (row) => row && typeof row === "object" && row.reason === "missing_mlcc_item_id",
  ).length;

  if (readiness?.ready === true) {
    return {
      status_code: "ready",
      blocked: false,
      blocking_count: 0,
      missing_mlcc_item_id_count: 0,
    };
  }

  if (readiness?.error === "MLCC_ITEM_ID_REQUIRED") {
    return {
      status_code: "blocked_missing_mlcc_item_id",
      blocked: true,
      blocking_count,
      missing_mlcc_item_id_count,
    };
  }

  return {
    status_code: "not_mlcc_ready",
    blocked: true,
    blocking_count: 0,
    missing_mlcc_item_id_count: 0,
  };
}
