/**
 * Adversarial unit tests for cart-lines-hash (run-dedupe, 2026-07-11).
 *
 * The fixture below is a byte-faithful copy of the REAL payload item
 * shape produced by cart-execution-payload.service.js
 * buildItemsAndSummary() — cartItemId/bottleId/mlcc_item_id/quantity +
 * the full bottle blob with mlcc_code. Never invent row shapes in
 * fixtures (2026-07-08 run_type lesson: 15 green tests protected a bug
 * because the fixture guessed the shape).
 */
import { describe, it, expect } from "vitest";
import { computeCartLinesHash } from "./cart-lines-hash.js";

/** Real payload item shape (mirrors buildItemsAndSummary output). */
function makePayloadItem(code, quantity) {
  return {
    cartItemId: `ci-${code}`,
    bottleId: `b-${code}`,
    mlcc_item_id: `mi-${code}`,
    quantity,
    bottle: {
      id: `b-${code}`,
      name: `Test Bottle ${code}`,
      mlcc_code: code,
      mlcc_item_id: `mi-${code}`,
      upc: null,
      size_ml: 750,
      category: "Whiskey",
      subcategory: null,
      is_active: true,
    },
  };
}

describe("computeCartLinesHash", () => {
  it("is deterministic and order-insensitive (same lines, shuffled)", () => {
    const a = computeCartLinesHash([
      makePayloadItem("1234", 2),
      makePayloadItem("9876", 1),
      makePayloadItem("555", 12),
    ]);
    const b = computeCartLinesHash([
      makePayloadItem("555", 12),
      makePayloadItem("1234", 2),
      makePayloadItem("9876", 1),
    ]);
    expect(a).toBe(b);
    expect(a).toBe("v1:1234:2|555:12|9876:1");
  });

  it("different quantity → different hash", () => {
    const a = computeCartLinesHash([makePayloadItem("1234", 2)]);
    const b = computeCartLinesHash([makePayloadItem("1234", 3)]);
    expect(a).not.toBe(b);
  });

  it("different code → different hash", () => {
    const a = computeCartLinesHash([makePayloadItem("1234", 2)]);
    const b = computeCartLinesHash([makePayloadItem("1235", 2)]);
    expect(a).not.toBe(b);
  });

  it("added line → different hash (subset never equals superset)", () => {
    const a = computeCartLinesHash([makePayloadItem("1234", 2)]);
    const b = computeCartLinesHash([
      makePayloadItem("1234", 2),
      makePayloadItem("9876", 1),
    ]);
    expect(a).not.toBe(b);
  });

  it("returns null for empty / non-array input (nothing to identify)", () => {
    expect(computeCartLinesHash([])).toBeNull();
    expect(computeCartLinesHash(null)).toBeNull();
    expect(computeCartLinesHash(undefined)).toBeNull();
    expect(computeCartLinesHash({})).toBeNull();
  });

  it("returns null when ANY line is missing its code (fail toward no-dedupe)", () => {
    const broken = makePayloadItem("1234", 2);
    broken.bottle = { ...broken.bottle, mlcc_code: null };
    expect(
      computeCartLinesHash([makePayloadItem("555", 1), broken]),
    ).toBeNull();
  });

  it("returns null when bottle blob itself is missing", () => {
    const noBottle = { cartItemId: "ci-x", quantity: 1 };
    expect(computeCartLinesHash([noBottle])).toBeNull();
  });

  it("returns null on non-positive-integer quantities (0, negative, float, string, boolean, NaN)", () => {
    for (const badQty of [0, -1, 1.5, "2", true, Number.NaN, null, undefined]) {
      const item = makePayloadItem("1234", badQty);
      expect(computeCartLinesHash([item])).toBeNull();
    }
  });

  it("whitespace-only code is rejected; padded code is trimmed to canonical", () => {
    const padded = makePayloadItem(" 1234 ", 2);
    expect(computeCartLinesHash([padded])).toBe(
      computeCartLinesHash([makePayloadItem("1234", 2)]),
    );
    const blank = makePayloadItem("   ", 2);
    expect(computeCartLinesHash([blank])).toBeNull();
  });

  it("duplicate codes stay distinct entries and remain deterministic", () => {
    const a = computeCartLinesHash([
      makePayloadItem("1234", 2),
      makePayloadItem("1234", 3),
    ]);
    const b = computeCartLinesHash([
      makePayloadItem("1234", 3),
      makePayloadItem("1234", 2),
    ]);
    expect(a).toBe(b);
    expect(a).toBe("v1:1234:2|1234:3");
  });

  it("carries the v1 version prefix (algorithm changes can never false-match old rows)", () => {
    expect(computeCartLinesHash([makePayloadItem("1", 1)])).toMatch(/^v1:/);
  });
});
