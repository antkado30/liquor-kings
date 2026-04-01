import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { failureGuidanceText } from "../lib/failureGuidance";
import {
  filterRunIdsFailedRetryable,
  filterRunIdsManualReviewCandidates,
  partitionForBulkAcknowledge,
  partitionForBulkMarkManual,
} from "./bulkTriageEligibility";
import { FailureBadge, StatusBadge } from "./components/Badges";
import { Msg } from "./components/Msg";
import {
  priorityReason,
  queuedAgeMinutes,
  QUEUED_OLD_MINUTES_WARN,
  sortRunsForQueue,
  type QueueSortMode,
} from "./queuePrioritization";
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
  queueSortMode: QueueSortMode;
  setQueueSortMode: (v: QueueSortMode) => void;
  resumeRunId: string | null;
  queuePageLimit: number;
  setQueuePageLimit: (n: number) => void;
  listPageMeta: {
    limit: number;
    offset: number;
    rowCount: number;
    totalCount: number | null;
  };
  loadNextPage: () => void;
  loadPrevPage: () => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  bulkSelectedRunIds: string[];
  onToggleBulkRunId: (runId: string) => void;
  onClearBulkSelection: () => void;
  onAddToBulkSelection: (runIds: string[]) => void;
  onBulkAcknowledge: () => void;
  onBulkMarkManual: () => void;
};

function runCardPriorityClass(row: RunSummaryRow): string {
  if (row.pending_manual_review) return "priority-band-critical";
  if (row.status === "failed" && row.retry_allowed) return "priority-band-high";
  if (row.status === "failed") return "priority-band-failed";
  if (row.status === "running") return "priority-band-running";
  if (row.status === "queued") {
    const q = queuedAgeMinutes(row);
    if (q != null && q >= QUEUED_OLD_MINUTES_WARN) return "priority-band-queued-old";
  }
  return "priority-band-default";
}

function RunQueuePanelInner({
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
  queueSortMode,
  setQueueSortMode,
  resumeRunId,
  queuePageLimit,
  setQueuePageLimit,
  listPageMeta,
  loadNextPage,
  loadPrevPage,
  hasNextPage,
  hasPrevPage,
  bulkSelectedRunIds,
  onToggleBulkRunId,
  onClearBulkSelection,
  onAddToBulkSelection,
  onBulkAcknowledge,
  onBulkMarkManual,
}: Props) {
  const displayRuns = useMemo(
    () => sortRunsForQueue(filteredRuns, queueSortMode),
    [filteredRuns, queueSortMode],
  );

  const bulkSet = useMemo(() => new Set(bulkSelectedRunIds), [bulkSelectedRunIds]);
  const ackBulk = useMemo(
    () => partitionForBulkAcknowledge(bulkSelectedRunIds, runs),
    [bulkSelectedRunIds, runs],
  );
  const manualBulk = useMemo(
    () => partitionForBulkMarkManual(bulkSelectedRunIds, runs),
    [bulkSelectedRunIds, runs],
  );
  const visibleBulkCount = useMemo(
    () => displayRuns.reduce((n, r) => n + (bulkSet.has(r.run_id) ? 1 : 0), 0),
    [displayRuns, bulkSet],
  );
  const hiddenInViewCount = Math.max(0, bulkSelectedRunIds.length - visibleBulkCount);
  const failedRetryableIds = useMemo(
    () => filterRunIdsFailedRetryable(filteredRuns),
    [filteredRuns],
  );
  const manualReviewCandidateIds = useMemo(
    () => filterRunIdsManualReviewCandidates(filteredRuns),
    [filteredRuns],
  );

  return (
    <section className="card">
      <h3 className="section-title">Run queue</h3>
      <p className="muted review-persist-hint" style={{ fontSize: 12, marginTop: 4 }}>
        Sort, auto-refresh, server filters, cart filter, queue search, and server page size persist in
        this browser for the current store (localStorage key{" "}
        <code className="mono">lk-admin-review-ui:v1:{"<storeId>"}</code>
        ). Current server page offset is not persisted (starts at 0 after reload). Reset filters
        clears filters, search, bulk selection, resume link, and jumps to server offset 0 — not sort,
        auto-refresh, or page size.
      </p>
      {resumeRunId ? (
        <div className="review-resume-row">
          <Link to={`/review/${encodeURIComponent(resumeRunId)}`}>Continue last opened run</Link>
          <span className="muted"> — still in the current loaded batch</span>
        </div>
      ) : null}
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
          title="Clears server filters, cart filter, queue search, bulk selection, last-opened resume link, and server page offset. Keeps sort mode, auto-refresh, and page size."
        >
          Reset filters
        </button>
      </div>
      <div className="row queue-server-page-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <label>Server page size</label>
        <select
          value={queuePageLimit}
          onChange={(e) => setQueuePageLimit(Number(e.target.value))}
          disabled={loadingRuns || actionInFlight}
          title="Rows per request to GET /api/runs (newest first). Changing this reloads offset 0."
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <button
          type="button"
          className="secondary"
          disabled={!hasPrevPage || loadingRuns || actionInFlight}
          onClick={loadPrevPage}
          title="Older runs (higher offset)"
        >
          Previous page
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!hasNextPage || loadingRuns || actionInFlight}
          onClick={loadNextPage}
          title="Next chunk; enabled only when this page returned a full page (there may or may not be more)"
        >
          Next page
        </button>
        <span className="muted" style={{ fontSize: 12, flex: "1 1 240px" }}>
          Server page: offset {listPageMeta.offset}, page size {listPageMeta.limit},{" "}
          {listPageMeta.rowCount} row(s) in this response (newest first).
          {listPageMeta.totalCount != null ? (
            <>
              {" "}
              <strong>{listPageMeta.totalCount}</strong> total matching current server filters
              {pendingManualFilter !== "" ? (
                <span> (includes pending-manual semantics from API).</span>
              ) : (
                <span> (status / failure / cart / store).</span>
              )}
            </>
          ) : (
            <span> Total count not reported by API.</span>
          )}{" "}
          Client: <strong>{filteredRuns.length}</strong> visible after queue search — only narrows this
          page, not the full result set.
        </span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Sort</label>
        <select
          value={queueSortMode}
          onChange={(e) => setQueueSortMode(e.target.value as QueueSortMode)}
          disabled={loadingRuns}
        >
          <option value="priority">Priority (triage)</option>
          <option value="newest">Newest first</option>
          <option value="failed_only">Failed only (by priority)</option>
        </select>
      </div>
      <p className="muted queue-sort-hint" style={{ fontSize: 12, margin: "4px 0 0" }}>
        {queueSortMode === "priority" && (
          <>
            Client sort: manual review &amp; failed (retryable first) ahead of running &amp; queued;
            long-wait queued runs bubble up. Tie-break: newest <code>created_at</code> in batch.
          </>
        )}
        {queueSortMode === "newest" && <>API order overridden: newest <code>created_at</code> first.</>}
        {queueSortMode === "failed_only" && (
          <>Only <code>failed</code> rows from the loaded list; then same priority tiers among failures.</>
        )}
      </p>
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
      <div className="bulk-triage-bar">
        <div className="bulk-triage-summary">
          <strong>Bulk triage</strong>
          <span className="muted">Selection applies to the loaded batch; Load/Refresh drops IDs no longer returned.</span>
        </div>
        <div className="bulk-triage-stats" aria-live="polite">
          <div className="stat-line">
            <strong>{bulkSelectedRunIds.length}</strong> selected{" "}
            <span className="stat-muted">of {runs.length} loaded</span>
          </div>
          <div className="stat-line">
            Acknowledge: <strong>{ackBulk.eligible.length}</strong> eligible ·{" "}
            <span className="stat-muted">{ackBulk.skipped.length} ineligible</span>
          </div>
          <div className="stat-line">
            Mark manual: <strong>{manualBulk.eligible.length}</strong> eligible ·{" "}
            <span className="stat-muted">{manualBulk.skipped.length} ineligible</span>
          </div>
          {bulkSelectedRunIds.length > 0 ? (
            <div className="stat-line">
              List view: <strong>{visibleBulkCount}</strong> selected
              {hiddenInViewCount > 0 ? (
                <>
                  {" "}
                  · <span className="stat-muted">{hiddenInViewCount} not in current view (search/sort)</span>
                </>
              ) : (
                <span className="stat-muted"> (all visible)</span>
              )}
            </div>
          ) : null}
        </div>
        <div className="bulk-triage-actions row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="secondary"
            disabled={loadingRuns || actionInFlight || displayRuns.length === 0}
            onClick={() => onAddToBulkSelection(displayRuns.map((r) => r.run_id))}
          >
            Add visible ({displayRuns.length})
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loadingRuns || actionInFlight || failedRetryableIds.length === 0}
            title="Union into selection: failed runs with retry_allowed in the current filtered list."
            onClick={() => onAddToBulkSelection(failedRetryableIds)}
          >
            Add failed · retryable ({failedRetryableIds.length})
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loadingRuns || actionInFlight || manualReviewCandidateIds.length === 0}
            title="Union into selection: manual_review_recommended or pending_manual_review, excluding terminal statuses."
            onClick={() => onAddToBulkSelection(manualReviewCandidateIds)}
          >
            Add manual candidates ({manualReviewCandidateIds.length})
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loadingRuns || actionInFlight || bulkSelectedRunIds.length === 0}
            onClick={onClearBulkSelection}
          >
            Clear selection
          </button>
          <button
            type="button"
            disabled={
              loadingRuns || actionInFlight || ackBulk.eligible.length === 0 || bulkSelectedRunIds.length === 0
            }
            onClick={() => void onBulkAcknowledge()}
            title={
              ackBulk.eligible.length === 0 && bulkSelectedRunIds.length > 0
                ? "No selected runs are eligible (see hint below)."
                : undefined
            }
          >
            Acknowledge ({ackBulk.eligible.length} eligible)
          </button>
          <button
            type="button"
            disabled={
              loadingRuns ||
              actionInFlight ||
              manualBulk.eligible.length === 0 ||
              bulkSelectedRunIds.length === 0
            }
            onClick={() => void onBulkMarkManual()}
            title={
              manualBulk.eligible.length === 0 && bulkSelectedRunIds.length > 0
                ? "No selected runs are eligible (see hint below)."
                : undefined
            }
          >
            Mark manual ({manualBulk.eligible.length} eligible)
          </button>
        </div>
      </div>
      <p className="muted bulk-eligibility-hint" style={{ fontSize: 12, marginTop: 4 }}>
        Quick adds merge into selection (current filtered list). <strong>Add failed · retryable</strong> uses{" "}
        <code>status=failed</code> + <code>retry_allowed</code>. <strong>Add manual candidates</strong> uses{" "}
        <code>manual_review_recommended</code> or <code>pending_manual_review</code> (non-terminal). Eligibility
        columns are client-side triage; each run is validated on submit. <strong>Acknowledge</strong>: queued,
        running, or failed only. <strong>Mark manual</strong>: skips terminal runs and already-flagged manual.
        Optional <strong>reason</strong>/<strong>note</strong> in run detail apply to every bulk request.{" "}
        <strong>Bulk resolve_without_retry</strong> stays unavailable.
      </p>
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
        ) : queueSortMode === "failed_only" && displayRuns.length === 0 ? (
          <div className="empty-state">
            <strong>No failed runs</strong>
            In this loaded batch nothing has status failed. Widen filters or use another sort.
          </div>
        ) : (
          displayRuns.map((row) => {
            const hint = failureGuidanceText(row.failure_type);
            const band = runCardPriorityClass(row);
            const reason = priorityReason(row);
            return (
              <div
                key={row.run_id}
                className={`run-card run-card-with-bulk ${band}${row.pending_manual_review ? " pending-review" : ""}${selectedRunId === row.run_id ? " selected" : ""}${bulkSet.has(row.run_id) ? " run-card-bulk-selected" : ""}`}
              >
                <label
                  className="run-card-check"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={bulkSet.has(row.run_id)}
                    onChange={() => onToggleBulkRunId(row.run_id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select run ${row.run_id} for bulk triage`}
                  />
                </label>
                <div
                  className="run-card-main"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRun(row.run_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelectRun(row.run_id);
                  }}
                >
                  <div>
                    <div className="queue-priority-row">
                      <span className="queue-priority-chip">{reason}</span>
                    </div>
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
                    {(row.stored_attempt_count ?? 0) > 0 ? (
                      <div className="ids mono" style={{ fontSize: 12 }}>
                        Stored attempts: {row.stored_attempt_count}
                        {row.has_multiple_stored_attempts ? " · multiple" : ""}
                        {row.repeated_same_stored_failure
                          ? " · repeated same stored failure (type+message)"
                          : ""}
                      </div>
                    ) : null}
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
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** Memoized: parent re-renders from router/shell should not re-render the full queue tree unnecessarily. */
export const RunQueuePanel = memo(RunQueuePanelInner);
