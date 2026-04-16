import { describe, expect, it } from "vitest";
import { evaluatePilotOpsAttentionOverdue } from "../src/services/pilot-ops-attention.service.js";

describe("pilot ops attention overdue evaluation", () => {
  it("does not require follow-up when store is not needs_attention", () => {
    const out = evaluatePilotOpsAttentionOverdue({
      healthStatus: "healthy",
      workflowState: { pilot_ops_status: "unreviewed", last_reviewed_at: null },
      now: "2026-04-15T12:00:00.000Z",
    });
    expect(out.requires_follow_up).toBe(false);
    expect(out.is_overdue).toBe(false);
    expect(out.reason_code).toBe("store_not_in_needs_attention");
  });

  it("marks overdue for unreviewed needs_attention past threshold", () => {
    const out = evaluatePilotOpsAttentionOverdue({
      healthStatus: "needs_attention",
      workflowState: { pilot_ops_status: "unreviewed", last_reviewed_at: null },
      needsAttentionSince: "2026-04-14T10:00:00.000Z",
      now: "2026-04-15T12:30:00.000Z",
    });
    expect(out.requires_follow_up).toBe(true);
    expect(out.is_overdue).toBe(true);
    expect(out.reason_code).toBe("needs_attention_follow_up_overdue");
    expect(out.threshold_hours).toBe(24);
  });

  it("marks pending for watching before threshold", () => {
    const out = evaluatePilotOpsAttentionOverdue({
      healthStatus: "needs_attention",
      workflowState: {
        pilot_ops_status: "watching",
        last_reviewed_at: "2026-04-15T08:00:00.000Z",
      },
      needsAttentionSince: "2026-04-15T07:00:00.000Z",
      now: "2026-04-15T15:00:00.000Z",
    });
    expect(out.requires_follow_up).toBe(true);
    expect(out.is_overdue).toBe(false);
    expect(out.reason_code).toBe("needs_attention_follow_up_pending");
    expect(out.threshold_hours).toBe(12);
  });

  it("does not require follow-up when resolved", () => {
    const out = evaluatePilotOpsAttentionOverdue({
      healthStatus: "needs_attention",
      workflowState: {
        pilot_ops_status: "resolved",
        last_reviewed_at: "2026-04-15T08:00:00.000Z",
      },
      needsAttentionSince: "2026-04-15T07:00:00.000Z",
      now: "2026-04-15T20:00:00.000Z",
    });
    expect(out.requires_follow_up).toBe(false);
    expect(out.is_overdue).toBe(false);
    expect(out.reason_code).toBe("store_marked_resolved");
  });

  it("suppresses follow-up when run window is insufficient", () => {
    const out = evaluatePilotOpsAttentionOverdue({
      healthStatus: "needs_attention",
      minimumDataWindowMet: false,
      workflowState: {
        pilot_ops_status: "unreviewed",
        last_reviewed_at: null,
      },
      needsAttentionSince: "2026-04-15T07:00:00.000Z",
      now: "2026-04-15T20:00:00.000Z",
    });
    expect(out.requires_follow_up).toBe(false);
    expect(out.is_overdue).toBe(false);
    expect(out.reason_code).toBe("insufficient_run_window");
  });
});

