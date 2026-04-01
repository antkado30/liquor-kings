import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDiagnosticsOverview, getRuns, parseJson } from "../api/operatorReview";
import { Msg } from "../operator-review/components/Msg";
import { buildQuery } from "../operator-review/utils";
import { useOperatorSession } from "../session/OperatorSessionContext";
import type { FlashKind } from "../operator-review/types";
import type { OverviewData } from "./DiagnosticsPage";

function MlccDiagCards({ md }: { md: NonNullable<OverviewData["mlcc_diagnostics"]> }) {
  const top = Object.entries(md.counts_by_mlcc_signal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <div className="diag-cards" style={{ marginTop: 12 }}>
      <div className="card diag-card">
        <div className="diag-card-label">MLCC failed (resolved signal)</div>
        <div className="diag-card-value">{md.failed_runs_with_resolved_mlcc_signal}</div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          explicit {md.failed_runs_explicit_mlcc_signal} · inferred {md.failed_runs_inferred_mlcc_signal}
        </p>
      </div>
      <div className="card diag-card">
        <div className="diag-card-label">Top MLCC signal</div>
        <div className="diag-card-value" style={{ fontSize: 16 }}>
          {top[0] ? (
            <span className="mono">{top[0][0]}</span>
          ) : (
            "—"
          )}
        </div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          {top[0] ? `${md.signal_labels[top[0][0]] ?? top[0][0]} (${top[0][1]})` : "No signals in window"}
        </p>
      </div>
      <div className="card diag-card">
        <div className="diag-card-label">Multi-fail attempts + MLCC</div>
        <div className="diag-card-value">
          {md.failed_runs_multi_failed_attempt_with_resolved_mlcc_signal}
        </div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          Terminal failed run + 2+ failed attempts
        </p>
      </div>
    </div>
  );
}

function AttemptInsightCards({ ah }: { ah: NonNullable<OverviewData["attempt_history_insights"]> }) {
  return (
    <div className="diag-cards" style={{ marginTop: 12 }}>
      <div className="card diag-card">
        <div className="diag-card-label">Avg attempts (with history)</div>
        <div className="diag-card-value">
          {ah.avg_attempts_per_run_with_history != null ? ah.avg_attempts_per_run_with_history.toFixed(2) : "—"}
        </div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          Window sample · stored rows only
        </p>
      </div>
      <div className="card diag-card">
        <div className="diag-card-label">Runs with 2+ attempts</div>
        <div className="diag-card-value">{ah.runs_with_more_than_one_attempt}</div>
      </div>
      <div className="card diag-card">
        <div className="diag-card-label">Repeated same stored failure</div>
        <div className="diag-card-value">{ah.runs_with_repeated_same_stored_failure}</div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          Same failure_type + message on 2+ failed attempts
        </p>
      </div>
      <div className="card diag-card">
        <div className="diag-card-label">Multi-attempt success rate</div>
        <div className="diag-card-value">
          {ah.multi_attempt_success_rate != null
            ? `${(ah.multi_attempt_success_rate * 100).toFixed(1)}%`
            : "—"}
        </div>
        <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>
          Terminal succeeded vs failed (2+ attempts)
        </p>
      </div>
    </div>
  );
}

/**
 * Landing overview: combines diagnostics overview (queue health, retryable failed counts in window,
 * session events) with a single list API call for global pending-manual queue size (total_count).
 * Uses diagnostics overview API (including MLCC and attempt insights when available).
 */
export function OperatorOverviewPage() {
  const { handleSessionFailure } = useOperatorSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [pendingManualTotal, setPendingManualTotal] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ type: FlashKind; text: string }>({ type: "", text: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setMsg({ type: "", text: "" });
    const pendingQuery = buildQuery({
      pending_manual_review: "true",
      limit: "1",
      offset: "0",
    });
    try {
      const [resDiag, resPending] = await Promise.all([
        getDiagnosticsOverview(),
        getRuns(pendingQuery),
      ]);
      const bodyDiag = await parseJson(resDiag);
      const bodyPending = await parseJson(resPending);

      if (!resDiag.ok) {
        if (await handleSessionFailure(resDiag, bodyDiag)) {
          setData(null);
          setPendingManualTotal(null);
          return;
        }
        setData(null);
        setPendingManualTotal(null);
        setMsg({
          type: "error",
          text: String(bodyDiag.error ?? "Failed to load diagnostics."),
        });
        return;
      }

      const d = bodyDiag.data as OverviewData | undefined;
      if (!d) {
        setData(null);
        setPendingManualTotal(null);
        setMsg({ type: "error", text: "Invalid diagnostics response." });
        return;
      }
      setData(d);

      if (!resPending.ok) {
        if (await handleSessionFailure(resPending, bodyPending)) {
          setPendingManualTotal(null);
          return;
        }
        setPendingManualTotal(null);
        setMsg({
          type: "warn",
          text: String(
            bodyPending.error ??
              "Could not load pending-manual queue count; other overview data is shown.",
          ),
        });
      } else {
        const raw = (bodyPending as { total_count?: unknown }).total_count;
        setPendingManualTotal(typeof raw === "number" && Number.isFinite(raw) ? raw : null);
      }
    } catch {
      setData(null);
      setPendingManualTotal(null);
      setMsg({ type: "error", text: "Network error loading overview." });
    } finally {
      setLoading(false);
    }
  }, [handleSessionFailure]);

  useEffect(() => {
    void load();
  }, [load]);

  const qh = data?.queue_health;

  return (
    <div className="review-view operator-overview-page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Overview
        </h2>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Snapshot for the current store. Failed/retryable counts use the diagnostics time window and row
        cap (see <Link to="/diagnostics">Diagnostics</Link> for details). Pending manual total is the
        full queue size from the review list API.
      </p>

      {loading && !data ? <p className="muted">Loading…</p> : null}
      <Msg type={msg.type} text={msg.text} />

      {data ? (
        <>
          <section className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Needs attention now</h3>
            {qh && qh.warnings.length > 0 ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {qh.warnings.map((w) => (
                  <li key={w.code} className="msg warn" style={{ marginBottom: 8, listStyle: "none" }}>
                    <strong>{w.code}</strong> — {w.message}
                  </li>
                ))}
              </ul>
            ) : qh ? (
              <p className="msg success" style={{ marginTop: 8 }}>
                No queue health threshold warnings on this snapshot.
              </p>
            ) : (
              <p className="muted">Queue health not available from API.</p>
            )}
            {(qh?.likely_stuck_run_count ?? 0) > 0 || (qh?.stale_heartbeat_count ?? 0) > 0 ? (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                See live counts below; open <Link to="/diagnostics">Diagnostics</Link> for worker and
                heartbeat detail.
              </p>
            ) : null}
          </section>

          <div className="diag-cards" style={{ marginTop: 12 }}>
            <div className="card diag-card">
              <div className="diag-card-label">Pending manual review (queue)</div>
              <div className="diag-card-value">
                {pendingManualTotal != null ? pendingManualTotal : "—"}
              </div>
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
                Total runs with latest action <code>mark_for_manual_review</code> (list API).
              </p>
            </div>
            <div className="card diag-card">
              <div className="diag-card-label">Failed — retryable (window)</div>
              <div className="diag-card-value">{data.execution_runs.failed_retryable_count}</div>
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
                Within diagnostics run sample ({data.meta.execution_runs_window_days}d, capped).
              </p>
            </div>
            <div className="card diag-card">
              <div className="diag-card-label">Failed — not retryable (window)</div>
              <div className="diag-card-value">{data.execution_runs.failed_non_retryable_count}</div>
            </div>
            {data.attempt_history_insights ? (
              <AttemptInsightCards ah={data.attempt_history_insights} />
            ) : null}

            {data.mlcc_diagnostics ? (
              <section className="card" style={{ marginTop: 12 }}>
                <h3 className="section-title">MLCC failure signals (window)</h3>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  From stored <code>failure_details</code> + inference rules. See{" "}
                  <Link to="/diagnostics">Diagnostics</Link> for full breakdown and trends.
                </p>
                <MlccDiagCards md={data.mlcc_diagnostics} />
              </section>
            ) : null}

            {qh ? (
              <>
                <div className="card diag-card">
                  <div className="diag-card-label">Queued (live)</div>
                  <div className="diag-card-value">{qh.queued_count}</div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Running (live)</div>
                  <div className="diag-card-value">{qh.running_count}</div>
                </div>
                <div className="card diag-card">
                  <div className="diag-card-label">Likely stuck / stale HB</div>
                  <div className="diag-card-value" style={{ fontSize: 18 }}>
                    {qh.likely_stuck_run_count} / {qh.stale_heartbeat_count}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <section className="card" style={{ marginTop: 12 }}>
            <h3 className="section-title">Recent operator session activity</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              From system diagnostics (<code>operator_session</code>). Per-run actions are on each run’s
              detail screen.
            </p>
            {data.operator_session_events.length === 0 ? (
              <p className="muted">No session events in the returned batch.</p>
            ) : (
              <ul className="diag-list">
                {data.operator_session_events.slice(0, 12).map((row) => (
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
          </section>

          <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
            <Link to="/review">Review queue</Link> · <Link to="/diagnostics">Full diagnostics</Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
