const STATUS_KEYS = ["unreviewed", "watching", "escalated", "resolved"];
const NOTIFICATION_KEYS = ["newly_needs_attention", "newly_attention_overdue"];

const MS_PER_HOUR = 60 * 60 * 1000;

const THRESHOLD_HOURS_BY_PREVIOUS_STATUS = {
  unreviewed: 24,
  watching: 12,
  escalated: 6,
  resolved: null,
};

const toTimeMs = (value) => {
  const t = new Date(value ?? "").getTime();
  return Number.isFinite(t) ? t : null;
};

export function filterRowsByTimeField(rows, field, startMs, endMs) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    const t = toTimeMs(row?.[field]);
    if (t == null) return false;
    return t >= startMs && t < endMs;
  });
}

function buildNotificationAndWorkflowCounts(notifications, workflowHistory) {
  const by_notification_kind = {
    newly_needs_attention: 0,
    newly_attention_overdue: 0,
  };
  for (const row of notifications) {
    const k = String(row?.notification_kind ?? "");
    if (NOTIFICATION_KEYS.includes(k)) by_notification_kind[k] += 1;
  }

  const workflow_transitions_by_status = {
    unreviewed: 0,
    watching: 0,
    escalated: 0,
    resolved: 0,
  };
  for (const row of workflowHistory) {
    const k = String(row?.new_pilot_ops_status ?? "");
    if (STATUS_KEYS.includes(k)) workflow_transitions_by_status[k] += 1;
  }

  return {
    notifications: {
      total: notifications.length,
      by_kind: by_notification_kind,
    },
    workflow_transitions: {
      total: workflowHistory.length,
      by_new_status: workflow_transitions_by_status,
    },
  };
}

/**
 * Pair overdue notifications with subsequent resolved transitions (same store) to approximate
 * within-SLA vs after-SLA follow-up. Pass full notification/history arrays so resolutions outside
 * the slice window are still visible for pairing. Resolution must fall inside `resolutionWindow`.
 */
export function computeFollowUpPairingForWindow({
  notificationsAll = [],
  workflowHistoryAll = [],
  resolutionWindowStartMs,
  resolutionWindowEndMs,
  overdueUnreviewedWindowStartMs,
  overdueUnreviewedWindowEndMs,
}) {
  const overdueNotifs = notificationsAll.filter(
    (n) => String(n?.notification_kind ?? "") === "newly_attention_overdue",
  );
  const resolvedRows = workflowHistoryAll.filter(
    (h) => String(h?.new_pilot_ops_status ?? "") === "resolved",
  );

  let overdue_reviewed_within_sla = 0;
  let overdue_reviewed_after_sla = 0;

  for (const res of resolvedRows) {
    const resMs = toTimeMs(res?.changed_at);
    const storeId = String(res?.store_id ?? "");
    if (resMs == null || !storeId) continue;
    if (resMs < resolutionWindowStartMs || resMs >= resolutionWindowEndMs) continue;

    const prevStatus = String(res?.previous_pilot_ops_status ?? "unreviewed");
    const thresholdH =
      THRESHOLD_HOURS_BY_PREVIOUS_STATUS[prevStatus] ??
      THRESHOLD_HOURS_BY_PREVIOUS_STATUS.unreviewed;
    if (thresholdH == null) continue;

    let bestOverdue = null;
    let bestT = -1;
    for (const n of overdueNotifs) {
      if (String(n?.store_id ?? "") !== storeId) continue;
      const t = toTimeMs(n?.triggered_at);
      if (t == null || t >= resMs) continue;
      if (t > bestT) {
        bestT = t;
        bestOverdue = n;
      }
    }
    if (bestOverdue == null) continue;

    const hours = (resMs - bestT) / MS_PER_HOUR;
    if (hours <= thresholdH) overdue_reviewed_within_sla += 1;
    else overdue_reviewed_after_sla += 1;
  }

  let overdue_unreviewed = 0;
  for (const n of overdueNotifs) {
    const t = toTimeMs(n?.triggered_at);
    if (t == null) continue;
    if (t < overdueUnreviewedWindowStartMs || t >= overdueUnreviewedWindowEndMs) continue;
    const storeId = String(n?.store_id ?? "");
    let hasLaterResolved = false;
    for (const res of resolvedRows) {
      if (String(res?.store_id ?? "") !== storeId) continue;
      const resMs = toTimeMs(res?.changed_at);
      if (resMs != null && resMs > t) {
        hasLaterResolved = true;
        break;
      }
    }
    if (!hasLaterResolved) overdue_unreviewed += 1;
  }

  const newly_needs_attention_in_window = notificationsAll.filter((n) => {
    const t = toTimeMs(n?.triggered_at);
    if (t == null) return false;
    return (
      t >= overdueUnreviewedWindowStartMs &&
      t < overdueUnreviewedWindowEndMs &&
      String(n?.notification_kind ?? "") === "newly_needs_attention"
    );
  }).length;

  return {
    needs_attention_total: newly_needs_attention_in_window,
    overdue_reviewed_within_sla,
    overdue_reviewed_after_sla,
    overdue_unreviewed,
    follow_up_pending: 0,
    signal_suppressed_insufficient_window: 0,
  };
}

export function buildPilotOpsQualityWindowSlice({
  notificationsFiltered = [],
  workflowHistoryFiltered = [],
  notificationsAll = [],
  workflowHistoryAll = [],
  resolutionWindowStartMs,
  resolutionWindowEndMs,
  overdueUnreviewedWindowStartMs,
  overdueUnreviewedWindowEndMs,
}) {
  const counts = buildNotificationAndWorkflowCounts(
    notificationsFiltered,
    workflowHistoryFiltered,
  );
  const follow_up_quality = computeFollowUpPairingForWindow({
    notificationsAll,
    workflowHistoryAll,
    resolutionWindowStartMs,
    resolutionWindowEndMs,
    overdueUnreviewedWindowStartMs,
    overdueUnreviewedWindowEndMs,
  });
  return {
    ...counts,
    follow_up_quality,
  };
}

export function buildPilotOpsQualitySummary({
  stores = [],
  notifications = [],
  workflowHistory = [],
}) {
  const counts = buildNotificationAndWorkflowCounts(notifications, workflowHistory);

  let overdue_reviewed_within_sla = 0;
  let overdue_reviewed_after_sla = 0;
  let overdue_unreviewed = 0;
  let follow_up_pending = 0;
  let signal_suppressed_insufficient_window = 0;
  let needs_attention_total = 0;

  for (const s of stores) {
    const health = String(s?.health_status ?? "");
    const wfStatus = String(s?.pilot_ops_status ?? "unreviewed");
    const att = s?.attention_overdue ?? {};
    const requires = att?.requires_follow_up === true;
    const overdue = att?.is_overdue === true;
    const reason = String(att?.reason_code ?? "");
    if (health === "needs_attention") needs_attention_total += 1;
    if (reason === "insufficient_run_window") signal_suppressed_insufficient_window += 1;
    if (!requires) continue;

    if (overdue) {
      if (wfStatus === "resolved") {
        overdue_reviewed_after_sla += 1;
      } else {
        overdue_unreviewed += 1;
      }
      continue;
    }

    if (wfStatus === "resolved" || wfStatus === "watching" || wfStatus === "escalated") {
      overdue_reviewed_within_sla += 1;
    } else {
      follow_up_pending += 1;
    }
  }

  return {
    ...counts,
    follow_up_quality: {
      needs_attention_total,
      overdue_reviewed_within_sla,
      overdue_reviewed_after_sla,
      overdue_unreviewed,
      follow_up_pending,
      signal_suppressed_insufficient_window,
    },
  };
}

function trendDirection(recent, previous, { lowerIsBetter = false } = {}) {
  if (previous === recent) return "flat";
  const improved = lowerIsBetter ? recent < previous : recent > previous;
  const worsened = lowerIsBetter ? recent > previous : recent < previous;
  if (improved) return "improving";
  if (worsened) return "worsening";
  return "flat";
}

export function buildPilotOpsQualityTrendComparison({ recent, previous }) {
  const rN = recent?.notifications?.by_kind ?? {};
  const pN = previous?.notifications?.by_kind ?? {};
  const rW = recent?.workflow_transitions?.by_new_status ?? {};
  const pW = previous?.workflow_transitions?.by_new_status ?? {};
  const rF = recent?.follow_up_quality ?? {};
  const pF = previous?.follow_up_quality ?? {};

  return {
    newly_needs_attention: trendDirection(
      Number(rN.newly_needs_attention ?? 0),
      Number(pN.newly_needs_attention ?? 0),
      { lowerIsBetter: true },
    ),
    newly_attention_overdue: trendDirection(
      Number(rN.newly_attention_overdue ?? 0),
      Number(pN.newly_attention_overdue ?? 0),
      { lowerIsBetter: true },
    ),
    workflow_resolved: trendDirection(
      Number(rW.resolved ?? 0),
      Number(pW.resolved ?? 0),
      { lowerIsBetter: false },
    ),
    overdue_reviewed_within_sla: trendDirection(
      Number(rF.overdue_reviewed_within_sla ?? 0),
      Number(pF.overdue_reviewed_within_sla ?? 0),
      { lowerIsBetter: false },
    ),
    overdue_reviewed_after_sla: trendDirection(
      Number(rF.overdue_reviewed_after_sla ?? 0),
      Number(pF.overdue_reviewed_after_sla ?? 0),
      { lowerIsBetter: true },
    ),
    overdue_unreviewed: trendDirection(
      Number(rF.overdue_unreviewed ?? 0),
      Number(pF.overdue_unreviewed ?? 0),
      { lowerIsBetter: true },
    ),
  };
}

export function buildPilotOpsTimeComparison({
  nowMs = Date.now(),
  windowDays = 7,
  notifications = [],
  workflowHistory = [],
}) {
  const days = Math.min(Math.max(Number(windowDays) || 7, 1), 90);
  const windowMs = days * 24 * 60 * 60 * 1000;
  const recentEnd = nowMs;
  const recentStart = nowMs - windowMs;
  const previousEnd = recentStart;
  const previousStart = nowMs - 2 * windowMs;

  const recentNotif = filterRowsByTimeField(notifications, "triggered_at", recentStart, recentEnd);
  const previousNotif = filterRowsByTimeField(notifications, "triggered_at", previousStart, previousEnd);
  const recentHist = filterRowsByTimeField(workflowHistory, "changed_at", recentStart, recentEnd);
  const previousHist = filterRowsByTimeField(workflowHistory, "changed_at", previousStart, previousEnd);

  const recent = buildPilotOpsQualityWindowSlice({
    notificationsFiltered: recentNotif,
    workflowHistoryFiltered: recentHist,
    notificationsAll: notifications,
    workflowHistoryAll: workflowHistory,
    resolutionWindowStartMs: recentStart,
    resolutionWindowEndMs: recentEnd,
    overdueUnreviewedWindowStartMs: recentStart,
    overdueUnreviewedWindowEndMs: recentEnd,
  });

  const previous = buildPilotOpsQualityWindowSlice({
    notificationsFiltered: previousNotif,
    workflowHistoryFiltered: previousHist,
    notificationsAll: notifications,
    workflowHistoryAll: workflowHistory,
    resolutionWindowStartMs: previousStart,
    resolutionWindowEndMs: previousEnd,
    overdueUnreviewedWindowStartMs: previousStart,
    overdueUnreviewedWindowEndMs: previousEnd,
  });

  const trend = buildPilotOpsQualityTrendComparison({ recent, previous });

  return {
    window_days: days,
    recent: {
      start: new Date(recentStart).toISOString(),
      end: new Date(recentEnd).toISOString(),
      summary: recent,
    },
    previous: {
      start: new Date(previousStart).toISOString(),
      end: new Date(previousEnd).toISOString(),
      summary: previous,
    },
    trend,
  };
}
