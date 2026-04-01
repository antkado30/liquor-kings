import { failureGuidanceText } from "../lib/failureGuidance";
import { FailureBadge, StatusBadge } from "./components/Badges";
import { EvidenceBlock } from "./components/EvidenceBlock";
import { Msg } from "./components/Msg";
import type { FlashMsg, OpAction, Summary } from "./types";

type Props = {
  selectedRunId: string | null;
  summary: Summary | null;
  evidenceItems: unknown[];
  opActions: OpAction[];
  loadingDetail: boolean;
  detailMsg: FlashMsg;
  reason: string;
  note: string;
  setReason: (v: string) => void;
  setNote: (v: string) => void;
  actionDisabled: boolean;
  canRetry: boolean;
  canResolve: boolean;
  canCancel: boolean;
  onSubmitAction: (action: string) => void;
};

export function RunDetailPanel({
  selectedRunId,
  summary,
  evidenceItems,
  opActions,
  loadingDetail,
  detailMsg,
  reason,
  note,
  setReason,
  setNote,
  actionDisabled,
  canRetry,
  canResolve,
  canCancel,
  onSubmitAction,
}: Props) {
  const retryAllowed = Boolean(summary?.retry_allowed);

  return (
    <section className="card">
      <h3 className="section-title">Run detail</h3>
      <p>
        <strong>Run ID:</strong> <span className="mono">{selectedRunId ?? "—"}</span>
      </p>

      <h4>Summary</h4>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!summary ? (
          <div className="empty-state">
            <strong>No run selected</strong>
            Choose a card from the queue.
          </div>
        ) : (
          <div className="detail-grid">
            <div className="kv">
              <strong>Status:</strong> <StatusBadge status={String(summary.status)} />
            </div>
            <div className="kv">
              <strong>Failure:</strong> <FailureBadge ft={summary.failure_type as string | null} />
            </div>
            <div className="kv">
              <strong>Retry count:</strong> {String(summary.retry_count)} / {String(summary.max_retries)}
            </div>
            <div className="kv">
              <strong>Retry allowed:</strong>{" "}
              <span className={retryAllowed ? "retry-yes" : "retry-no"}>
                {retryAllowed ? "yes" : "no"}
              </span>
            </div>
            <div className="kv">
              <strong>Operator status:</strong> {String(summary.operator_status ?? "—")}
            </div>
            <div className="kv">
              <strong>Pending manual:</strong> {summary.pending_manual_review ? "yes" : "no"}
            </div>
            <div className="kv">
              <strong>Next step:</strong> {String(summary.actionable_next_step ?? "—")}
            </div>
            <div className="kv">
              <strong>Progress stage:</strong> {String(summary.progress_stage ?? "—")}
            </div>
            <div className="kv">
              <strong>Progress message:</strong> {String(summary.progress_message ?? "—")}
            </div>
            <div className="kv">
              <strong>Failure message:</strong> {String(summary.failure_message ?? "—")}
            </div>
          </div>
        )}
      </div>
      {summary?.failure_type ? (
        <div className="failure-guidance">
          <strong>Suggested triage ({String(summary.failure_type)})</strong>{" "}
          {failureGuidanceText(String(summary.failure_type))}
        </div>
      ) : null}

      <h4>Timestamps</h4>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!summary?.timestamps ? (
          <div className="empty-state" style={{ padding: 12 }}>
            <strong>No run selected</strong>
          </div>
        ) : (
          <div className="detail-grid">
            {Object.entries(summary.timestamps as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="kv">
                <strong>{k}:</strong> {v == null ? "—" : String(v)}
              </div>
            ))}
          </div>
        )}
      </div>

      <h4>Evidence</h4>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!selectedRunId ? (
          <div className="empty-state">
            <strong>No run selected</strong>
          </div>
        ) : (
          <EvidenceBlock items={evidenceItems} />
        )}
      </div>

      <h4>Operator actions</h4>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!opActions.length ? (
          <div className="empty-state">
            <strong>No operator actions yet</strong>
          </div>
        ) : (
          <ul className="timeline">
            {opActions.map((item, i) => (
              <li key={i}>
                <div>
                  <strong>{item.action}</strong>{" "}
                  <span className="muted">{item.created_at ?? "—"}</span>
                </div>
                <div className="muted">actor: {item.actor_id ?? "unknown"}</div>
                <div className="muted">reason: {item.reason ?? "—"}</div>
                <div className="muted">note: {item.note ?? "—"}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h4>Action panel</h4>
      <div className="actions">
        {(
          [
            "acknowledge",
            "mark_for_manual_review",
            "retry_now",
            "cancel",
            "resolve_without_retry",
          ] as const
        ).map((a) => {
          let dis = actionDisabled;
          if (summary) {
            if (a === "retry_now" && !canRetry) dis = true;
            if (a === "resolve_without_retry" && !canResolve) dis = true;
            if (a === "cancel" && !canCancel) dis = true;
          }
          return (
            <button
              key={a}
              type="button"
              className={a === "cancel" ? "danger" : undefined}
              disabled={dis}
              onClick={() => onSubmitAction(a)}
            >
              {a}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="note (optional)"
        />
      </div>
      <Msg type={detailMsg.type} text={detailMsg.text} />
      <p className="muted">Actions follow server guardrails.</p>
    </section>
  );
}
