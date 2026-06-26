import { describe, it, expect } from "vitest";

import { cartExactlyMatchesRequest } from "../src/lib/cart-match.js";

/**
 * Tests for cartExactlyMatchesRequest — the pure correctness core for the
 * upcoming "skip re-add when unchanged" RPA optimization. The bias must ALWAYS
 * be toward { match: false }: a false "match" validates a stale cart, while a
 * false "no-match" only costs a harmless re-add. Every rule has dedicated
 * coverage, including malformed input and order-independence.
 */

describe("cartExactlyMatchesRequest — exact matches", () => {
  it("matches when codes + quantities are identical, same order", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });

  it("matches when the cart is in a different order (order-independence)", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
        { code: "789", quantity: 4 },
      ],
      [
        { code: "789", quantity: 4 },
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });

  it("treats numeric and string codes as equivalent (123 vs '123')", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: 123, quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [
        { code: "123", quantity: 2 },
        { code: 456, quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });

  it("trims whitespace around codes before comparing", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: " 123 ", quantity: 2 }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });

  it("ignores extra fields on the line objects", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 2, name: "Tito's", price: 19.99 }],
      [{ code: "123", quantity: 2, whatever: "ignored" }],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });

  it("matches a single-item cart", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 1 }],
      [{ code: "123", quantity: 1 }],
    );
    expect(r).toEqual({ match: true, reason: "exact_match" });
  });
});

describe("cartExactlyMatchesRequest — quantity mismatches", () => {
  it("returns false with qty_mismatch:<code> when one quantity differs", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 3 },
      ],
    );
    expect(r.match).toBe(false);
    expect(r.reason).toBe("qty_mismatch:456");
  });

  it("reports qty_mismatch for the differing code even when counts differ", () => {
    // Same codes, different qty on 123; 456 present on both equally.
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [
        { code: "123", quantity: 5 },
        { code: "456", quantity: 1 },
      ],
    );
    expect(r.match).toBe(false);
    expect(r.reason).toBe("qty_mismatch:123");
  });
});

describe("cartExactlyMatchesRequest — count / missing / extra", () => {
  it("returns false when the request has an extra item (count_mismatch)", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "count_mismatch" });
  });

  it("returns false when the cart has an extra item (count_mismatch)", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 2 }],
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: false, reason: "count_mismatch" });
  });

  it("returns false with missing:<code> when equal sizes but a code differs", () => {
    // Sizes are equal (2 vs 2) but 456 is requested and 999 is in the cart.
    // Rule 5 (count) passes, so rule 6 fires: the request loop reports the
    // requested code that's absent from the cart.
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [
        { code: "123", quantity: 2 },
        { code: "999", quantity: 1 },
      ],
    );
    expect(r.match).toBe(false);
    expect(r.reason).toBe("missing:456");
  });

  it("reports missing:<code> from the request's perspective when sets differ at equal size", () => {
    // Symmetric to the above: the absent requested code is 999 here.
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "999", quantity: 1 },
      ],
      [
        { code: "123", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
    );
    expect(r.match).toBe(false);
    expect(r.reason).toBe("missing:999");
  });
});

describe("cartExactlyMatchesRequest — empty inputs", () => {
  it("returns false with empty_request for an empty request", () => {
    const r = cartExactlyMatchesRequest([], [{ code: "123", quantity: 2 }]);
    expect(r).toEqual({ match: false, reason: "empty_request" });
  });

  it("returns false with empty_request when both are empty", () => {
    const r = cartExactlyMatchesRequest([], []);
    expect(r).toEqual({ match: false, reason: "empty_request" });
  });

  it("returns false with empty_request for null/undefined request", () => {
    expect(cartExactlyMatchesRequest(null, [{ code: "1", quantity: 1 }])).toEqual({
      match: false,
      reason: "empty_request",
    });
    expect(cartExactlyMatchesRequest(undefined, [])).toEqual({
      match: false,
      reason: "empty_request",
    });
  });

  it("returns a non-empty-request mismatch when the cart is empty but the request is not", () => {
    const r = cartExactlyMatchesRequest([{ code: "123", quantity: 2 }], []);
    expect(r.match).toBe(false);
    // Sizes differ (1 vs 0) → count_mismatch.
    expect(r.reason).toBe("count_mismatch");
  });

  it("treats a null cart as an empty cart (non-empty request → no match)", () => {
    const r = cartExactlyMatchesRequest([{ code: "123", quantity: 2 }], null);
    expect(r.match).toBe(false);
    expect(r.reason).toBe("count_mismatch");
  });
});

describe("cartExactlyMatchesRequest — malformed input (bias to false)", () => {
  it("returns malformed_code for a blank/whitespace requested code", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "   ", quantity: 2 },
        { code: "456", quantity: 1 },
      ],
      [{ code: "456", quantity: 1 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_code" });
  });

  it("returns malformed_code for a blank cart code", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 2 }],
      [
        { code: "123", quantity: 2 },
        { code: "", quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: false, reason: "malformed_code" });
  });

  it("returns malformed_code when code is missing/null on a line", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: null, quantity: 2 }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_code" });
  });

  it("returns malformed_code for a non-object line entry", () => {
    const r = cartExactlyMatchesRequest(
      // @ts-expect-error intentionally malformed
      [{ code: "123", quantity: 2 }, "garbage"],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_code" });
  });

  it("returns malformed_qty for quantity 0", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 0 }],
      [{ code: "123", quantity: 0 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for a negative quantity", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: -3 }],
      [{ code: "123", quantity: -3 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for NaN quantity", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: NaN }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for Infinity quantity", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: Infinity }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for a non-integer quantity (2.5)", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 2.5 }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for a non-number quantity ('2')", () => {
    const r = cartExactlyMatchesRequest(
      // @ts-expect-error intentionally malformed
      [{ code: "123", quantity: "2" }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for a missing quantity", () => {
    const r = cartExactlyMatchesRequest(
      // @ts-expect-error intentionally malformed
      [{ code: "123" }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });

  it("returns malformed_qty for a boolean quantity (not a number)", () => {
    const r = cartExactlyMatchesRequest(
      // @ts-expect-error intentionally malformed
      [{ code: "123", quantity: true }],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "malformed_qty" });
  });
});

describe("cartExactlyMatchesRequest — duplicates", () => {
  it("returns duplicate_code for a duplicate code in the request", () => {
    const r = cartExactlyMatchesRequest(
      [
        { code: "123", quantity: 2 },
        { code: "123", quantity: 1 },
      ],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "duplicate_code" });
  });

  it("returns duplicate_code for a duplicate code in the cart", () => {
    const r = cartExactlyMatchesRequest(
      [{ code: "123", quantity: 2 }],
      [
        { code: "123", quantity: 2 },
        { code: "123", quantity: 1 },
      ],
    );
    expect(r).toEqual({ match: false, reason: "duplicate_code" });
  });

  it("treats numeric-vs-string of the same code as a duplicate within one list", () => {
    // 123 and "123" normalize to the same code → duplicate within the request.
    const r = cartExactlyMatchesRequest(
      [
        { code: 123, quantity: 2 },
        { code: "123", quantity: 1 },
      ],
      [{ code: "123", quantity: 2 }],
    );
    expect(r).toEqual({ match: false, reason: "duplicate_code" });
  });
});

describe("cartExactlyMatchesRequest — result shape", () => {
  it("always returns an object with boolean match and string reason", () => {
    const cases = [
      cartExactlyMatchesRequest(
        [{ code: "1", quantity: 1 }],
        [{ code: "1", quantity: 1 }],
      ),
      cartExactlyMatchesRequest([], []),
      cartExactlyMatchesRequest(
        [{ code: "1", quantity: 1 }],
        [{ code: "2", quantity: 1 }],
      ),
    ];
    for (const r of cases) {
      expect(typeof r).toBe("object");
      expect(r).not.toBeNull();
      expect(typeof r.match).toBe("boolean");
      expect(typeof r.reason).toBe("string");
    }
  });
});
