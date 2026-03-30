import { describe, expect, it } from "vitest";
import {
  FAILURE_TYPE,
  classifyFailureType,
  isRetryableFailureType,
} from "../src/services/execution-failure.service.js";
import { assertDeterministicExecutionPayload } from "../src/workers/execution-worker.js";

describe("execution failure classification", () => {
  it("classifies known failures", () => {
    expect(
      classifyFailureType({ errorMessage: "Bottle is missing MLCC code" }),
    ).toBe(FAILURE_TYPE.CODE_MISMATCH);
    expect(
      classifyFailureType({ errorMessage: "insufficient inventory available" }),
    ).toBe(FAILURE_TYPE.OUT_OF_STOCK);
    expect(
      classifyFailureType({ errorMessage: "quantity must be a positive integer" }),
    ).toBe(FAILURE_TYPE.QUANTITY_RULE_VIOLATION);
    expect(
      classifyFailureType({ errorMessage: "MLCC login failed due to selector mismatch" }),
    ).toBe(FAILURE_TYPE.MLCC_UI_CHANGE);
    expect(classifyFailureType({ errorMessage: "fetch failed: ETIMEDOUT" })).toBe(
      FAILURE_TYPE.NETWORK_ERROR,
    );
  });

  it("determines retry policy by failure type", () => {
    expect(isRetryableFailureType(FAILURE_TYPE.NETWORK_ERROR)).toBe(true);
    expect(isRetryableFailureType(FAILURE_TYPE.MLCC_UI_CHANGE)).toBe(true);
    expect(isRetryableFailureType(FAILURE_TYPE.CODE_MISMATCH)).toBe(false);
  });
});

describe("deterministic execution assertions", () => {
  it("passes when payload is internally consistent", () => {
    const payload = {
      summary: { itemCount: 2, totalQuantity: 5 },
      items: [
        {
          cartItemId: "ci-1",
          bottleId: "b-1",
          quantity: 2,
          bottle: { id: "b-1", mlcc_code: "1000" },
        },
        {
          cartItemId: "ci-2",
          bottleId: "b-2",
          quantity: 3,
          bottle: { id: "b-2", mlcc_code: "2000" },
        },
      ],
    };
    expect(assertDeterministicExecutionPayload(payload)).toEqual({ ok: true });
  });

  it("fails when summary quantity mismatches item quantities", () => {
    const payload = {
      summary: { itemCount: 1, totalQuantity: 10 },
      items: [
        {
          cartItemId: "ci-1",
          bottleId: "b-1",
          quantity: 2,
          bottle: { id: "b-1", mlcc_code: "1000" },
        },
      ],
    };
    const result = assertDeterministicExecutionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(FAILURE_TYPE.QUANTITY_RULE_VIOLATION);
  });
});
