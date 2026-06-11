import { useNavigate } from "react-router-dom";
import { DeckHeader, DeckPage } from "../deck/DeckUi";
import { RunQueuePanel } from "../operator-review/RunQueuePanel";
import { useReviewRuns } from "./ReviewRunsContext";

export function ReviewQueueView() {
  const navigate = useNavigate();
  const ctx = useReviewRuns();

  return (
    <DeckPage>
      <DeckHeader
        title="Review queue"
        subtitle="UPC execution runs — triage failures, bulk acknowledge, and open run detail."
        icon="queue"
        onRefresh={() => void ctx.loadRuns({ silentSuccess: true })}
        loading={ctx.loadingRuns}
      />
      <RunQueuePanel
        statusFilter={ctx.statusFilter}
        setStatusFilter={ctx.setStatusFilter}
        failureTypeFilter={ctx.failureTypeFilter}
        setFailureTypeFilter={ctx.setFailureTypeFilter}
        pendingManualFilter={ctx.pendingManualFilter}
        setPendingManualFilter={ctx.setPendingManualFilter}
        cartIdFilter={ctx.cartIdFilter}
        setCartIdFilter={ctx.setCartIdFilter}
        queueSearch={ctx.queueSearch}
        setQueueSearch={ctx.setQueueSearch}
        autoRefreshEnabled={ctx.autoRefreshEnabled}
        setAutoRefreshEnabled={ctx.setAutoRefreshEnabled}
        autoRefreshSec={ctx.autoRefreshSec}
        setAutoRefreshSec={ctx.setAutoRefreshSec}
        loadingRuns={ctx.loadingRuns}
        actionInFlight={ctx.actionInFlight}
        runs={ctx.runs}
        filteredRuns={ctx.filteredRuns}
        selectedRunId={ctx.selectedRunId}
        listMsg={ctx.listMsg}
        onSelectRun={(id) => {
          ctx.setSelectedRunId(id);
          navigate(`/review/${encodeURIComponent(id)}`);
        }}
        onLoadRuns={() => void ctx.loadRuns({ resetPage: true })}
        onRefresh={() => void ctx.loadRuns({ silentSuccess: true })}
        onResetFilters={ctx.resetFilters}
        queueSortMode={ctx.queueSortMode}
        setQueueSortMode={ctx.setQueueSortMode}
        resumeRunId={ctx.resumeRunId}
        bulkSelectedRunIds={ctx.bulkSelectedRunIds}
        onToggleBulkRunId={ctx.toggleBulkRunId}
        onClearBulkSelection={ctx.clearBulkSelection}
        onAddToBulkSelection={ctx.addToBulkSelection}
        onBulkAcknowledge={() => void ctx.submitBulkTriage("acknowledge")}
        onBulkMarkManual={() => void ctx.submitBulkTriage("mark_for_manual_review")}
        queuePageLimit={ctx.queuePageLimit}
        setQueuePageLimit={ctx.setQueuePageLimit}
        listPageMeta={ctx.listPageMeta}
        loadNextPage={ctx.loadNextPage}
        loadPrevPage={ctx.loadPrevPage}
        hasNextPage={ctx.hasNextPage}
        hasPrevPage={ctx.hasPrevPage}
      />
    </DeckPage>
  );
}
