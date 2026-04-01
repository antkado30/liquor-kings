import { failureGuidanceText } from "../lib/failureGuidance";
import { FailureBadge, StatusBadge } from "./components/Badges";
import { Msg } from "./components/Msg";
import type { FlashMsg, RunSummaryRow } from "./types";

type Props = {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  failureTypeFilter: string;
  setFailureTypeFilter: (v: string) => void;
  pendingManualFilter: string;
  setPendingManualFilter: (v: string) => void;
  cartIdFilter: string;
  setCartIdFilter: (v: string) => void;
  queueSearch: string;
  setQueueSearch: (v: string) => void;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (v: boolean) => void;
  autoRefreshSec: number;
  setAutoRefreshSec: (v: number) => void;
  loadingRuns: boolean;
  actionInFlight: boolean;
  runs: RunSummaryRow[];
  filteredRuns: RunSummaryRow[];
  selectedRunId: string | null;
  listMsg: FlashMsg;
  onSelectRun: (runId: string) => void;
  onLoadRuns: () => void;
  onRefresh: () => void;
  onResetFilters: () => void;
};

export function RunQueuePanel({
  statusFilter,
  setStatusFilter,
  failureTypeFilter,
  setFailureTypeFilter,
  pendingManualFilter,
  setPendingManualFilter,
  cartIdFilter,
  setCartIdFilter,
  queueSearch,
  setQueueSearch,
  autoRefreshEnabled,
  setAutoRefreshEnabled,
  autoRefreshSec,
  setAutoRefreshSec,
  loadingRuns,
  actionInFlight,
  runs,
  filteredRuns,
  selectedRunId,
  listMsg,
  onSelectRun,
  onLoadRuns,
  onRefresh,
  onResetFilters,
}: Props) {
  return (
    <section className="card">
      <h3 className="section-title">Run queue</h3>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">(all)</option>
          <option>queued</option>
          <option>running</option>
          <option>failed</option>
          <option>succeeded</option>
          <option>canceled</option>
        </select>
        <label>Failure type</label>
        <select value={failureTypeFilter} onChange={(e) => setFailureTypeFilter(e.target.value)}>
          <option value="">(all)</option>
          <option>CODE_MISMATCH</option>
          <option>OUT_OF_STOCK</option>
          <option>QUANTITY_RULE_VIOLATION</option>
          <option>MLCC_UI_CHANGE</option>
          <option>NETWORK_ERROR</option>
          <option>UNKNOWN</option>
        </select>
        <label>Pending manual</label>
        <select
          value={pendingManualFilter}
          onChange={(e) => setPendingManualFilter(e.target.value)}
        >
          <option value="">(all)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Cart ID</label>
        <input
          value={cartIdFilter}
          onChange={(e) => setCartIdFilter(e.target.value)}
          placeholder="Server filter (optional)"
        />
        <button type="button" onClick={onLoadRuns} disabled={loadingRuns || actionInFlight}>
          Load runs
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onRefresh}
          disabled={loadingRuns || actionInFlight}
        >
          Refresh
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onResetFilters}
          disabled={loadingRuns || actionInFlight}
        >
          Reset filters
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Search queue</label>
        <input
          style={{ flex: 1, minWidth: 200 }}
          value={queueSearch}
          onChange={(e) => setQueueSearch(e.target.value)}
          placeholder="Filter loaded list by run / cart ID"
        />
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
        <label className="row" style={{ gap: 4, margin: 0 }}>
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />
          Auto-refresh
        </label>
        <select value={autoRefreshSec} onChange={(e) => setAutoRefreshSec(Number(e.target.value))}>
          <option value={15}>every 15s</option>
          <option value={30}>every 30s</option>
          <option value={60}>every 60s</option>
        </select>
      </div>
      <Msg type={listMsg.type} text={listMsg.text} />
      <div className={`runs-list ${loadingRuns ? "loading" : ""}`}>
        {runs.length === 0 ? (
          <div className="empty-state">
            <strong>No runs loaded</strong>
            Set filters and Load runs, or Refresh.
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="empty-state">
            <strong>No queue matches</strong>
            Clear search or load a broader set.
          </div>
        ) : (
          filteredRuns.map((row) => {
            const hint = failureGuidanceText(row.failure_type);
            return (
              <div
                key={row.run_id}
                role="button"
                tabIndex={0}
                className={`run-card${row.pending_manual_review ? " pending-review" : ""}${selectedRunId === row.run_id ? " selected" : ""}`}
                onClick={() => onSelectRun(row.run_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelectRun(row.run_id);
                }}
              >
                <div>
                  <div className="primary-line">
                    <StatusBadge status={row.status} />
                    <FailureBadge ft={row.failure_type} />
                    <span className={row.retry_allowed ? "retry-yes" : "retry-no"}>
                      Retry: {row.retry_allowed ? "allowed" : "blocked"}
                    </span>
                  </div>
                  <div className="triage-row">
                    <strong>Next:</strong> {row.actionable_next_step ?? "—"} ·{" "}
                    <strong>Operator:</strong> {row.operator_status ?? "—"}
                  </div>
                  <div className="ids mono">Run {row.run_id}</div>
                  <div className="ids mono">Cart {row.cart_id ?? "—"}</div>
                  {hint ? <div className="hint">{hint}</div> : null}
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#6b7280" }}>
                  {row.pending_manual_review ? (
                    <>
                      <strong>MANUAL REVIEW</strong>
                      <br />
                    </>
                  ) : null}
                  Open →
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
