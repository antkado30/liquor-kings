import { useCallback, useEffect, useState } from "react";
import { getDiagnosticsOverview, parseJson } from "../api/operatorReview";
import { Msg } from "../operator-review/components/Msg";
import { useOperatorSession } from "../session/OperatorSessionContext";
import type { FlashKind } from "../operator-review/types";

type DiagRow = {
  id: string;
  created_at: string;
  store_id: string | null;
  scope: string;
  source: string | null;
  run_by_user_id: string | null;
  kind: string | null;
  payload_preview: string | null;
};

type TrendPoint = {
  label: string;
  runs: number;
  failures: number;
  retryable_failures: number;
  non_retryable_failures: number;
  manual_review_marks: number;
  /** Failed runs in bucket that resolved to an mlcc_signal (sparse object). */
  mlcc_failed_by_signal?: Record<string, number>;
};

type TrendWindow = {
  granularity: string;
  bucket_count: number;
  window_start_utc: string;
  points: TrendPoint[];
};

type TrendsData = {
  notes: string[];
  runs_row_cap: number;
  runs_rows_used: number;
  runs_cap_hit: boolean;
  manual_actions_row_cap: number;
  manual_actions_rows_used: number;
  manual_actions_cap_hit: boolean;
  lookback_days: number;
  /** Sum of per-bucket mlcc_failed_by_signal counts per window (same caps as trends). */
  mlcc_failed_by_signal_rollup?: Record<"24h" | "7d" | "30d", Record<string, number>>;
  windows: Record<"24h" | "7d" | "30d", TrendWindow>;
};

type HealthWarning = { severity: string; code: string; message: string };

type WorkerSnapshot = {
  inferred: boolean;
  distinct_worker_ids: string[];
  running_with_worker_id: number;
  running_missing_heartbeat_at: number;
  latest_heartbeat_at_utc: string | null;
  notes: string[];
};

type QueueHealthData = {
  inferred: boolean;
  interpretation_notes: string[];
  thresholds_applied: {
    stale_heartbeat_minutes: number;
    stuck_queued_minutes: number;
    active_run_query_cap: number;
  };
  queued_count: number;
  running_count: number;
  oldest_queued_age_seconds: number | null;
  oldest_running_age_seconds: number | null;
  stale_heartbeat_count: number;
  likely_stuck_queued_count: number;
  likely_stuck_run_count: number;
  active_runs_sampled: number;
  active_runs_cap_hit: boolean;
  worker_snapshot: WorkerSnapshot;
  warnings: HealthWarning[];
};

export type MlccDiagnosticsWindow = {
  interpretation_notes: string[];
  failed_runs_with_resolved_mlcc_signal: number;
  failed_runs_explicit_mlcc_signal: number;
  failed_runs_inferred_mlcc_signal: number;
  counts_by_mlcc_signal: Record<string, number>;
  recent_failed_with_mlcc_signal: Array<{
    run_id: string;
    created_at: string | null;
    mlcc_signal: string;
    signal_source: "explicit" | "inferred";
    failure_type: string | null;
  }>;
  failed_runs_multi_failed_attempt_with_resolved_mlcc_signal: number;
  signal_labels: Record<string, string>;
};

export type AttemptHistoryInsights = {
  interpretation_notes: string[];
  runs_in_window: number;
  runs_with_attempt_rows: number;
  total_stored_attempt_rows: number;
  avg_attempts_per_run_with_history: number | null;
  runs_with_more_than_one_attempt: number;
  runs_with_two_or_more_failed_attempts: number;
  runs_with_repeated_same_stored_failure: number;
  multi_attempt_runs_terminal_succeeded: number;
  multi_attempt_runs_terminal_failed: number;
  multi_attempt_runs_non_terminal: number;
  multi_attempt_success_rate: number | null;
  first_attempt_only_success_runs: number;
  eventual_success_after_failed_attempt_runs: number;
};

export type OverviewData = {
  meta: {
    store_id: string;
    execution_runs_window_days: number;
    execution_runs_row_cap: number;
    execution_runs_rows_used: number;
    system_diagnostics_row_cap: number;
    system_diagnostics_rows_returned: number;
    notes: string[];
  };
  execution_runs: {
    by_status: Record<string, number>;
    failed_by_failure_type: Record<string, number>;
    failed_retryable_count: number;
    failed_non_retryable_count: number;
  };
  attempt_history_insights?: AttemptHistoryInsights;
  /** MLCC signal breakdown for failed runs in the execution window sample. */
  mlcc_diagnostics?: MlccDiagnosticsWindow;
  queue_health?: QueueHealthData;
  trends?: TrendsData;
  recent_system_diagnostics: DiagRow[];
  operator_session_events: DiagRow[];
};

const TREND_WINDOWS: ("24h" | "7d" | "30d")[] = ["24h", "7d", "30d"];

function maxInSeries(points: TrendPoint[], key: keyof TrendPoint): number {
  if (!points.length) return 1;
  const n = Math.max(
    1,
    ...points.map((p) => (typeof p[key] === "number" ? (p[key] as number) : 0)),
  );
  return n;
}

function TrendBars({
  points,
  field,
  label,
}: {
  points: TrendPoint[];
  field: keyof TrendPoint;
  label: string;
}) {
  const max = maxInSeries(points, field);
  const total = points.reduce((s, p) => s + (typeof p[field] === "number" ? (p[field] as number) : 0), 0);
  if (total === 0) {
    return (
      <div className="trend-metric">
        <div className="trend-metric-label">
          {label} <span className="muted">— all buckets 0</span>
        </div>
        <div className="trend-bars" style={{ opacity: 0.35 }} aria-hidden>
          {points.map((_, i) => (
            <div key={i} className="trend-bar-col">
              <div className="trend-bar-fill" style={{ height: 0 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="trend-metric">
      <div className="trend-metric-label">
        {label} <span className="muted">(max {max} / bucket)</span>
      </div>
      <div className="trend-bars" role="img" aria-label={`${label} by bucket`}>
        {points.map((p, i) => {
          const v = typeof p[field] === "number" ? (p[field] as number) : 0;
          const pct = max > 0 ? Math.round((v / max) * 100) : 0;
          return (
            <div key={i} className="trend-bar-col" title={`${p.label}: ${v}`}>
              <div className="trend-bar-fill" style={{ height: `${Math.max(pct, v > 0 ? 8 : 0)}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sumValues(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function entriesSorted(o: Record<string, number>): [string, number][] {
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
}

function formatAgeSeconds(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 48) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH}h`;
}

function QueueHealthSection({ qh }: { qh: QueueHealthData }) {
  const th = qh.thresholds_applied;
  return (
    <div className="card queue-health-card" style={{ marginTop: 12 }}>
      <h3 className="section-title">Queue & worker health (this store)</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>Inferred</strong> from a live snapshot of <code>execution_runs</code> with status{" "}
        <code>queued</code> or <code>running</code> (max {th.active_run_query_cap} rows, oldest-first
        order). Not a substitute for host/worker logs.
      </p>
      <ul className="muted" style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12 }}>
        {qh.interpretation_notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <div className="mono muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Thresholds (API): stale heartbeat &gt; {th.stale_heartbeat_minutes}m · stuck queued &gt;{" "}
        {th.stuck_queued_minutes}m · adjust in{" "}
        <code>services/api/src/services/operator-diagnostics.service.js</code> (
        <code>QUEUE_HEALTH_THRESHOLDS</code>)
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        <strong>Stale heartbeat</strong>: running row with <code>heartbeat_at</code> missing or older
        than {th.stale_heartbeat_minutes} minutes. <strong>Stuck queued</strong>: queued row with{" "}
        <code>queued_at</code> (else <code>created_at</code>) older than {th.stuck_queued_minutes}{" "}
        minutes. <strong>Likely stuck runs</strong>: stuck queued count + stale running count (no
        double-count across statuses).
      </p>
      {qh.warnings.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          {qh.warnings.map((w) => (
            <div key={w.code} className="msg warn" style={{ marginTop: 8 }}>
              {w.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="msg success" style={{ marginBottom: 12 }}>
          No threshold warnings on this snapshot (heartbeats and queue ages look OK vs configured
          limits).
        </div>
      )}
      <div className="diag-cards">
        <div className="card diag-card">
          <div className="diag-card-label">Queued</div>
          <div className="diag-card-value">{qh.queued_count}</div>
        </div>
        <div className="card diag-card">
          <div className="diag-card-label">Running</div>
          <div className="diag-card-value">{qh.running_count}</div>
        </div>
        <div className="card diag-card">
          <div className="diag-card-label">Oldest queued age</div>
          <div className="diag-card-value" style={{ fontSize: 18 }}>
            {formatAgeSeconds(qh.oldest_queued_age_seconds)}
          </div>
        </div>
        <div className="card diag-card">
          <div className="diag-card-label">Oldest running age</div>
          <div className="diag-card-value" style={{ fontSize: 18 }}>
            {formatAgeSeconds(qh.oldest_running_age_seconds)}
          </div>
        </div>
        <div className="card diag-card">
          <div className="diag-card-label">Stale heartbeats</div>
          <div className="diag-card-value">{qh.stale_heartbeat_count}</div>
        </div>
        <div className="card diag-card">
          <div className="diag-card-label">Likely stuck (sum)</div>
          <div className="diag-card-value">{qh.likely_stuck_run_count}</div>
        </div>
      </div>
      <p className="mono muted" style={{ fontSize: 11, marginTop: 8 }}>
        Sampled {qh.active_runs_sampled} active rows
        {qh.active_runs_cap_hit ? " (cap hit — totals may be incomplete)" : ""}.
      </p>
      <h4 className="section-title" style={{ marginTop: 16, fontSize: 14 }}>
        Worker snapshot <span className="muted">(inferred)</span>
      </h4>
      <ul className="muted" style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12 }}>
        {qh.worker_snapshot.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <table className="diag-table">
        <tbody>
          <tr>
            <th scope="row">Distinct worker_id (running)</th>
            <td className="mono">
              {qh.worker_snapshot.distinct_worker_ids.length
                ? qh.worker_snapshot.distinct_worker_ids.join(", ")
                : "— none set on running rows"}
            </td>
          </tr>
          <tr>
            <th scope="row">Running rows with worker_id</th>
            <td>{qh.worker_snapshot.running_with_worker_id}</td>
          </tr>
          <tr>
            <th scope="row">Running rows missing heartbeat_at</th>
            <td>{qh.worker_snapshot.running_missing_heartbeat_at}</td>
          </tr>
          <tr>
            <th scope="row">Latest heartbeat (running only)</th>
            <td className="mono">
              {qh.worker_snapshot.latest_heartbeat_at_utc ?? "— (no heartbeat on running rows)"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DiagnosticsPage() {
  const { handleSessionFailure } = useOperatorSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [msg, setMsg] = useState<{ type: FlashKind; text: string }>({ type: "", text: "" });
  const [trendWindow, setTrendWindow] = useState<"24h" | "7d" | "30d">("7d");

  const load = useCallback(async () => {
    setLoading(true);
    setMsg({ type: "", text: "" });
    try {
      const res = await getDiagnosticsOverview();
      const body = await parseJson(res);
      if (!res.ok) {
        if (await handleSessionFailure(res, body)) {
          setData(null);
          return;
        }
        setData(null);
        setMsg({
          type: "error",
          text: String(body.error ?? "Failed to load diagnostics."),
        });
        return;
      }
      const d = body.data as OverviewData | undefined;
      if (!d) {
        setData(null);
        setMsg({ type: "error", text: "Invalid diagnostics response." });
        return;
      }
      setData(d);
    } catch {
      setData(null);
      setMsg({ type: "error", text: "Network error loading diagnostics." });
    } finally {
      setLoading(false);
    }
  }, [handleSessionFailure]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="review-view diagnostics-page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Diagnostics
        </h2>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <p className="muted">
        Store-scoped execution aggregates and recent <code>lk_system_diagnostics</code> rows for this
        operator store plus <strong>global</strong> rows (<code>store_id</code> null). See meta notes
        below for limits.
      </p>

      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : null}
      <Msg type={msg.type} text={msg.text} />

      {data ? (
        <>
          <div className="diag-meta card">
            <h3 className="section-title">Scope & limits</h3>
            <ul className="muted" style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12 }}>
              {data.meta.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            <p className="mono muted" style={{ fontSize: 12, margin: 0 }}>
              store_id: {data.meta.store_id} · run window: {data.meta.execution_runs_window_days}d ·
              runs rows: {data.meta.execution_runs_rows_used} / cap {data.meta.execution_runs_row_cap}{" "}
              · diagnostics rows: {data.meta.system_diagnostics_rows_returned} / cap{" "}
              {data.meta.system_diagnostics_row_cap}
            </p>
          </div>

          {data.queue_health ? (
            <QueueHealthSection qh={data.queue_health} />
          ) : (
            <div className="card msg warn" style={{ marginTop: 12 }}>
              Queue health not returned by API — deploy updated API for live queue/worker snapshot.
            </div>
          )}

          {data.trends ? (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 className="section-title">Execution trends (this store)</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                UTC buckets from the last {data.trends.lookback_days} days of data (capped). Compare
                recent buckets to see load and failure drift. Manual marks are{" "}
                <code>mark_for_manual_review</code> actions (by action time).
              </p>
              <ul className="muted" style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12 }}>
                {data.trends.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              {(data.trends.runs_cap_hit || data.trends.manual_actions_cap_hit) && (
                <div className="msg warn" style={{ marginBottom: 12 }}>
                  Trend source data hit a row cap
                  {data.trends.runs_cap_hit ? " (runs)" : ""}
                  {data.trends.runs_cap_hit && data.trends.manual_actions_cap_hit ? " and" : ""}
                  {data.trends.manual_actions_cap_hit ? " (manual actions)" : ""} — older events may be
                  missing. Totals may undercount busy stores.
                </div>
              )}
              <p className="mono muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                trend runs: {data.trends.runs_rows_used} / cap {data.trends.runs_row_cap} · manual
                actions: {data.trends.manual_actions_rows_used} / cap {data.trends.manual_actions_row_cap}
              </p>
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Window:
                </span>
                {TREND_WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={trendWindow === w ? undefined : "secondary"}
                    onClick={() => setTrendWindow(w)}
                  >
                    {w === "24h" ? "Last 24h" : w === "7d" ? "Last 7d" : "Last 30d"}
                  </button>
                ))}
              </div>
              {(() => {
                const tw = data.trends.windows[trendWindow];
                if (!tw?.points?.length) {
                  return <p className="muted">No trend buckets for this window.</p>;
                }
                const sumRuns = tw.points.reduce((s, p) => s + p.runs, 0);
                if (sumRuns === 0 && tw.points.every((p) => p.manual_review_marks === 0)) {
                  return (
                    <p className="muted">
                      No runs or manual-review marks in this window (UTC). Try a longer window or
                      refresh after activity.
                    </p>
                  );
                }
                return (
                  <>
                    <p className="muted" style={{ fontSize: 12 }}>
                      Granularity: <strong>{tw.granularity}</strong> · buckets: {tw.bucket_count} ·
                      window start (UTC): <span className="mono">{tw.window_start_utc}</span>
                    </p>
                    <div className="trend-spark-block">
                      <TrendBars points={tw.points} field="runs" label="Runs" />
                      <TrendBars points={tw.points} field="failures" label="Failures" />
                      <TrendBars points={tw.points} field="retryable_failures" label="Retryable fails" />
                      <TrendBars
                        points={tw.points}
                        field="non_retryable_failures"
                        label="Non-retryable fails"
                      />
                      <TrendBars
                        points={tw.points}
                        field="manual_review_marks"
                        label="Manual review marks"
                      />
                    </div>
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table className="diag-table trend-table">
                        <thead>
                          <tr>
                            <th>Bucket (UTC)</th>
                            <th>Runs</th>
                            <th>Failures</th>
                            <th>Retryable</th>
                            <th>Non-retry</th>
                            <th>Manual marks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tw.points.map((p, i) => (
                            <tr key={i}>
                              <td className="mono" style={{ whiteSpace: "nowrap" }}>
                                {p.label}
                              </td>
                              <td>{p.runs}</td>
                              <td>{p.failures}</td>
                              <td>{p.retryable_failures}</td>
                              <td>{p.non_retryable_failures}</td>
                              <td>{p.manual_review_marks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {data.trends.mlcc_failed_by_signal_rollup?.[trendWindow] &&
                    Object.keys(data.trends.mlcc_failed_by_signal_rollup[trendWindow]).length > 0 ? (
                      <div style={{ marginTop: 16 }}>
                        <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
                          MLCC signals in this trend window (failed runs with resolved signal)
                        </h4>
                        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                          Rollup sums per-bucket counts from the table above. Same run is not counted
                          across windows; cap may omit older runs.
                        </p>
                        <table className="diag-table" style={{ maxWidth: 560 }}>
                          <thead>
                            <tr>
                              <th>mlcc_signal</th>
                              <th>Count (rollup)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entriesSorted(
                              data.trends.mlcc_failed_by_signal_rollup[trendWindow] as Record<
                                string,
                                number
                              >,
                            ).map(([sig, c]) => (
                              <tr key={sig}>
                                <td className="mono">{sig}</td>
                                <td>{c}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="card msg warn" style={{ marginTop: 12 }}>
              Trend series not available from API (upgrade API to get 24h / 7d / 30d buckets).
            </div>
          )}

          {data.mlcc_diagnostics ? (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 className="section-title">MLCC failure signals (execution window)</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Uses <code>failure_details.mlcc_signal</code> when set by workers, otherwise the same
                inference rules as operator review. Only <strong>failed</strong> runs that resolve to a
                signal are counted.
              </p>
              <ul className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                {data.mlcc_diagnostics.interpretation_notes.slice(0, 4).map((n, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {n}
                  </li>
                ))}
              </ul>
              <div className="diag-cards">
                <div className="card diag-card">
                  <div className="diag-card-label">Failed runs w/ MLCC signal</div>
                  <div className="diag-card-value">
                    {data.mlcc_diagnostics.failed_runs_with_resolved_mlcc_signal}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Explicit signal on row</div>
                  <div className="diag-card-value">
                    {data.mlcc_diagnostics.failed_runs_explicit_mlcc_signal}
                  </div>
                  <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
                    Stored in <code>failure_details.mlcc_signal</code>
                  </p>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Inferred signal</div>
                  <div className="diag-card-value">
                    {data.mlcc_diagnostics.failed_runs_inferred_mlcc_signal}
                  </div>
                  <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
                    From message / stage / failure_type
                  </p>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Multi-failed-attempt + MLCC (terminal)</div>
                  <div className="diag-card-value">
                    {
                      data.mlcc_diagnostics
                        .failed_runs_multi_failed_attempt_with_resolved_mlcc_signal
                    }
                  </div>
                  <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
                    Failed run row + 2+ failed attempts stored
                  </p>
                </div>
              </div>
              {entriesSorted(data.mlcc_diagnostics.counts_by_mlcc_signal).length === 0 ? (
                <p className="muted">No failed runs in the window resolved to an mlcc_signal.</p>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Counts by mlcc_signal</h4>
                  <table className="diag-table" style={{ maxWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Label</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entriesSorted(data.mlcc_diagnostics.counts_by_mlcc_signal).map(
                        ([sig, c]) => (
                          <tr key={sig}>
                            <td className="mono">{sig}</td>
                            <td>
                              {(data.mlcc_diagnostics?.signal_labels ?? {})[sig] ?? "—"}
                            </td>
                            <td>{c}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {data.mlcc_diagnostics.recent_failed_with_mlcc_signal.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Recent failed runs (with signal)</h4>
                  <table className="diag-table trend-table">
                    <thead>
                      <tr>
                        <th>When (UTC)</th>
                        <th>run_id</th>
                        <th>signal</th>
                        <th>source</th>
                        <th>failure_type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.mlcc_diagnostics.recent_failed_with_mlcc_signal.map((r) => (
                        <tr key={r.run_id}>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>
                            {r.created_at ?? "—"}
                          </td>
                          <td className="mono">{r.run_id}</td>
                          <td className="mono">{r.mlcc_signal}</td>
                          <td>{r.signal_source}</td>
                          <td className="mono">{r.failure_type ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {data.attempt_history_insights ? (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 className="section-title">Stored attempt history (same window as run sample)</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Derived only from <code>execution_run_attempts</code> joined to runs in the capped window.
                Rates exclude queued/running/canceled where noted.
              </p>
              <ul className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                {data.attempt_history_insights.interpretation_notes.slice(0, 3).map((n, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {n}
                  </li>
                ))}
              </ul>
              <div className="diag-cards">
                <div className="card diag-card">
                  <div className="diag-card-label">Avg attempts / run (with history)</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.avg_attempts_per_run_with_history != null
                      ? data.attempt_history_insights.avg_attempts_per_run_with_history.toFixed(2)
                      : "—"}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Runs with 2+ attempts</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.runs_with_more_than_one_attempt}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">2+ failed attempts (stored)</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.runs_with_two_or_more_failed_attempts}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Repeated same stored failure</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.runs_with_repeated_same_stored_failure}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Multi-attempt success rate</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.multi_attempt_success_rate != null
                      ? `${(data.attempt_history_insights.multi_attempt_success_rate * 100).toFixed(1)}%`
                      : "—"}
                  </div>
                  <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
                    succeeded / (succeeded+failed) for runs with 2+ attempts
                  </p>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">First-attempt-only success</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.first_attempt_only_success_runs}
                  </div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Succeeded after failed attempt</div>
                  <div className="diag-card-value">
                    {data.attempt_history_insights.eventual_success_after_failed_attempt_runs}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="diag-cards">
            <div className="card diag-card">
              <div className="diag-card-label">Runs in window</div>
              <div className="diag-card-value">{sumValues(data.execution_runs.by_status)}</div>
            </div>
            <div className="card diag-card">
              <div className="diag-card-label">Failed (retryable)</div>
              <div className="diag-card-value">{data.execution_runs.failed_retryable_count}</div>
            </div>
            <div className="card diag-card">
              <div className="diag-card-label">Failed (not retryable)</div>
              <div className="diag-card-value">{data.execution_runs.failed_non_retryable_count}</div>
            </div>
            <div className="card diag-card">
              <div className="diag-card-label">Diagnostic rows</div>
              <div className="diag-card-value">{data.recent_system_diagnostics.length}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Execution runs by status</h3>
            {entriesSorted(data.execution_runs.by_status).length === 0 ? (
              <p className="muted">No runs in window.</p>
            ) : (
              <table className="diag-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesSorted(data.execution_runs.by_status).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Failed runs by failure_type</h3>
            {entriesSorted(data.execution_runs.failed_by_failure_type).length === 0 ? (
              <p className="muted">No failed runs with failure_type in window.</p>
            ) : (
              <table className="diag-table">
                <thead>
                  <tr>
                    <th>failure_type</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesSorted(data.execution_runs.failed_by_failure_type).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Operator session events</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              From <code>lk_system_diagnostics</code> where <code>payload.kind</code> is{" "}
              <code>operator_session</code> (same query window as recent list; may be sparse).
            </p>
            {data.operator_session_events.length === 0 ? (
              <p className="muted">None in the returned batch.</p>
            ) : (
              <ul className="diag-list">
                {data.operator_session_events.map((row) => (
                  <li key={row.id} className="diag-list-item">
                    <div className="diag-list-head">
                      <span className={`scope-pill ${row.scope}`}>{row.scope}</span>
                      <span className="muted mono">{row.created_at}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 12 }}>
                      {row.kind ?? "—"} · source {row.source ?? "—"}
                    </div>
                    {row.payload_preview ? (
                      <pre className="diag-pre">{row.payload_preview}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Recent system diagnostics</h3>
            {data.recent_system_diagnostics.length === 0 ? (
              <p className="muted">No rows returned.</p>
            ) : (
              <ul className="diag-list">
                {data.recent_system_diagnostics.map((row) => (
                  <li key={row.id} className="diag-list-item">
                    <div className="diag-list-head">
                      <span className={`scope-pill ${row.scope}`}>{row.scope}</span>
                      <span className="muted mono">{row.created_at}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 12 }}>
                      {row.kind ?? "—"} · {row.source ?? "—"}
                    </div>
                    {row.payload_preview ? (
                      <pre className="diag-pre">{row.payload_preview}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
