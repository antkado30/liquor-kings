import { DIAGNOSTIC_KIND } from "./diagnostics.service.js";
import { isRetryableFailureType } from "./execution-failure.service.js";

const DEFAULT_RUN_WINDOW_DAYS = 7;
const DEFAULT_DIAG_LIMIT = 120;
const DEFAULT_MAX_RUN_ROWS = 5000;
const DEFAULT_MAX_RETRIES = 2;

function summarizePayload(payload) {
  if (payload == null) return null;
  try {
    const s = JSON.stringify(payload);
    if (s.length <= 280) return s;
    return `${s.slice(0, 280)}…`;
  } catch {
    return String(payload);
  }
}

/**
 * Store-scoped execution aggregates + store + global rows from lk_system_diagnostics
 * (service-role Supabase client bypasses RLS; operator route enforces session + store).
 */
export async function getOperatorDiagnosticsOverview(
  supabase,
  storeId,
  {
    runWindowDays = DEFAULT_RUN_WINDOW_DAYS,
    diagLimit = DEFAULT_DIAG_LIMIT,
    maxRunRows = DEFAULT_MAX_RUN_ROWS,
  } = {},
) {
  const since = new Date(Date.now() - runWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const [runsRes, diagRes] = await Promise.all([
    supabase
      .from("execution_runs")
      .select("status, failure_type, retry_count, max_retries, created_at")
      .eq("store_id", storeId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(maxRunRows),
    supabase
      .from("lk_system_diagnostics")
      .select("id, store_id, run_by_user_id, source, payload, created_at")
      .or(`store_id.eq.${storeId},store_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(diagLimit),
  ]);

  if (runsRes.error) {
    return {
      statusCode: 500,
      body: {
        error: runsRes.error.message,
        code: "diagnostics_execution_runs_query_failed",
      },
    };
  }
  if (diagRes.error) {
    return {
      statusCode: 500,
      body: {
        error: diagRes.error.message,
        code: "diagnostics_system_diagnostics_query_failed",
      },
    };
  }

  const runs = runsRes.data ?? [];
  const byStatus = {};
  const failedByType = {};
  let failedRetryable = 0;
  let failedNonRetryable = 0;

  for (const r of runs) {
    const st = r.status ?? "unknown";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    if (st === "failed") {
      const ft = r.failure_type ?? "UNKNOWN";
      failedByType[ft] = (failedByType[ft] ?? 0) + 1;
      const maxR = Number(r.max_retries ?? DEFAULT_MAX_RETRIES);
      const rc = Number(r.retry_count ?? 0);
      const canRetry = isRetryableFailureType(ft) && rc < maxR;
      if (canRetry) failedRetryable += 1;
      else failedNonRetryable += 1;
    }
  }

  const rawDiags = diagRes.data ?? [];
  const recentRows = rawDiags.map((row) => {
    const kind = row.payload?.kind ?? null;
    return {
      id: row.id,
      created_at: row.created_at,
      store_id: row.store_id,
      scope: row.store_id == null ? "global" : "store",
      source: row.source,
      run_by_user_id: row.run_by_user_id,
      kind,
      payload_preview: summarizePayload(row.payload),
    };
  });

  const operatorSessionEvents = recentRows
    .filter((d) => d.kind === DIAGNOSTIC_KIND.OPERATOR_SESSION)
    .slice(0, 50);

  return {
    statusCode: 200,
    body: {
      success: true,
      data: {
        meta: {
          store_id: storeId,
          execution_runs_window_days: runWindowDays,
          execution_runs_row_cap: maxRunRows,
          execution_runs_rows_used: runs.length,
          system_diagnostics_row_cap: diagLimit,
          system_diagnostics_rows_returned: recentRows.length,
          notes: [
            "Execution run counts are for the current operator store only, within the time window, capped at execution_runs_row_cap rows (newest first).",
            "System diagnostics include this store and rows with store_id null (global). Operator session rows are a subset of payload.kind = operator_session.",
          ],
        },
        execution_runs: {
          by_status: byStatus,
          failed_by_failure_type: failedByType,
          failed_retryable_count: failedRetryable,
          failed_non_retryable_count: failedNonRetryable,
        },
        recent_system_diagnostics: recentRows,
        operator_session_events: operatorSessionEvents,
      },
    },
  };
}
