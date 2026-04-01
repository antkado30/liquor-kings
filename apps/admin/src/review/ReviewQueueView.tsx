import { useNavigate } from "react-router-dom";
import { RunQueuePanel } from "../operator-review/RunQueuePanel";
import { useReviewRuns } from "./ReviewRunsContext";

export function ReviewQueueView() {
  const navigate = useNavigate();
  const ctx = useReviewRuns();

  return (
    <div className="review-view">
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
        onLoadRuns={() => void ctx.loadRuns()}
        onRefresh={() => void ctx.loadRuns({ silentSuccess: true })}
        onResetFilters={ctx.resetFilters}
      />
    </div>
  );
}
