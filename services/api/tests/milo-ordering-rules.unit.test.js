import { describe, it, expect } from "vitest";

import {
  is70000Series,
  validateQuantityForSize,
  validateAdaMinimums,
  validateCart,
  SPLIT_CASE_RULES_BY_SIZE_ML,
  ADA_MINIMUM_ORDER_LITERS,
  KNOWN_ADAS,
} from "../src/mlcc/milo-ordering-rules.js";

/**
 * Tests for the MLCC ordering rule engine.
 *
 * This module is load-bearing for THREE consumers: the scanner cart
 * validation (POST /cart/:storeId/validate), the RPA Stage 3 pre-flight,
 * and the AI assistant's validate_cart / check_order_quantity tools.
 * A regression here silently breaks all three — hence the coverage.
 */

describe("constants", () => {
  it("9-liter ADA minimum is 9", () => {
    expect(ADA_MINIMUM_ORDER_LITERS).toBe(9);
  });

  it("knows the two primary ADAs by number", () => {
    expect(KNOWN_ADAS["221"]).toMatch(/general wine/i);
    expect(KNOWN_ADAS["321"]).toMatch(/nws/i);
  });

  it("split-case table: 750ml allows 1, 3, 6", () => {
    expect(SPLIT_CASE_RULES_BY_SIZE_ML[750]).toEqual([1, 3, 6]);
  });

  it("split-case table: 50ml and 100ml are full-case-only (empty array)", () => {
    expect(SPLIT_CASE_RULES_BY_SIZE_ML[50]).toEqual([]);
    expect(SPLIT_CASE_RULES_BY_SIZE_ML[100]).toEqual([]);
  });
});

describe("is70000Series", () => {
  it("flags codes in [70000, 80000)", () => {
    expect(is70000Series("70000")).toBe(true);
    expect(is70000Series("75000")).toBe(true);
    expect(is70000Series("79999")).toBe(true);
    expect(is70000Series(72000)).toBe(true);
  });

  it("does not flag codes outside the range", () => {
    expect(is70000Series("69999")).toBe(false);
    expect(is70000Series("80000")).toBe(false);
    expect(is70000Series("750")).toBe(false);
    expect(is70000Series("100009")).toBe(false);
  });

  it("does not flag non-numeric or empty input", () => {
    expect(is70000Series("")).toBe(false);
    expect(is70000Series(null)).toBe(false);
    expect(is70000Series(undefined)).toBe(false);
    expect(is70000Series("ABC")).toBe(false);
  });
});

describe("validateQuantityForSize", () => {
  it("accepts valid split quantities for 750ml", () => {
    expect(validateQuantityForSize(1, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(3, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(6, 750, "100009").valid).toBe(true);
  });

  it("accepts full-case multiples for 750ml (12, 18, 24)", () => {
    expect(validateQuantityForSize(12, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(18, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(24, 750, "100009").valid).toBe(true);
  });

  it("rejects an invalid 750ml quantity and suggests alternatives", () => {
    const r = validateQuantityForSize(8, 750, "100009");
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(Array.isArray(r.suggestedAlternatives)).toBe(true);
    expect(r.suggestedAlternatives.length).toBeGreaterThan(0);
  });

  it("rejects 13 for 750ml (between one and two cases)", () => {
    expect(validateQuantityForSize(13, 750, "100009").valid).toBe(false);
  });

  it("1750ml allows only 1 or 3", () => {
    expect(validateQuantityForSize(1, 1750, "60418").valid).toBe(true);
    expect(validateQuantityForSize(3, 1750, "60418").valid).toBe(true);
    expect(validateQuantityForSize(2, 1750, "60418").valid).toBe(false);
    expect(validateQuantityForSize(4, 1750, "60418").valid).toBe(false);
  });

  it("100ml and 50ml are full-case-only — any split rejected", () => {
    expect(validateQuantityForSize(1, 100, "17317").valid).toBe(false);
    expect(validateQuantityForSize(6, 100, "17317").valid).toBe(false);
    expect(validateQuantityForSize(1, 50, "17316").valid).toBe(false);
  });

  it("rejects non-positive and non-integer quantities", () => {
    expect(validateQuantityForSize(0, 750, "100009").valid).toBe(false);
    expect(validateQuantityForSize(-1, 750, "100009").valid).toBe(false);
    expect(validateQuantityForSize(1.5, 750, "100009").valid).toBe(false);
  });

  it("rejects 70000-series codes regardless of size or quantity", () => {
    const r = validateQuantityForSize(6, 750, "70123");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/70000/);
  });

  it("does not block an unknown bottle size, but warns", () => {
    const r = validateQuantityForSize(5, 700, "32810");
    expect(r.valid).toBe(true);
    expect(r.reason).toMatch(/not in/i);
  });

  it("375ml allows 3, 6, 12", () => {
    expect(validateQuantityForSize(3, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(6, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(12, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(5, 375, "9091").valid).toBe(false);
  });
});

describe("validateAdaMinimums", () => {
  it("a single ADA at exactly 9L meets the minimum", () => {
    // 12 bottles x 750ml = 9000ml = 9L
    const r = validateAdaMinimums([
      { code: "100009", bottle_size_ml: 750, quantity: 12, ada_number: "221" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.adaBreakdown["221"].meetsMinimum).toBe(true);
    expect(r.adaBreakdown["221"].liters).toBeCloseTo(9);
    expect(r.failingAdas).toEqual([]);
  });

  it("a single ADA under 9L fails", () => {
    // 6 x 750ml = 4.5L
    const r = validateAdaMinimums([
      { code: "100009", bottle_size_ml: 750, quantity: 6, ada_number: "221" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.adaBreakdown["221"].meetsMinimum).toBe(false);
    expect(r.failingAdas).toContain("221");
  });

  it("evaluates each ADA independently — one OK, one short", () => {
    const r = validateAdaMinimums([
      { code: "A", bottle_size_ml: 750, quantity: 12, ada_number: "221" }, // 9L OK
      { code: "B", bottle_size_ml: 750, quantity: 6, ada_number: "321" }, // 4.5L short
    ]);
    expect(r.valid).toBe(false);
    expect(r.adaBreakdown["221"].meetsMinimum).toBe(true);
    expect(r.adaBreakdown["321"].meetsMinimum).toBe(false);
    expect(r.failingAdas).toEqual(["321"]);
  });

  it("sums multiple lines within the same ADA toward the 9L total", () => {
    const r = validateAdaMinimums([
      { code: "A", bottle_size_ml: 750, quantity: 6, ada_number: "221" }, // 4.5L
      { code: "B", bottle_size_ml: 750, quantity: 6, ada_number: "221" }, // 4.5L
    ]);
    expect(r.adaBreakdown["221"].liters).toBeCloseTo(9);
    expect(r.valid).toBe(true);
  });
});

describe("validateCart", () => {
  it("a fully valid cart passes with no errors", () => {
    const r = validateCart([
      { code: "100009", bottle_size_ml: 750, quantity: 12, ada_number: "221" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags an invalid split quantity with the product code", () => {
    const r = validateCart([
      { code: "100009", bottle_size_ml: 750, quantity: 8, ada_number: "221" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => String(e.code) === "100009")).toBe(true);
  });

  it("flags an under-9L ADA with an ADA-prefixed code", () => {
    const r = validateCart([
      { code: "100009", bottle_size_ml: 750, quantity: 6, ada_number: "221" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => String(e.code).startsWith("ADA_"))).toBe(true);
  });

  it("surfaces BOTH a split-case error and an ADA shortfall together", () => {
    // 8 x 750ml = invalid split AND 6L < 9L
    const r = validateCart([
      { code: "100009", bottle_size_ml: 750, quantity: 8, ada_number: "221" },
    ]);
    expect(r.valid).toBe(false);
    const hasQtyError = r.errors.some((e) => String(e.code) === "100009");
    const hasAdaError = r.errors.some((e) => String(e.code).startsWith("ADA_"));
    expect(hasQtyError).toBe(true);
    expect(hasAdaError).toBe(true);
  });
});
