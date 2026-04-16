import { describe, it, expect } from "vitest";
import {
  serializeMlccExecutionReadiness,
  readinessDedicatedHttpPayload,
} from "../src/mlcc/mlcc-execution-readiness-serialize.js";

describe("serializeMlccExecutionReadiness", () => {
  it("ready: stable shape with null error/message and empty blocking_lines", () => {
    const out = serializeMlccExecutionReadiness({
      statusCode: 200,
      body: { ok: true, ready: true, blocking_lines: [] },
    });
    expect(out).toEqual({
      ready: true,
      error: null,
      message: null,
      blocking_lines: [],
    });
  });

  it("blocked: MLCC_ITEM_ID_REQUIRED and non-empty blocking_lines", () => {
    const lines = [
      { cartItemId: "c1", bottleId: "b1", reason: "missing_mlcc_item_id" },
    ];
    const out = serializeMlccExecutionReadiness({
      statusCode: 200,
      body: {
        ok: true,
        ready: false,
        error: "MLCC_ITEM_ID_REQUIRED",
        message: "Cannot queue MLCC execution.",
        blocking_lines: lines,
      },
    });
    expect(out.ready).toBe(false);
    expect(out.error).toBe("MLCC_ITEM_ID_REQUIRED");
    expect(out.message).toBe("Cannot queue MLCC execution.");
    expect(out.blocking_lines).toEqual(lines);
  });

  it("not-found / error-style: empty blocking_lines, ready false", () => {
    const out = serializeMlccExecutionReadiness({
      statusCode: 404,
      body: {
        ok: false,
        ready: false,
        error: "Submitted cart not found",
        message: "Submitted cart not found",
        blocking_lines: [],
      },
    });
    expect(out.ready).toBe(false);
    expect(out.error).toBe("Submitted cart not found");
    expect(out.message).toBe("Submitted cart not found");
    expect(out.blocking_lines).toEqual([]);
  });

  it("400-style: uses string error when message missing", () => {
    const out = serializeMlccExecutionReadiness({
      statusCode: 400,
      body: {
        ok: false,
        ready: false,
        error: "Cart must be validated before execution payload can be built",
      },
    });
    expect(out.ready).toBe(false);
    expect(out.error).toBe(
      "Cart must be validated before execution payload can be built",
    );
    expect(out.message).toBe(
      "Cart must be validated before execution payload can be built",
    );
    expect(out.blocking_lines).toEqual([]);
  });

  it("guards non-array blocking_lines on 200 not-ready", () => {
    const out = serializeMlccExecutionReadiness({
      statusCode: 200,
      body: {
        ok: true,
        ready: false,
        error: "MLCC_ITEM_ID_REQUIRED",
        message: "m",
        blocking_lines: null,
      },
    });
    expect(out.blocking_lines).toEqual([]);
  });
});

describe("readinessDedicatedHttpPayload", () => {
  it("includes ok true for 200 blocked mapping evaluation", () => {
    const out = readinessDedicatedHttpPayload({
      statusCode: 200,
      body: {
        ok: true,
        ready: false,
        error: "MLCC_ITEM_ID_REQUIRED",
        message: "msg",
        blocking_lines: [{ cartItemId: "x", bottleId: "y", reason: "missing_mlcc_item_id" }],
      },
    });
    expect(out.ok).toBe(true);
    expect(out.ready).toBe(false);
    expect(out.error).toBe("MLCC_ITEM_ID_REQUIRED");
    expect(out.blocking_lines).toHaveLength(1);
  });

  it("includes ok false for 404", () => {
    const out = readinessDedicatedHttpPayload({
      statusCode: 404,
      body: { ok: false, ready: false, error: "Submitted cart not found", message: "Submitted cart not found", blocking_lines: [] },
    });
    expect(out.ok).toBe(false);
    expect(out.ready).toBe(false);
  });
});
