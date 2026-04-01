import type { Summary } from "./types";

export type RecommendationVariant = "success" | "info" | "warn" | "danger" | "neutral";

export type OperatorRecommendation = {
  variant: RecommendationVariant;
  title: string;
  body: string;
};

function str(s: unknown): string {
  return String(s ?? "").trim();
}

/**
 * Concise operator guidance from summary fields already returned by the review bundle.
 * All inference is labeled in body text where needed.
 */
export function getOperatorRecommendation(summary: Summary): OperatorRecommendation {
  const status = str(summary.status).toLowerCase() || "unknown";
  const ft = summary.failure_type != null ? str(summary.failure_type) : null;
  const failureMsg = summary.failure_message != null ? str(summary.failure_message) : null;
  const msgHint =
    failureMsg && failureMsg.length > 0
      ? ` Latest worker/server message: ${failureMsg.length > 220 ? `${failureMsg.slice(0, 220)}…` : failureMsg}`
      : "";
  const retryAllowed = Boolean(summary.retry_allowed);
  const pendingManual = Boolean(summary.pending_manual_review);
  const manualRec = Boolean(summary.manual_review_recommended);
  const opStatus = str(summary.operator_status) || "none";
  const nextStep = str(summary.actionable_next_step);
  const retryCount = Number(summary.retry_count ?? 0);
  const maxRetries = Number(summary.max_retries ?? 0);

  if (status === "succeeded") {
    return {
      variant: "success",
      title: "Run completed successfully",
      body: "No operator action required unless you are auditing history.",
    };
  }

  if (status === "canceled") {
    return {
      variant: "neutral",
      title: "Run is canceled",
      body:
        opStatus === "canceled_by_operator"
          ? "Canceled by an operator action. No further execution expected on this row."
          : "Execution was canceled. Confirm downstream systems if inventory or cart state should be reconciled.",
    };
  }

  if (opStatus === "resolved_without_retry") {
    return {
      variant: "success",
      title: "Resolved without retry",
      body: "An operator marked resolve_without_retry. Treat as closed unless policy requires follow-up.",
    };
  }

  if (pendingManual) {
    return {
      variant: "warn",
      title: "Manual review in progress",
      body:
        "This run is flagged for manual review (mark_for_manual_review). Triage evidence, then acknowledge, resolve, cancel, or retry when appropriate.",
    };
  }

  if (status === "failed") {
    if (retryAllowed) {
      return {
        variant: "info",
        title: "Retry is appropriate (per server rules)",
        body: `Failure type ${ft ?? "unknown"} is retryable and retry budget allows another attempt (${retryCount}/${maxRetries} retries used on this row). Consider retry_now if the underlying issue is cleared.${msgHint}`,
      };
    }
    if (manualRec) {
      return {
        variant: "warn",
        title: "Manual review recommended",
        body:
          "Server flags this failure pattern or evidence as a good manual-review candidate. retry_now is blocked or not advised; use mark_for_manual_review, resolve_without_retry, or acknowledge as appropriate." +
          msgHint,
      };
    }
    return {
      variant: "danger",
      title: "Do not auto-retry (per server rules)",
      body: `retry_now is disabled: non-retryable failure type${ft ? ` (${ft})` : ""}, or retry budget exhausted (${retryCount}/${maxRetries}). Prefer resolve_without_retry, acknowledge, or manual review.${msgHint}`,
    };
  }

  if (status === "running") {
    return {
      variant: "info",
      title: "Run in progress",
      body:
        "Monitor heartbeat and progress. If heartbeat is stale on the Diagnostics page, the worker may be stuck.",
    };
  }

  if (status === "queued") {
    return {
      variant: "neutral",
      title: "Waiting in queue",
      body:
        retryCount > 0
          ? `Queued after ${retryCount} prior retry cycle(s) on this execution row. If it sits too long, check worker health and queue backlog.`
          : "Waiting for a worker. If age grows, check worker health and queue backlog.",
    };
  }

  if (opStatus === "acknowledged") {
    return {
      variant: "neutral",
      title: "Acknowledged",
      body: "Latest operator action is acknowledge. Continue with the next step from your playbook if work remains.",
    };
  }

  return {
    variant: "neutral",
    title: "Review state",
    body: nextStep
      ? `Suggested next step from server: ${nextStep}.`
      : "Review summary, evidence, and timestamps to decide the next operator action.",
  };
}

export function retryContextLines(summary: Summary): string[] {
  const rc = Number(summary.retry_count ?? 0);
  const max = Number(summary.max_retries ?? 0);
  const status = str(summary.status).toLowerCase();
  const ft = summary.failure_type != null ? str(summary.failure_type) : null;

  const lines: string[] = [
    `retry_count on this execution row: ${rc} (increments when the worker re-queues the same run after failure).`,
    `max_retries (budget): ${max}.`,
  ];

  if (rc > 0) {
    lines.push(
      "This row has been through at least one automatic retry cycle. Evidence may include artifacts from the latest attempt.",
    );
  } else {
    lines.push("No automatic retries recorded yet on this row (retry_count = 0).");
  }

  if (status === "failed" && ft) {
    lines.push(
      `Current failure_type on this row: ${ft}. Per-attempt failure history is not included in this API response — only the latest classification is shown.`,
    );
  } else if (rc > 0) {
    lines.push(
      "Whether every attempt failed for the same reason is not exposed in this view; compare evidence and failure_message to prior notes if needed.",
    );
  }

  return lines;
}
