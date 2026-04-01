import { failureGuidanceText } from "../lib/failureGuidance";
import { FailureBadge, StatusBadge } from "./components/Badges";
import { EvidenceBlock } from "./components/EvidenceBlock";
import { Msg } from "./components/Msg";
import { AttemptHistorySection } from "./components/AttemptHistorySection";
import { RunLifecycleTimeline } from "./RunLifecycleTimeline";
import {
  getOperatorRecommendation,
  retryContextLines,
  type OperatorRecommendation,
} from "./runDetailRecommendation";
import type { ExecutionAttemptRow, FlashMsg, OpAction, Summary } from "./types";

const TIMESTAMP_ORDER = [
  "queued_at",
  "started_at",
  "heartbeat_at",
  "finished_at",
  "created_at",
  "updated_at",
];

function sortOpActionsChronological(actions: OpAction[]): OpAction[] {
  return [...actions].sort((a, b) => {
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    return ta.localeCompare(tb);
  });
}

type Props = {
  selectedRunId: string | null;
  summary: Summary | null;
  evidenceItems: unknown[];
  attemptHistoryItems: ExecutionAttemptRow[];
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
  attemptHistoryItems,
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
  const rec: OperatorRecommendation | null = summary ? getOperatorRecommendation(summary) : null;
  const sortedActions = sortOpActionsChronological(opActions);

  const tsEntries = summary?.timestamps
    ? (() => {
        const raw = summary.timestamps as Record<string, unknown>;
        const keys = new Set(Object.keys(raw));
        const ordered = TIMESTAMP_ORDER.filter((k) => keys.has(k));
        const rest = [...keys].filter((k) => !TIMESTAMP_ORDER.includes(k)).sort();
        return [...ordered, ...rest].map((k) => [k, raw[k]] as [string, unknown]);
      })()
    : [];

  return (
    <section className="card run-detail-panel">
      <h3 className="section-title">Run detail</h3>
      <p className="run-detail-ids">
        <strong>Run</strong> <span className="mono">{selectedRunId ?? "—"}</span>
        {summary?.cart_id ? (
          <>
            {" · "}
            <strong>Cart</strong> <span className="mono">{String(summary.cart_id)}</span>
          </>
        ) : null}
      </p>

      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!summary ? (
          <div className="empty-state">
            <strong>No run selected</strong>
            Choose a card from the queue.
          </div>
        ) : (
          <>
            {rec ? (
              <>
                <div className={`recommendation-banner recommendation-${rec.variant}`}>{rec.title}</div>
                <div className="recommendation-body">{rec.body}</div>
              </>
            ) : null}

            <h4 className="run-detail-h4">Lifecycle & timestamps</h4>
            <RunLifecycleTimeline summary={summary} />

            <h4 className="run-detail-h4">Clock times (UTC)</h4>
            <ul className="timestamp-list mono">
              {tsEntries.map(([k, v]) => (
                <li key={k}>
                  <span className="timestamp-key">{k}</span>{" "}
                  {v == null ? <span className="muted">—</span> : String(v)}
                </li>
              ))}
            </ul>

            <h4 className="run-detail-h4">Retry & attempts</h4>
            <div className="retry-context-box">
              <div className="retry-count-line">
                <strong>
                  {String(summary.retry_count ?? 0)} / {String(summary.max_retries ?? "—")}
                </strong>{" "}
                <span className="muted">
                  retries used on this row / server max (automatic worker re-queue)
                </span>
              </div>
              <ul className="muted retry-context-list">
                {retryContextLines(summary).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>

            <h4 className="run-detail-h4">Execution attempts (stored)</h4>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              One row per queue claim: initial run, automatic retries, and operator-triggered retries each
              create a new attempt when recorded.
            </p>
            <AttemptHistorySection
              attempts={attemptHistoryItems}
              runStatus={summary.status != null ? String(summary.status) : ""}
            />

            {(summary.status === "failed" || summary.failure_message || summary.failure_type) && (
              <>
                <h4 className="run-detail-h4">Failure summary</h4>
                <div className="failure-summary-block">
                  <div className="failure-summary-row">
                    <span className="muted">Type</span>{" "}
                    <FailureBadge ft={summary.failure_type as string | null} />
                  </div>
                  {summary.failure_message ? (
                    <div className="failure-message">{String(summary.failure_message)}</div>
                  ) : (
                    <p className="muted" style={{ margin: "8px 0 0" }}>
                      No error_message on this row.
                    </p>
                  )}
                  {summary.failure_type ? (
                    <div className="failure-guidance failure-guidance-inline">
                      <strong>Triage hint</strong> {failureGuidanceText(String(summary.failure_type))}
                    </div>
                  ) : null}
                </div>
              </>
            )}

            <h4 className="run-detail-h4">Status & operator fields</h4>
            <div className="detail-grid compact-facts">
              <div className="kv">
                <strong>Status:</strong> <StatusBadge status={String(summary.status)} />
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
                <strong>Manual review recommended:</strong>{" "}
                {summary.manual_review_recommended ? "yes" : "no"}
              </div>
              <div className="kv">
                <strong>Next step (server):</strong> {String(summary.actionable_next_step ?? "—")}
              </div>
              <div className="kv">
                <strong>Has evidence:</strong> {summary.has_evidence ? "yes" : "no"}
              </div>
            </div>
          </>
        )}
      </div>

      {summary?.failure_type && summary.status !== "failed" ? (
        <div className="failure-guidance">
          <strong>failure_type on row ({String(summary.failure_type)})</strong>{" "}
          {failureGuidanceText(String(summary.failure_type))}
        </div>
      ) : null}

      <h4 className="run-detail-h4">Evidence</h4>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!selectedRunId ? (
          <div className="empty-state">
            <strong>No run selected</strong>
          </div>
        ) : (
          <EvidenceBlock items={evidenceItems} />
        )}
      </div>

      <h4 className="run-detail-h4">Operator actions</h4>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Oldest first (timeline of decisions on this run).
      </p>
      <div className={`box ${loadingDetail ? "loading" : ""}`}>
        {!sortedActions.length ? (
          <div className="empty-state">
            <strong>No operator actions yet</strong>
          </div>
        ) : (
          <ul className="timeline timeline-chrono">
            {sortedActions.map((item, i) => (
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

      <h4 className="run-detail-h4">Action panel</h4>
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
