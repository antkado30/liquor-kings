import { describe, expect, it } from "vitest";
import {
  buildPilotOpsQualitySummary,
  buildPilotOpsTimeComparison,
  filterRowsByTimeField,
  computeFollowUpPairingForWindow,
} from "../src/services/pilot-ops-quality-metrics.service.js";

const STORE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("pilot ops quality metrics summary", () => {
  it("builds compact counters from stores/history/notifications", () => {
    const out = buildPilotOpsQualitySummary({
      stores: [
        {
          health_status: "needs_attention",
          pilot_ops_status: "unreviewed",
          attention_overdue: {
            requires_follow_up: true,
            is_overdue: true,
            reason_code: "needs_attention_follow_up_overdue",
          },
        },
        {
          health_status: "needs_attention",
          pilot_ops_status: "watching",
          attention_overdue: {
            requires_follow_up: true,
            is_overdue: false,
            reason_code: "needs_attention_follow_up_pending",
          },
        },
        {
          health_status: "degraded",
          pilot_ops_status: "resolved",
          attention_overdue: {
            requires_follow_up: false,
            is_overdue: false,
            reason_code: "insufficient_run_window",
          },
        },
      ],
      notifications: [
        { notification_kind: "newly_needs_attention" },
        { notification_kind: "newly_attention_overdue" },
        { notification_kind: "newly_attention_overdue" },
      ],
      workflowHistory: [
        { new_pilot_ops_status: "watching" },
        { new_pilot_ops_status: "escalated" },
        { new_pilot_ops_status: "resolved" },
      ],
    });
    expect(out.notifications.total).toBe(3);
    expect(out.notifications.by_kind.newly_needs_attention).toBe(1);
    expect(out.notifications.by_kind.newly_attention_overdue).toBe(2);
    expect(out.workflow_transitions.by_new_status.watching).toBe(1);
    expect(out.workflow_transitions.by_new_status.escalated).toBe(1);
    expect(out.workflow_transitions.by_new_status.resolved).toBe(1);
    expect(out.follow_up_quality.needs_attention_total).toBe(2);
    expect(out.follow_up_quality.overdue_unreviewed).toBe(1);
    expect(out.follow_up_quality.overdue_reviewed_within_sla).toBe(1);
    expect(out.follow_up_quality.signal_suppressed_insufficient_window).toBe(1);
  });
});

describe("pilot ops quality time windows", () => {
  it("filters rows by timestamp field", () => {
    const start = Date.parse("2026-04-01T00:00:00.000Z");
    const end = Date.parse("2026-04-08T00:00:00.000Z");
    const rows = [
      { triggered_at: "2026-03-31T12:00:00.000Z" },
      { triggered_at: "2026-04-02T12:00:00.000Z" },
      { triggered_at: "2026-04-08T00:00:00.000Z" },
    ];
    const f = filterRowsByTimeField(rows, "triggered_at", start, end);
    expect(f).toHaveLength(1);
    expect(f[0].triggered_at).toBe("2026-04-02T12:00:00.000Z");
  });

  it("builds recent vs previous window summaries and trends", () => {
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const notifications = [
      {
        id: "n1",
        store_id: STORE,
        notification_kind: "newly_needs_attention",
        triggered_at: "2026-04-14T10:00:00.000Z",
      },
      {
        id: "n2",
        store_id: STORE,
        notification_kind: "newly_attention_overdue",
        triggered_at: "2026-04-05T10:00:00.000Z",
      },
    ];
    const workflowHistory = [
      {
        store_id: STORE,
        changed_at: "2026-04-06T15:00:00.000Z",
        previous_pilot_ops_status: "watching",
        new_pilot_ops_status: "resolved",
      },
    ];
    const out = buildPilotOpsTimeComparison({
      nowMs,
      windowDays: 7,
      notifications,
      workflowHistory,
    });
    expect(out.window_days).toBe(7);
    expect(out.recent.summary.notifications.total).toBe(1);
    expect(out.previous.summary.notifications.total).toBe(1);
    expect(out.trend.newly_needs_attention).toBeDefined();
  });

  it("pairs overdue notification with resolution in window for SLA buckets", () => {
    const resolutionWindowStartMs = Date.parse("2026-04-10T00:00:00.000Z");
    const resolutionWindowEndMs = Date.parse("2026-04-20T00:00:00.000Z");
    const notificationsAll = [
      {
        id: "o1",
        store_id: STORE,
        notification_kind: "newly_attention_overdue",
        triggered_at: "2026-04-10T12:00:00.000Z",
      },
    ];
    const workflowHistoryAll = [
      {
        store_id: STORE,
        changed_at: "2026-04-11T12:00:00.000Z",
        previous_pilot_ops_status: "unreviewed",
        new_pilot_ops_status: "resolved",
      },
    ];
    const q = computeFollowUpPairingForWindow({
      notificationsAll,
      workflowHistoryAll,
      resolutionWindowStartMs,
      resolutionWindowEndMs,
      overdueUnreviewedWindowStartMs: resolutionWindowStartMs,
      overdueUnreviewedWindowEndMs: resolutionWindowEndMs,
    });
    expect(q.overdue_reviewed_within_sla).toBe(1);
    expect(q.overdue_reviewed_after_sla).toBe(0);
    expect(q.overdue_unreviewed).toBe(0);
  });
});
