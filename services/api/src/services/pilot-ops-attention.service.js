const MS_PER_HOUR = 60 * 60 * 1000;

const OVERDUE_HOURS_BY_STATUS = {
  unreviewed: 24,
  watching: 12,
  escalated: 6,
  resolved: null,
};

const toTimeMs = (value) => {
  const t = new Date(value ?? "").getTime();
  return Number.isFinite(t) ? t : null;
};

export function evaluatePilotOpsAttentionOverdue({
  healthStatus,
  workflowState,
  needsAttentionSince = null,
  minimumDataWindowMet = true,
  now = new Date().toISOString(),
}) {
  const status = String(workflowState?.pilot_ops_status ?? "unreviewed");
  const thresholdHours = OVERDUE_HOURS_BY_STATUS[status] ?? OVERDUE_HOURS_BY_STATUS.unreviewed;
  const nowMs = toTimeMs(now);
  const reviewedMs = toTimeMs(workflowState?.last_reviewed_at ?? null);
  const needsAttentionMs = toTimeMs(needsAttentionSince);

  if (healthStatus !== "needs_attention") {
    return {
      requires_follow_up: false,
      is_overdue: false,
      reason_code: "store_not_in_needs_attention",
      workflow_status: status,
      reference_at: reviewedMs ? new Date(reviewedMs).toISOString() : null,
      due_at: null,
      elapsed_hours: 0,
      threshold_hours: thresholdHours,
    };
  }

  if (minimumDataWindowMet !== true) {
    return {
      requires_follow_up: false,
      is_overdue: false,
      reason_code: "insufficient_run_window",
      workflow_status: status,
      reference_at: reviewedMs ? new Date(reviewedMs).toISOString() : null,
      due_at: null,
      elapsed_hours: 0,
      threshold_hours: thresholdHours,
    };
  }

  if (status === "resolved" || thresholdHours == null) {
    return {
      requires_follow_up: false,
      is_overdue: false,
      reason_code: "store_marked_resolved",
      workflow_status: status,
      reference_at: reviewedMs ? new Date(reviewedMs).toISOString() : null,
      due_at: null,
      elapsed_hours: 0,
      threshold_hours: null,
    };
  }

  const referenceMs =
    reviewedMs != null && needsAttentionMs != null
      ? Math.max(reviewedMs, needsAttentionMs)
      : reviewedMs ?? needsAttentionMs;

  if (referenceMs == null || nowMs == null) {
    return {
      requires_follow_up: true,
      is_overdue: false,
      reason_code: "needs_attention_missing_reference_time",
      workflow_status: status,
      reference_at: null,
      due_at: null,
      elapsed_hours: 0,
      threshold_hours: thresholdHours,
    };
  }

  const elapsedHours = Math.max(0, (nowMs - referenceMs) / MS_PER_HOUR);
  const dueAtMs = referenceMs + thresholdHours * MS_PER_HOUR;
  const overdue = nowMs > dueAtMs;

  return {
    requires_follow_up: true,
    is_overdue: overdue,
    reason_code: overdue ? "needs_attention_follow_up_overdue" : "needs_attention_follow_up_pending",
    workflow_status: status,
    reference_at: new Date(referenceMs).toISOString(),
    due_at: new Date(dueAtMs).toISOString(),
    elapsed_hours: Number(elapsedHours.toFixed(2)),
    threshold_hours: thresholdHours,
  };
}

