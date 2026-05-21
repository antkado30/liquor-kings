import { describe, it, expect } from "vitest";

import { validateCartByCodes } from "../src/lib/cart-validation.js";

/**
 * Tests for validateCartByCodes — the shared validator behind both the
 * POST /cart/:storeId/validate endpoint and the assistant's validate_cart
 * tool. It enriches [{code,quantity}] from mlcc_items, then runs the rule
 * engine. These tests stub the Supabase client so the focus stays on the
 * enrichment + result-shaping logic.
 */

/**
 * Minimal chainable Supabase stub. Every filter method returns the builder;
 * the builder is thenable so `await supabase.from(t).select(c).in(col,v)`
 * resolves to { data, error } regardless of where the chain ends.
 */
function mockSupabase({ rows = [], error = null } = {}) {
  const result = { data: rows, error };
  const builder = {
    select: () => builder,
    in: () => builder,
    is: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error }),
    then: (resolve) => resolve(result),
  };
  return { from: () => builder };
}

describe("validateCartByCodes — input guards", () => {
  it("rejects a non-array / empty items list", async () => {
    expect((await validateCartByCodes(mockSupabase(), [])).ok).toBe(false);
    expect((await validateCartByCodes(mockSupabase(), null)).ok).toBe(false);
    expect((await validateCartByCodes(mockSupabase(), undefined)).ok).toBe(false);
  });

  it("rejects items that carry no usable codes", async () => {
    const r = await validateCartByCodes(mockSupabase(), [
      { code: "", quantity: 1 },
      { code: "   ", quantity: 2 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no valid product codes/i);
  });

  it("surfaces a Supabase lookup error", async () => {
    const r = await validateCartByCodes(
      mockSupabase({ error: { message: "connection reset" } }),
      [{ code: "100009", quantity: 12 }],
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/catalog lookup failed/i);
  });

  it("fails cleanly when none of the codes exist in the catalog", async () => {
    const r = await validateCartByCodes(mockSupabase({ rows: [] }), [
      { code: "999999", quantity: 12 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/none of the cart codes/i);
    expect(r.unknownCodes).toContain("999999");
  });
});

describe("validateCartByCodes — rule outcomes", () => {
  it("a valid cart (12 x 750ml, one ADA = 9L) passes", async () => {
    const supabase = mockSupabase({
      rows: [
        { code: "100009", name: "FRIS VODKA 100 PROOF", size_ml: 750, ada_number: "221" },
      ],
    });
    const r = await validateCartByCodes(supabase, [
      { code: "100009", quantity: 12 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.adaBreakdown["221"].meetsMinimum).toBe(true);
  });

  it("an under-9L cart is ok:true but valid:false", async () => {
    const supabase = mockSupabase({
      rows: [
        { code: "100009", name: "FRIS VODKA 100 PROOF", size_ml: 750, ada_number: "221" },
      ],
    });
    const r = await validateCartByCodes(supabase, [
      { code: "100009", quantity: 6 }, // 4.5L
    ]);
    expect(r.ok).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("an invalid split quantity flags valid:false", async () => {
    const supabase = mockSupabase({
      rows: [
        { code: "100009", name: "FRIS VODKA 100 PROOF", size_ml: 750, ada_number: "221" },
      ],
    });
    const r = await validateCartByCodes(supabase, [
      { code: "100009", quantity: 8 }, // not a legal 750ml split
    ]);
    expect(r.ok).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => String(e.code) === "100009")).toBe(true);
  });

  it("validates known codes and reports unknown ones separately", async () => {
    const supabase = mockSupabase({
      rows: [
        { code: "100009", name: "FRIS VODKA 100 PROOF", size_ml: 750, ada_number: "221" },
      ],
    });
    const r = await validateCartByCodes(supabase, [
      { code: "100009", quantity: 12 },
      { code: "404404", quantity: 3 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.unknownCodes).toContain("404404");
    expect(r.itemsValidated.some((i) => i.code === "100009")).toBe(true);
  });
});
