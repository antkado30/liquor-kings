import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { RunDetailPanel } from "../operator-review/RunDetailPanel";
import { useReviewRuns } from "./ReviewRunsContext";

export function ReviewRunDetailView() {
  const { runId } = useParams<{ runId: string }>();
  const ctx = useReviewRuns();
  const { loadRunDetail } = ctx;

  useEffect(() => {
    if (runId) void loadRunDetail(runId);
  }, [runId, loadRunDetail]);

  if (!runId) {
    return (
      <div className="review-view card">
        <p className="muted">Missing run id.</p>
        <Link to="/review">Back to queue</Link>
      </div>
    );
  }

  return (
    <div className="review-view">
      <div className="review-detail-toolbar">
        <Link to="/review" className="back-link">
          ← Review queue
        </Link>
        <span className="muted mono">{runId}</span>
      </div>
      <RunDetailPanel
        selectedRunId={runId}
        summary={ctx.detailSummary}
        evidenceItems={ctx.evidenceItems}
        attemptHistoryItems={ctx.attemptHistoryItems}
        opActions={ctx.opActions}
        loadingDetail={ctx.loadingDetail}
        detailMsg={ctx.detailMsg}
        reason={ctx.reason}
        note={ctx.note}
        setReason={ctx.setReason}
        setNote={ctx.setNote}
        actionDisabled={ctx.actionDisabled}
        canRetry={ctx.canRetry}
        canResolve={ctx.canResolve}
        canCancel={ctx.canCancel}
        onSubmitAction={(a) => void ctx.submitAction(a)}
      />
    </div>
  );
}
