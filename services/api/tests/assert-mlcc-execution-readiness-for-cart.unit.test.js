import { describe, it, expect } from "vitest";
import { assertMlccExecutionReadinessForEnqueue } from "../src/mlcc/assert-mlcc-execution-readiness-for-cart.js";
import { MLCC_EXECUTION_ITEM_ID_MESSAGE } from "../src/utils/mlcc-execution-item-guard.js";

describe("assertMlccExecutionReadinessForEnqueue (Gate 3)", () => {
  it("allows enqueue when evaluator returns ready", () => {
    const out = assertMlccExecutionReadinessForEnqueue({
      statusCode: 200,
      body: { ok: true, ready: true, blocking_lines: [] },
    });
    expect(out.ok).toBe(true);
    expect(out.readiness.ready).toBe(true);
  });

  it("blocks with MLCC_ITEM_ID_REQUIRED contract when not ready", () => {
    const lines = [{ cartItemId: "x", bottleId: "y", reason: "missing_mlcc_item_id" }];
    const out = assertMlccExecutionReadinessForEnqueue({
      statusCode: 200,
      body: {
        ok: true,
        ready: false,
        error: "MLCC_ITEM_ID_REQUIRED",
        message: MLCC_EXECUTION_ITEM_ID_MESSAGE,
        blocking_lines: lines,
      },
    });
    expect(out.ok).toBe(false);
    expect(out.statusCode).toBe(400);
    expect(out.body).toEqual({
      error: "MLCC_ITEM_ID_REQUIRED",
      message: MLCC_EXECUTION_ITEM_ID_MESSAGE,
      blocking_lines: lines,
    });
  });

  it("404 preserves minimal body", () => {
    const out = assertMlccExecutionReadinessForEnqueue({
      statusCode: 404,
      body: { error: "Submitted cart not found" },
    });
    expect(out.ok).toBe(false);
    expect(out.statusCode).toBe(404);
    expect(out.body).toEqual({ error: "Submitted cart not found" });
  });

  it("non-200 non-404 includes error", () => {
    const out = assertMlccExecutionReadinessForEnqueue({
      statusCode: 400,
      body: { error: "Cart must be validated before execution payload can be built" },
    });
    expect(out.ok).toBe(false);
    expect(out.statusCode).toBe(400);
    expect(out.body.error).toBe(
      "Cart must be validated before execution payload can be built",
    );
  });
});
