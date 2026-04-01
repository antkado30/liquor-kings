import { describe, it, expect } from "vitest";

import { EXECUTION_RUN_MODEL } from "../src/services/execution-run.service.js";

/**
 * Locks documented execution model (docs/lk/architecture/execution-state-machine.md).
 * If this fails, update docs + verification scripts together with code.
 */
describe("EXECUTION_RUN_MODEL (anti-drift)", () => {
  it("exposes stable statuses and operator actions", () => {
    expect(EXECUTION_RUN_MODEL.ALLOWED_STATUSES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "canceled",
    ]);
    expect(EXECUTION_RUN_MODEL.ACTIVE_STATUSES).toEqual(["queued", "running"]);
    expect(EXECUTION_RUN_MODEL.TERMINAL_STATUSES).toEqual([
      "succeeded",
      "failed",
      "canceled",
    ]);
    expect(EXECUTION_RUN_MODEL.DEFAULT_MAX_RETRIES).toBe(2);
    expect(EXECUTION_RUN_MODEL.OPERATOR_ACTION).toEqual({
      ACKNOWLEDGE: "acknowledge",
      MARK_FOR_MANUAL_REVIEW: "mark_for_manual_review",
      RETRY_NOW: "retry_now",
      CANCEL: "cancel",
      RESOLVE_WITHOUT_RETRY: "resolve_without_retry",
    });
  });
});
