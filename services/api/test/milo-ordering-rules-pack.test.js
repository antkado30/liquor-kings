/**
 * Pack-aware validator pins (2026-08-10, the Party Bucket blocker):
 * the cart validator was still counting bottles after the display got
 * pack-aware — qty 6 of a 20-pack (case 120 bottles = 6 packs) was
 * BLOCKED with "not a whole multiple of the 120-bottle case" and
 * Check disabled. Never again.
 */
import { describe, expect, it } from "vitest";
import {
  validateAdaMinimums,
  validateCart,
  validateQuantityForSize,
} from "../src/mlcc/milo-ordering-rules.js";

describe("pack-aware validateQuantityForSize", () => {
  it("6 packs of a 20-pack/case-120 bucket is VALID", () => {
    expect(validateQuantityForSize(6, 50, "25553", 120, 20).valid).toBe(true);
  });
  it("4 packs of a 20-pack/case-120 bucket is invalid with pack-words reason", () => {
    const r = validateQuantityForSize(4, 50, "25553", 120, 20);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("6 packs");
    expect(r.suggestedAlternatives).toEqual([6]);
  });
  it("25-pack/case-150 bucket validates at 6 (Tony's 99 Assorted)", () => {
    expect(validateQuantityForSize(6, 50, "53791", 150, 25).valid).toBe(true);
  });
  it("plain 50ml without pack still demands bottle multiples", () => {
    const r = validateQuantityForSize(6, 50, "11111", 120, undefined);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("120-bottle case");
  });
  it("dirty division keeps bottle math (honesty over guessing)", () => {
    const r = validateQuantityForSize(6, 50, "22222", 120, 7);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("120-bottle case");
  });
});

describe("pack-aware ADA liters", () => {
  it("6 × 20-pack × 50ml counts as 6L, not 0.3L", () => {
    const r = validateAdaMinimums([
      { code: "25553", bottle_size_ml: 50, quantity: 6, ada_number: "417", pack_count: 20 },
    ]);
    expect(r.adaBreakdown["417"].liters).toBeCloseTo(6);
  });
  it("validateCart passes a clean bucket line end to end", () => {
    const r = validateCart([
      { code: "25553", bottle_size_ml: 50, quantity: 6, ada_number: "417", case_size: 120, pack_count: 20 },
      { code: "99999", bottle_size_ml: 750, quantity: 12, ada_number: "417" },
    ]);
    expect(r.errors.filter((e) => e.code === "25553")).toHaveLength(0);
  });
});
