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

type OverviewData = {
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
  recent_system_diagnostics: DiagRow[];
  operator_session_events: DiagRow[];
};

function sumValues(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function entriesSorted(o: Record<string, number>): [string, number][] {
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
}

export function DiagnosticsPage() {
  const { handleSessionFailure } = useOperatorSession();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [msg, setMsg] = useState<{ type: FlashKind; text: string }>({ type: "", text: "" });

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
