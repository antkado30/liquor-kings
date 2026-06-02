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

  it("split-case table: 750ml allows 1, 3, 6, 12", () => {
    // Bug fix 2026-06-02: previously the table was [1, 3, 6] which
    // made 18 (= 6 × 3) validate as a "multiple of largest." But MLCC
    // rejects 18 at Stage 4 with "Invalid split quantities" — actual
    // rule is "multiples of the full case (12)" after the sub-splits.
    expect(SPLIT_CASE_RULES_BY_SIZE_ML[750]).toEqual([1, 3, 6, 12]);
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

  it("accepts full-case multiples for 750ml (12, 24, 36)", () => {
    // Fix 2026-06-02: was previously asserting 18 is valid, which it
    // is NOT. MLCC rejects 18 × 750ml at Stage 4. Full case = 12, so
    // valid multiples are 12, 24, 36, 48...
    expect(validateQuantityForSize(12, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(24, 750, "100009").valid).toBe(true);
    expect(validateQuantityForSize(36, 750, "100009").valid).toBe(true);
  });

  it("rejects 18 × 750ml (the prod-observed false-valid)", () => {
    // Regression guard for the 2026-06-02 bug. 18 = 6 × 3 satisfied
    // the old `q % largest === 0` check when largest=6, but MLCC
    // rejects it ("Invalid split quantities, please fix...").
    expect(validateQuantityForSize(18, 750, "100009").valid).toBe(false);
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

  it("1750ml allows 1, 3, 6 (full case)", () => {
    // Updated 2026-06-02: full case for 1.75L at MLCC is 6 bottles.
    // [1, 3, 6] makes 6 (one full case) explicitly valid and
    // multiples-of-6 (12, 18) valid via Math.max(...).
    expect(validateQuantityForSize(1, 1750, "60418").valid).toBe(true);
    expect(validateQuantityForSize(3, 1750, "60418").valid).toBe(true);
    expect(validateQuantityForSize(6, 1750, "60418").valid).toBe(true);
    expect(validateQuantityForSize(12, 1750, "60418").valid).toBe(true);
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

  it("375ml allows 3, 6, 12, 24 (full case) and rejects 36 (1.5 cases)", () => {
    // 2026-06-02: full case for 375ml = 24. Old table was [3, 6, 12]
    // which made 36 valid as "multiple of 12" — MLCC actually rejects
    // 36 (it's 1.5 cases). New table [3, 6, 12, 24] makes 24, 48,
    // 72 valid and 36 invalid.
    expect(validateQuantityForSize(3, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(6, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(12, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(24, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(48, 375, "9091").valid).toBe(true);
    expect(validateQuantityForSize(5, 375, "9091").valid).toBe(false);
    expect(validateQuantityForSize(36, 375, "9091").valid).toBe(false);
  });
});

describe("validateQuantityForSize — full-case-only sizes (50ml / 100ml)", () => {
  /**
   * 50ml/100ml allow NO splits, but a whole case IS orderable (the store
   * orders Crown Royal 50ml minis a full case of 60 every week). The case
   * size is product-specific, so it must be supplied. Regression guard:
   * before this, EVERY 50/100ml line was hard-rejected, even a full case.
   */
  it("accepts a single full case when case size is supplied", () => {
    expect(validateQuantityForSize(60, 50, "3378", 60).valid).toBe(true);
    expect(validateQuantityForSize(48, 100, "9124", 48).valid).toBe(true);
  });

  it("accepts multiple whole cases", () => {
    expect(validateQuantityForSize(120, 50, "3378", 60).valid).toBe(true);
    expect(validateQuantityForSize(180, 50, "3378", 60).valid).toBe(true);
  });

  it("rejects a partial case and suggests whole-case quantities", () => {
    const r = validateQuantityForSize(30, 50, "3378", 60);
    expect(r.valid).toBe(false);
    expect(r.suggestedAlternatives).toContain(60);
  });

  it("rejects a quantity between two cases (90 of a 60-case = 1.5 cases)", () => {
    const r = validateQuantityForSize(90, 50, "3378", 60);
    expect(r.valid).toBe(false);
    expect(r.suggestedAlternatives).toEqual([60, 120]);
  });

  it("rejects when case size is missing — cannot verify a full-case-only size", () => {
    const r = validateQuantityForSize(60, 50, "3378");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/case size/i);
  });

  it("rejects when case size is zero or not an integer", () => {
    expect(validateQuantityForSize(60, 50, "3378", 0).valid).toBe(false);
    expect(validateQuantityForSize(60, 50, "3378", 12.5).valid).toBe(false);
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

  it("passes a 50ml full-case line when case_size is supplied and the ADA clears 9L", () => {
    // 60 x 50ml = 3L + 12 x 750ml = 9L → 12L on ADA 321, both rules satisfied.
    const r = validateCart([
      { code: "3378", bottle_size_ml: 50, quantity: 60, ada_number: "321", case_size: 60 },
      { code: "100009", bottle_size_ml: 750, quantity: 12, ada_number: "321" },
    ]);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags a 50ml line at a non-case quantity even when the ADA clears 9L", () => {
    const r = validateCart([
      { code: "3378", bottle_size_ml: 50, quantity: 30, ada_number: "321", case_size: 60 },
      { code: "100009", bottle_size_ml: 750, quantity: 12, ada_number: "321" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => String(e.code) === "3378")).toBe(true);
  });

  it("flags a 50ml line when case_size is absent — quantity cannot be verified", () => {
    const r = validateCart([
      { code: "3378", bottle_size_ml: 50, quantity: 60, ada_number: "321" },
      { code: "100009", bottle_size_ml: 750, quantity: 12, ada_number: "321" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => String(e.code) === "3378")).toBe(true);
  });
});
