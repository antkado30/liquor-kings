import { deriveRunAttemptInsight, hasRepeatedSameStoredFailure } from "../attemptInsightUtils";
import { FailureBadge } from "./Badges";
import type { ExecutionAttemptRow } from "../types";

function formatDelta(prev: ExecutionAttemptRow, cur: ExecutionAttemptRow): string | null {
  if (cur.status !== "failed" || prev.status !== "failed") {
    const psPrev = prev.progress_stage ?? "";
    const psCur = cur.progress_stage ?? "";
    if (psPrev && psCur && psPrev !== psCur) {
      return `Last progress_stage differs: earlier was ${psPrev}; this attempt ended at ${psCur}.`;
    }
    return null;
  }

  const ftPrev = prev.failure_type ?? null;
  const ftCur = cur.failure_type ?? null;
  const msgPrev = prev.failure_message ?? "";
  const msgCur = cur.failure_message ?? "";

  if (ftPrev === ftCur && msgPrev === msgCur) {
    return "Stored failure_type and failure_message match the previous failed attempt.";
  }
  if (ftPrev === ftCur && msgPrev !== msgCur) {
    return "Same stored failure_type; failure_message differs from the previous attempt.";
  }
  return "Stored failure_type differs from the previous attempt.";
}

type Props = {
  attempts: ExecutionAttemptRow[];
  runStatus?: string;
};

export function AttemptHistorySection({ attempts, runStatus = "" }: Props) {
  if (attempts.length === 0) {
    return (
      <div className="attempt-history-block">
        <p className="muted" style={{ margin: 0 }}>
          No execution attempts are stored for this run yet (older runs or pre-migration). Attempt rows are
          created when a worker claims the run from the queue.
        </p>
      </div>
    );
  }

  const failedRecorded = attempts.filter((a) => a.status === "failed");
  const showRepeatNote = failedRecorded.length >= 2;
  const repeatedSame = hasRepeatedSameStoredFailure(failedRecorded);
  const insight = deriveRunAttemptInsight(attempts, runStatus);

  return (
    <div className="attempt-history-block">
      {attempts.length > 0 && runStatus ? (
        <p className="attempt-insight-banner" style={{ fontSize: 13, marginBottom: 10 }}>
          {insight.first_attempt_only_success ? (
            <>
              <strong>Recorded:</strong> single successful attempt — matches first-attempt success when history is complete.
            </>
          ) : insight.recovered_after_failure ? (
            <>
              <strong>Recorded:</strong> run succeeded after at least one failed attempt (recovery).
            </>
          ) : (
            <>
              <strong>Stored attempts:</strong> {attempts.length}.{" "}
              {repeatedSame ? (
                <span className="attempt-same-failure">
                  Repeated identical stored failure (failure_type + failure_message) on multiple attempts.
                </span>
              ) : showRepeatNote ? (
                <span className="attempt-changed-failure">
                  Multiple failures recorded; compare rows below — same vs changed uses stored fields only.
                </span>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      {showRepeatNote ? (
        <p className="attempt-repeat-note">
          <strong>{failedRecorded.length}</strong> failed attempt(s) recorded in history (see below).{" "}
          <span className="muted">
            Comparisons below use only fields stored on each attempt row.
          </span>
        </p>
      ) : null}

      <ul className="timeline timeline-chrono attempt-timeline">
        {attempts.map((a, idx) => {
          const prev = idx > 0 ? attempts[idx - 1] : null;
          const delta = prev ? formatDelta(prev, a) : null;
          const open = a.status === "running" && !a.finished_at;

          return (
            <li key={a.id}>
              <div className="attempt-head">
                <strong>Attempt {a.attempt_number}</strong>{" "}
                <span className={`attempt-status attempt-status-${a.status}`}>{a.status}</span>
                {a.worker_id ? (
                  <span className="muted mono attempt-worker">
                    worker: {a.worker_id}
                  </span>
                ) : (
                  <span className="muted attempt-worker">worker: —</span>
                )}
              </div>
              <div className="muted mono attempt-times">
                started {a.started_at ?? "—"}
                {open ? (
                  <span className="attempt-open"> · not finished (running)</span>
                ) : (
                  <> · finished {a.finished_at ?? "—"}</>
                )}
              </div>
              {(a.progress_stage || a.progress_message) && (
                <div className="attempt-progress">
                  <span className="muted">progress:</span> {a.progress_stage ?? "—"}
                  {a.progress_message ? (
                    <span className="muted"> — {a.progress_message}</span>
                  ) : null}
                </div>
              )}
              {a.status === "failed" && (
                <div className="attempt-failure">
                  <span className="muted">failure_type:</span>{" "}
                  <FailureBadge ft={a.failure_type ?? null} />
                  {a.failure_message ? (
                    <div className="failure-message attempt-failure-msg">{a.failure_message}</div>
                  ) : (
                    <div className="muted">No failure_message on this attempt row.</div>
                  )}
                </div>
              )}
              {a.evidence_metadata &&
              typeof a.evidence_metadata === "object" &&
              a.evidence_metadata !== null &&
              "evidence_count" in a.evidence_metadata ? (
                <div className="muted attempt-evidence-meta">
                  Evidence at end of attempt:{" "}
                  {String((a.evidence_metadata as { evidence_count?: number }).evidence_count ?? "—")}{" "}
                  item(s)
                  {Array.isArray((a.evidence_metadata as { evidence_kinds?: string[] }).evidence_kinds) &&
                  (a.evidence_metadata as { evidence_kinds: string[] }).evidence_kinds.length > 0
                    ? ` · kinds: ${(a.evidence_metadata as { evidence_kinds: string[] }).evidence_kinds.join(", ")}`
                    : null}
                </div>
              ) : null}
              {delta ? (
                <div className="attempt-delta muted">
                  <strong>vs previous:</strong> {delta}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
