import { describe, expect, it } from "vitest";
import { computeAttemptHistoryWindowInsights } from "../src/services/execution-attempt-aggregate.service.js";

describe("computeAttemptHistoryWindowInsights", () => {
  const rid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("computes avg and multi-attempt success rate from stored rows", () => {
    const runs = [
      { id: "r1", status: "succeeded" },
      { id: "r2", status: "failed" },
    ];
    const byRunId = new Map([
      [
        "r1",
        [
          { attempt_number: 1, status: "failed", failure_type: "NETWORK_ERROR", failure_message: "a" },
          { attempt_number: 2, status: "succeeded" },
        ],
      ],
      [
        "r2",
        [
          { attempt_number: 1, status: "failed", failure_type: "UNKNOWN", failure_message: "x" },
          { attempt_number: 2, status: "failed", failure_type: "UNKNOWN", failure_message: "x" },
        ],
      ],
    ]);

    const out = computeAttemptHistoryWindowInsights(runs, byRunId);
    expect(out.runs_in_window).toBe(2);
    expect(out.runs_with_attempt_rows).toBe(2);
    expect(out.total_stored_attempt_rows).toBe(4);
    expect(out.avg_attempts_per_run_with_history).toBe(2);
    expect(out.runs_with_more_than_one_attempt).toBe(2);
    expect(out.multi_attempt_success_rate).toBe(0.5);
    expect(out.eventual_success_after_failed_attempt_runs).toBe(1);
    expect(out.first_attempt_only_success_runs).toBe(0);
  });

  it("flags repeated same stored failure when two failed attempts match type and message", () => {
    const runs = [{ id: rid, status: "failed" }];
    const byRunId = new Map([
      [
        rid,
        [
          {
            attempt_number: 1,
            status: "failed",
            failure_type: "NETWORK_ERROR",
            failure_message: "timeout",
          },
          {
            attempt_number: 2,
            status: "failed",
            failure_type: "NETWORK_ERROR",
            failure_message: "timeout",
          },
        ],
      ],
    ]);
    const out = computeAttemptHistoryWindowInsights(runs, byRunId);
    expect(out.runs_with_repeated_same_stored_failure).toBe(1);
    expect(out.runs_with_two_or_more_failed_attempts).toBe(1);
  });

  it("does not flag repeated same when messages differ", () => {
    const runs = [{ id: rid, status: "failed" }];
    const byRunId = new Map([
      [
        rid,
        [
          {
            attempt_number: 1,
            status: "failed",
            failure_type: "NETWORK_ERROR",
            failure_message: "a",
          },
          {
            attempt_number: 2,
            status: "failed",
            failure_type: "NETWORK_ERROR",
            failure_message: "b",
          },
        ],
      ],
    ]);
    const out = computeAttemptHistoryWindowInsights(runs, byRunId);
    expect(out.runs_with_repeated_same_stored_failure).toBe(0);
  });
});
