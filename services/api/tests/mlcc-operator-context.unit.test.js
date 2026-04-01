import { describe, expect, it } from "vitest";
import {
  enrichFailureDetailsWithMlccSignal,
  deriveMlccOperatorContext,
  MLCC_SIGNAL,
} from "../src/services/mlcc-operator-context.service.js";
import { classifyFailureType } from "../src/services/execution-failure.service.js";

describe("classifyFailureType MLCC login", () => {
  it("maps MLCC login failed message to MLCC_UI_CHANGE", () => {
    expect(
      classifyFailureType({ errorMessage: "MLCC login failed", explicitType: undefined }),
    ).toBe("MLCC_UI_CHANGE");
  });
});

describe("enrichFailureDetailsWithMlccSignal", () => {
  it("preserves explicit mlcc_signal", () => {
    const fd = enrichFailureDetailsWithMlccSignal({
      failureDetails: { mlcc_signal: MLCC_SIGNAL.CONFIG_ENV, stage: "browser_config" },
      errorMessage: "x",
      failureType: "MLCC_UI_CHANGE",
    });
    expect(fd.mlcc_signal).toBe(MLCC_SIGNAL.CONFIG_ENV);
  });

  it("infers login from message", () => {
    const fd = enrichFailureDetailsWithMlccSignal({
      failureDetails: {},
      errorMessage: "MLCC login failed",
      failureType: "MLCC_UI_CHANGE",
    });
    expect(fd.mlcc_signal).toBe(MLCC_SIGNAL.LOGIN_AUTH);
  });

  it("maps browser_runtime + NETWORK_ERROR to network transport", () => {
    const fd = enrichFailureDetailsWithMlccSignal({
      failureDetails: { stage: "browser_runtime" },
      errorMessage: "timeout",
      failureType: "NETWORK_ERROR",
    });
    expect(fd.mlcc_signal).toBe(MLCC_SIGNAL.NETWORK_TRANSPORT);
  });
});

describe("deriveMlccOperatorContext", () => {
  it("returns guidance when signal can be derived", () => {
    const ctx = deriveMlccOperatorContext({
      failure_type: "QUANTITY_RULE_VIOLATION",
      error_message: "bad",
      failure_details: { stage: "mlcc_preflight" },
      evidence: [{ kind: "learned_qty_rule_dump" }],
    });
    expect(ctx?.mlcc_signal).toBe(MLCC_SIGNAL.MLCC_PREFLIGHT);
    expect(ctx?.guidance.length).toBeGreaterThan(10);
    expect(ctx?.evidence_kinds).toContain("learned_qty_rule_dump");
  });
});
