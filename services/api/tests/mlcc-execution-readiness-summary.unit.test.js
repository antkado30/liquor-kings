import { describe, it, expect } from "vitest";
import {
  deriveBlockingPreview,
  deriveMlccExecutionSummaryFromReadiness,
} from "../src/mlcc/mlcc-execution-readiness-summary.js";

describe("deriveMlccExecutionSummaryFromReadiness", () => {
  it("ready: stable codes and zero counts", () => {
    const s = deriveMlccExecutionSummaryFromReadiness({
      ready: true,
      error: null,
      message: null,
      blocking_lines: [],
    });
    expect(s).toEqual({
      status_code: "ready",
      blocked: false,
      blocking_count: 0,
      missing_mlcc_item_id_count: 0,
    });
  });

  it("blocked_missing_mlcc_item_id: counts from blocking_lines", () => {
    const s = deriveMlccExecutionSummaryFromReadiness({
      ready: false,
      error: "MLCC_ITEM_ID_REQUIRED",
      message: "msg",
      blocking_lines: [
        { cartItemId: "a", bottleId: "b", reason: "missing_mlcc_item_id" },
        { cartItemId: "c", bottleId: "d", reason: "missing_mlcc_item_id" },
      ],
    });
    expect(s).toEqual({
      status_code: "blocked_missing_mlcc_item_id",
      blocked: true,
      blocking_count: 2,
      missing_mlcc_item_id_count: 2,
    });
  });

  it("counts only missing_mlcc_item_id reasons in mixed lines", () => {
    const s = deriveMlccExecutionSummaryFromReadiness({
      ready: false,
      error: "MLCC_ITEM_ID_REQUIRED",
      message: "m",
      blocking_lines: [
        { reason: "missing_mlcc_item_id" },
        { reason: "other" },
      ],
    });
    expect(s.blocking_count).toBe(2);
    expect(s.missing_mlcc_item_id_count).toBe(1);
  });

  it("not_mlcc_ready for non-MLCC_ITEM_ID_REQUIRED errors", () => {
    const s = deriveMlccExecutionSummaryFromReadiness({
      ready: false,
      error: "Submitted cart not found",
      message: "Submitted cart not found",
      blocking_lines: [],
    });
    expect(s).toEqual({
      status_code: "not_mlcc_ready",
      blocked: true,
      blocking_count: 0,
      missing_mlcc_item_id_count: 0,
    });
  });

  it("guards null blocking_lines", () => {
    const s = deriveMlccExecutionSummaryFromReadiness({
      ready: false,
      error: "MLCC_ITEM_ID_REQUIRED",
      blocking_lines: null,
    });
    expect(s.blocking_count).toBe(0);
    expect(s.missing_mlcc_item_id_count).toBe(0);
  });
});

describe("deriveBlockingPreview", () => {
  it("returns first N entries unchanged", () => {
    const readiness = {
      blocking_lines: [
        { a: 1 },
        { b: 2 },
        { c: 3 },
        { d: 4 },
      ],
    };
    expect(deriveBlockingPreview(readiness, 2)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("defaults to 3 and caps high limits", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ i }));
    expect(deriveBlockingPreview({ blocking_lines: lines }).length).toBe(3);
    expect(deriveBlockingPreview({ blocking_lines: lines }, 99).length).toBe(10);
  });

  it("ready / empty lines yields empty preview", () => {
    expect(deriveBlockingPreview({ ready: true, blocking_lines: [] })).toEqual([]);
    expect(deriveBlockingPreview({ blocking_lines: null })).toEqual([]);
  });
});
