import { DIAGNOSTIC_KIND } from "./diagnostics.service.js";
import { isRetryableFailureType } from "./execution-failure.service.js";
import {
  computeAttemptHistoryWindowInsights,
  fetchAttemptsByRunIdsGrouped,
} from "./execution-attempt-aggregate.service.js";
import {
  MLCC_SIGNAL,
  getMlccSignalShortLabel,
  resolveMlccSignalWithSource,
} from "./mlcc-operator-context.service.js";

const DEFAULT_RUN_WINDOW_DAYS = 7;
const DEFAULT_DIAG_LIMIT = 120;
const DEFAULT_MAX_RUN_ROWS = 5000;
const DEFAULT_MAX_RETRIES = 2;

const TREND_RUN_CAP = 15000;
const TREND_MANUAL_CAP = 5000;
const TREND_LOOKBACK_DAYS = 30;

/**
 * Queue / worker heuristics (server UTC). Adjust only here; same values are returned in API
 * `queue_health.thresholds_applied` so clients show what was used.
 */
export const QUEUE_HEALTH_THRESHOLDS = {
  /** Running: heartbeat null or older than this → stale_heartbeat_count (inferred unhealthy worker). */
  stale_heartbeat_minutes: 15,
  /** Queued: age since queued_at (fallback created_at) exceeds this → likely_stuck_queued_count (inferred). */
  stuck_queued_minutes: 30,
  /** Max queued+running rows loaded; if this many returned, counts may be incomplete. */
  active_run_query_cap: 5000,
};

const ACTIVE_RUN_CAP = QUEUE_HEALTH_THRESHOLDS.active_run_query_cap;

function parseTsMs(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function buildQueueHealthWarnings(h) {
  const w = [];
  if (h.active_runs_cap_hit) {
    w.push({
      severity: "warn",
      code: "active_runs_capped",
      message: `At least ${ACTIVE_RUN_CAP} queued+running rows exist; sample may omit oldest. Health counts can undercount.`,
    });
  }
  if (h.stale_heartbeat_count > 0) {
    w.push({
      severity: "warn",
      code: "stale_running_heartbeats",
      message: `${h.stale_heartbeat_count} running run(s) have no heartbeat or heartbeat older than ${h.thresholds_applied.stale_heartbeat_minutes} minutes (inferred worker issue).`,
    });
  }
  if (h.likely_stuck_queued_count > 0) {
    w.push({
      severity: "warn",
      code: "old_queued_runs",
      message: `${h.likely_stuck_queued_count} queued run(s) older than ${h.thresholds_applied.stuck_queued_minutes} minutes (inferred: worker not dequeuing).`,
    });
  }
  return w;
}

/**
 * @param {Array<Record<string, unknown>>} rows - queued+running only
 * @param {number} nowMs
 */
function computeQueueHealth(rows, nowMs) {
  const thresholdsApplied = { ...QUEUE_HEALTH_THRESHOLDS };
  const staleMs = thresholdsApplied.stale_heartbeat_minutes * 60 * 1000;
  const stuckQMs = thresholdsApplied.stuck_queued_minutes * 60 * 1000;

  const queued = rows.filter((r) => r.status === "queued");
  const running = rows.filter((r) => r.status === "running");

  let oldestQueuedMs = null;
  for (const r of queued) {
    const t = parseTsMs(r.queued_at) ?? parseTsMs(r.created_at);
    if (t != null && (oldestQueuedMs == null || t < oldestQueuedMs)) oldestQueuedMs = t;
  }

  let oldestRunningMs = null;
  for (const r of running) {
    const t = parseTsMs(r.started_at) ?? parseTsMs(r.heartbeat_at) ?? parseTsMs(r.created_at);
    if (t != null && (oldestRunningMs == null || t < oldestRunningMs)) oldestRunningMs = t;
  }

  let staleHeartbeatCount = 0;
  let likelyStuckQueuedCount = 0;
  let runningMissingHeartbeatAt = 0;
  let latestHbMs = null;

  for (const r of running) {
    const hb = parseTsMs(r.heartbeat_at);
    if (hb == null) {
      runningMissingHeartbeatAt += 1;
      staleHeartbeatCount += 1;
    } else {
      if (latestHbMs == null || hb > latestHbMs) latestHbMs = hb;
      if (nowMs - hb > staleMs) staleHeartbeatCount += 1;
    }
  }

  for (const r of queued) {
    const t = parseTsMs(r.queued_at) ?? parseTsMs(r.created_at);
    if (t != null && nowMs - t > stuckQMs) likelyStuckQueuedCount += 1;
  }

  const distinctWorkerIds = [
    ...new Set(running.map((r) => r.worker_id).filter((id) => id != null && String(id).length > 0)),
  ];

  const base = {
    inferred: true,
    interpretation_notes: [
      "All metrics are derived from execution_runs for this store only (queued + running snapshot).",
      "Stale / stuck labels are heuristics, not ground truth about worker processes.",
    ],
    thresholds_applied: thresholdsApplied,
    queued_count: queued.length,
    running_count: running.length,
    oldest_queued_age_seconds:
      oldestQueuedMs != null ? Math.max(0, Math.floor((nowMs - oldestQueuedMs) / 1000)) : null,
    oldest_running_age_seconds:
      oldestRunningMs != null ? Math.max(0, Math.floor((nowMs - oldestRunningMs) / 1000)) : null,
    stale_heartbeat_count: staleHeartbeatCount,
    likely_stuck_queued_count: likelyStuckQueuedCount,
    likely_stuck_run_count: likelyStuckQueuedCount + staleHeartbeatCount,
    active_runs_sampled: rows.length,
    active_runs_cap_hit: rows.length >= ACTIVE_RUN_CAP,
    worker_snapshot: {
      inferred: true,
      distinct_worker_ids: distinctWorkerIds,
      running_with_worker_id: running.filter((r) => r.worker_id != null && String(r.worker_id).length > 0)
        .length,
      running_missing_heartbeat_at: runningMissingHeartbeatAt,
      latest_heartbeat_at_utc:
        latestHbMs != null ? new Date(latestHbMs).toISOString() : null,
      notes: [
        "worker_id is optional on runs; empty distinct_worker_ids does not prove no workers.",
        "latest_heartbeat_at_utc is the newest heartbeat among currently running rows only (inferred activity pulse).",
      ],
    },
  };

  return {
    ...base,
    warnings: buildQueueHealthWarnings(base),
  };
}

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

function aggregateMlccFailedSignalsByKey(runs, keys, keyFromRunIso, windowStartIso) {
  const map = new Map(keys.map((k) => [k, {}]));
  for (const r of runs) {
    if (r.status !== "failed") continue;
    const t = r.created_at;
    if (!t || t < windowStartIso) continue;
    const k = keyFromRunIso(t);
    if (k == null || !map.has(k)) continue;
    const { signal } = resolveMlccSignalWithSource(r);
    if (!signal) continue;
    const o = map.get(k);
    o[signal] = (o[signal] ?? 0) + 1;
  }
  return keys.map((k) => map.get(k));
}

function rollupMlccFailedBySignalFromPoints(points) {
  const out = {};
  for (const p of points) {
    const m = p.mlcc_failed_by_signal;
    if (!m || typeof m !== "object") continue;
    for (const [sig, n] of Object.entries(m)) {
      const c = Number(n);
      if (!Number.isFinite(c)) continue;
      out[sig] = (out[sig] ?? 0) + c;
    }
  }
  return out;
}

function computeMlccWindowDiagnostics(runs, attemptsByRunId) {
  const failed = runs.filter((r) => r.status === "failed");
  const bySignal = {};
  let explicitRecorded = 0;
  let inferredRecorded = 0;

  for (const r of failed) {
    const { signal, source } = resolveMlccSignalWithSource(r);
    if (!signal) continue;
    bySignal[signal] = (bySignal[signal] ?? 0) + 1;
    if (source === "explicit") explicitRecorded += 1;
    else if (source === "inferred") inferredRecorded += 1;
  }

  const failedWithSignal = explicitRecorded + inferredRecorded;

  const recent = failed
    .slice()
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 20)
    .map((r) => {
      const { signal, source } = resolveMlccSignalWithSource(r);
      if (!signal) return null;
      return {
        run_id: r.id,
        created_at: r.created_at ?? null,
        mlcc_signal: signal,
        signal_source: source,
        failure_type: r.failure_type ?? null,
      };
    })
    .filter(Boolean);

  let failedRunsMultiFailedAttemptWithResolvedMlcc = 0;
  for (const r of failed) {
    const attempts = attemptsByRunId.get(r.id) ?? [];
    const failedAttempts = attempts.filter((a) => a.status === "failed");
    if (failedAttempts.length < 2) continue;
    const { signal } = resolveMlccSignalWithSource(r);
    if (signal) failedRunsMultiFailedAttemptWithResolvedMlcc += 1;
  }

  const signalLabels = {};
  for (const v of Object.values(MLCC_SIGNAL)) {
    signalLabels[v] = getMlccSignalShortLabel(v);
  }

  return {
    interpretation_notes: [
      "mlcc_signal comes from failure_details.mlcc_signal when present, else is inferred using the same rules as operator review (message, stage, failure_type).",
      "counts_by_mlcc_signal includes only failed runs in this execution_runs sample that resolve to a signal.",
      "failed_runs_multi_failed_attempt_with_resolved_mlcc_signal: failed runs with 2+ stored failed attempts and a resolved mlcc_signal on the run row. Attempt rows do not store mlcc_signal per attempt.",
      "Trend buckets (see trends.mlcc_failed_by_signal_rollup) count failed runs per time bucket that resolve to a signal; capped trend run query may omit older failures.",
    ],
    failed_runs_with_resolved_mlcc_signal: failedWithSignal,
    failed_runs_explicit_mlcc_signal: explicitRecorded,
    failed_runs_inferred_mlcc_signal: inferredRecorded,
    counts_by_mlcc_signal: bySignal,
    recent_failed_with_mlcc_signal: recent,
    failed_runs_multi_failed_attempt_with_resolved_mlcc_signal:
      failedRunsMultiFailedAttemptWithResolvedMlcc,
    signal_labels: signalLabels,
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
  const mlccPerKey = aggregateMlccFailedSignalsByKey(runs, keys, keyFromRunIso, windowStartIso);
  const points = keys.map((_, i) => ({
    label: labels[i],
    runs: buckets[i].runs,
    failures: buckets[i].failures,
    retryable_failures: buckets[i].retryable_failures,
    non_retryable_failures: buckets[i].non_retryable_failures,
    manual_review_marks: buckets[i].manual_review_marks,
    mlcc_failed_by_signal: mlccPerKey[i],
  }));

  return {
    granularity: mode === "hour" ? "hour" : "day",
    bucket_count: points.length,
    window_start_utc: windowStartIso,
    points,
  };
}

function buildTrendsForStore(runsForTrend, manualForTrend, runsCapHit, manualCapHit, nowMs = Date.now()) {
  const w24 = buildTrendWindow(nowMs, runsForTrend, manualForTrend, 24, "hour");
  const w7 = buildTrendWindow(nowMs, runsForTrend, manualForTrend, 7, "day");
  const w30 = buildTrendWindow(nowMs, runsForTrend, manualForTrend, 30, "day");

  const notes = [
    `Trends use up to ${TREND_RUN_CAP} runs and ${TREND_MANUAL_CAP} manual-review actions in the last ${TREND_LOOKBACK_DAYS} days (UTC buckets). Caps may truncate older points in busy stores.`,
    "Runs are bucketed by execution_runs.created_at. Manual review marks are mark_for_manual_review actions bucketed by action created_at (not run creation).",
    "Each point includes mlcc_failed_by_signal: counts of failed runs in that bucket that resolve to an mlcc_signal (explicit or inferred). Rollups sum those counts across buckets (not deduplicating runs across windows).",
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
    mlcc_failed_by_signal_rollup: {
      "24h": rollupMlccFailedBySignalFromPoints(w24.points),
      "7d": rollupMlccFailedBySignalFromPoints(w7.points),
      "30d": rollupMlccFailedBySignalFromPoints(w30.points),
    },
    windows: {
      "24h": w24,
      "7d": w7,
      "30d": w30,
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

  const [runsRes, diagRes, trendRunsRes, manualRes, activeHealthRes] = await Promise.all([
    supabase
      .from("execution_runs")
      .select(
        "id, status, failure_type, failure_details, error_message, retry_count, max_retries, created_at",
      )
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
      .select(
        "id, status, failure_type, failure_details, error_message, retry_count, max_retries, created_at",
      )
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
    supabase
      .from("execution_runs")
      .select(
        "id, status, created_at, queued_at, started_at, heartbeat_at, worker_id, progress_stage",
      )
      .eq("store_id", storeId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(ACTIVE_RUN_CAP),
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
  if (activeHealthRes.error) {
    return {
      statusCode: 500,
      body: {
        error: activeHealthRes.error.message,
        code: "diagnostics_active_runs_health_query_failed",
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

  const queueHealth = computeQueueHealth(activeHealthRes.data ?? [], Date.now());

  const runIdsForAttempts = runs.map((r) => r.id).filter(Boolean);
  const { byRunId: attemptsByRunId, error: attemptsAggError } =
    await fetchAttemptsByRunIdsGrouped(supabase, storeId, runIdsForAttempts);

  if (attemptsAggError) {
    return {
      statusCode: 500,
      body: {
        error: attemptsAggError,
        code: "diagnostics_execution_run_attempts_query_failed",
      },
    };
  }

  const attemptHistoryInsights = computeAttemptHistoryWindowInsights(
    runs,
    attemptsByRunId,
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
            "Queue health uses a live snapshot of queued+running runs (capped); see queue_health.thresholds_applied and interpretation_notes.",
            "attempt_history_insights use execution_run_attempts for the same run sample (joined by run id); see attempt_history_insights.interpretation_notes.",
            "mlcc_diagnostics derive mlcc_signal from stored failure_details and fields on execution_runs; see mlcc_diagnostics.interpretation_notes.",
          ],
        },
        mlcc_diagnostics: computeMlccWindowDiagnostics(runs, attemptsByRunId),
        execution_runs: {
          by_status: byStatus,
          failed_by_failure_type: failedByType,
          failed_retryable_count: failedRetryable,
          failed_non_retryable_count: failedNonRetryable,
        },
        attempt_history_insights: attemptHistoryInsights,
        queue_health: queueHealth,
        trends,
        recent_system_diagnostics: recentRows,
        operator_session_events: operatorSessionEvents,
      },
    },
  };
}
