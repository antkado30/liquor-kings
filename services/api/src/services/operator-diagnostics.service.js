import { DIAGNOSTIC_KIND } from "./diagnostics.service.js";
import { isRetryableFailureType } from "./execution-failure.service.js";

const DEFAULT_RUN_WINDOW_DAYS = 7;
const DEFAULT_DIAG_LIMIT = 120;
const DEFAULT_MAX_RUN_ROWS = 5000;
const DEFAULT_MAX_RETRIES = 2;

const TREND_RUN_CAP = 15000;
const TREND_MANUAL_CAP = 5000;
const TREND_LOOKBACK_DAYS = 30;

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

/** UTC hour key `YYYY-MM-DDTHH` for bucketing. */
function hourKeyFromIso(iso) {
  if (!iso) return null;
  const s = String(iso);
  return s.length >= 13 ? s.slice(0, 13) : null;
}

/** UTC date key `YYYY-MM-DD`. */
function dayKeyFromIso(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function buildRollingHourKeys(nowMs, hours) {
  const keys = [];
  const labels = [];
  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(nowMs);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - i);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const h = String(d.getUTCHours()).padStart(2, "0");
    const key = `${y}-${mo}-${da}T${h}`;
    keys.push(key);
    labels.push(`${mo}-${da} ${h}:00 UTC`);
  }
  return { keys, labels };
}

function buildRollingDayKeys(nowMs, days) {
  const keys = [];
  const labels = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    keys.push(key);
    labels.push(key);
  }
  return { keys, labels };
}

function emptyBucket() {
  return {
    runs: 0,
    failures: 0,
    retryable_failures: 0,
    non_retryable_failures: 0,
    manual_review_marks: 0,
  };
}

function aggregateBuckets(runs, manualRows, keys, keyFromRunIso, windowStartIso) {
  const map = new Map(keys.map((k) => [k, emptyBucket()]));
  for (const r of runs) {
    const t = r.created_at;
    if (!t || t < windowStartIso) continue;
    const k = keyFromRunIso(t);
    if (k == null || !map.has(k)) continue;
    const b = map.get(k);
    b.runs += 1;
    const st = r.status ?? "unknown";
    if (st === "failed") {
      b.failures += 1;
      const ft = r.failure_type ?? "UNKNOWN";
      const maxR = Number(r.max_retries ?? DEFAULT_MAX_RETRIES);
      const rc = Number(r.retry_count ?? 0);
      const retryable = isRetryableFailureType(ft) && rc < maxR;
      if (retryable) b.retryable_failures += 1;
      else b.non_retryable_failures += 1;
    }
  }
  for (const row of manualRows) {
    const t = row.created_at;
    if (!t || t < windowStartIso) continue;
    const k = keyFromRunIso(t);
    if (k == null || !map.has(k)) continue;
    map.get(k).manual_review_marks += 1;
  }
  return keys.map((k) => map.get(k));
}

function buildTrendWindow(nowMs, runs, manualRows, hoursOrDays, mode) {
  const windowStart = new Date(nowMs);
  if (mode === "hour") {
    windowStart.setUTCMinutes(0, 0, 0);
    windowStart.setUTCHours(windowStart.getUTCHours() - (hoursOrDays - 1));
  } else {
    windowStart.setUTCHours(0, 0, 0, 0);
    windowStart.setUTCDate(windowStart.getUTCDate() - (hoursOrDays - 1));
  }
  const windowStartIso = windowStart.toISOString();

  let keys;
  let labels;
  let keyFromRunIso;
  if (mode === "hour") {
    ({ keys, labels } = buildRollingHourKeys(nowMs, hoursOrDays));
    keyFromRunIso = hourKeyFromIso;
  } else {
    ({ keys, labels } = buildRollingDayKeys(nowMs, hoursOrDays));
    keyFromRunIso = dayKeyFromIso;
  }

  const buckets = aggregateBuckets(runs, manualRows, keys, keyFromRunIso, windowStartIso);
  const points = keys.map((_, i) => ({
    label: labels[i],
    runs: buckets[i].runs,
    failures: buckets[i].failures,
    retryable_failures: buckets[i].retryable_failures,
    non_retryable_failures: buckets[i].non_retryable_failures,
    manual_review_marks: buckets[i].manual_review_marks,
  }));

  return {
    granularity: mode === "hour" ? "hour" : "day",
    bucket_count: points.length,
    window_start_utc: windowStartIso,
    points,
  };
}

function buildTrendsForStore(runsForTrend, manualForTrend, runsCapHit, manualCapHit, nowMs = Date.now()) {
  const notes = [
    `Trends use up to ${TREND_RUN_CAP} runs and ${TREND_MANUAL_CAP} manual-review actions in the last ${TREND_LOOKBACK_DAYS} days (UTC buckets). Caps may truncate older points in busy stores.`,
    "Runs are bucketed by execution_runs.created_at. Manual review marks are mark_for_manual_review actions bucketed by action created_at (not run creation).",
  ];

  return {
    notes,
    runs_row_cap: TREND_RUN_CAP,
    runs_rows_used: runsForTrend.length,
    runs_cap_hit: runsCapHit,
    manual_actions_row_cap: TREND_MANUAL_CAP,
    manual_actions_rows_used: manualForTrend.length,
    manual_actions_cap_hit: manualCapHit,
    lookback_days: TREND_LOOKBACK_DAYS,
    windows: {
      "24h": buildTrendWindow(nowMs, runsForTrend, manualForTrend, 24, "hour"),
      "7d": buildTrendWindow(nowMs, runsForTrend, manualForTrend, 7, "day"),
      "30d": buildTrendWindow(nowMs, runsForTrend, manualForTrend, 30, "day"),
    },
  };
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
  const trendSince = new Date(Date.now() - TREND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [runsRes, diagRes, trendRunsRes, manualRes] = await Promise.all([
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
    supabase
      .from("execution_runs")
      .select("status, failure_type, retry_count, max_retries, created_at")
      .eq("store_id", storeId)
      .gte("created_at", trendSince)
      .order("created_at", { ascending: true })
      .limit(TREND_RUN_CAP),
    supabase
      .from("execution_run_operator_actions")
      .select("created_at")
      .eq("store_id", storeId)
      .eq("action", "mark_for_manual_review")
      .gte("created_at", trendSince)
      .order("created_at", { ascending: true })
      .limit(TREND_MANUAL_CAP),
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
  if (trendRunsRes.error) {
    return {
      statusCode: 500,
      body: {
        error: trendRunsRes.error.message,
        code: "diagnostics_trend_runs_query_failed",
      },
    };
  }
  if (manualRes.error) {
    return {
      statusCode: 500,
      body: {
        error: manualRes.error.message,
        code: "diagnostics_trend_manual_actions_query_failed",
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

  const trendRuns = trendRunsRes.data ?? [];
  const manualRows = manualRes.data ?? [];
  const trends = buildTrendsForStore(
    trendRuns,
    manualRows,
    trendRuns.length >= TREND_RUN_CAP,
    manualRows.length >= TREND_MANUAL_CAP,
  );

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
            "Trends (below) use a separate capped query over the last 30 days; summary cards above still use the execution_runs_window_days setting.",
          ],
        },
        execution_runs: {
          by_status: byStatus,
          failed_by_failure_type: failedByType,
          failed_retryable_count: failedRetryable,
          failed_non_retryable_count: failedNonRetryable,
        },
        trends,
        recent_system_diagnostics: recentRows,
        operator_session_events: operatorSessionEvents,
      },
    },
  };
}
