import { describe, it, expect } from "vitest";
import { assertDeterministicExecutionPayload } from "../src/workers/execution-worker.js";

describe("execution observability payload assertions", () => {
  it("detects substitution mismatch for operator review", () => {
    const payload = {
      summary: { itemCount: 1, totalQuantity: 1 },
      items: [
        {
          cartItemId: "ci-1",
          bottleId: "bottle-expected",
          quantity: 1,
          bottle: {
            id: "bottle-actual",
            mlcc_code: "12345",
          },
        },
      ],
    };

    const result = assertDeterministicExecutionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CODE_MISMATCH");
    expect(result.message).toContain("substitution");
  });
});
