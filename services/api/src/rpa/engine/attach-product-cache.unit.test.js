import { describe, it, expect } from "vitest";

import { attachMiloProductCache } from "./attach-product-cache.js";

const DIST = { id: 5, referenceNumber: "221", name: "General Wine & Liquor" };

/**
 * attachMiloProductCache — money-path seam. A wrong code→productId match would
 * order the WRONG bottle, so these tests are adversarial: partial/malformed
 * cache rows must NEVER attach (the item must fall through to a live resolve),
 * and only an EXACT code match may attach.
 */
describe("attachMiloProductCache", () => {
  it("attaches id + distributor on an exact code match", () => {
    const items = [{ code: "9121", quantity: 12 }];
    const rows = [{ code: "9121", milo_product_id: "99955686451243", milo_distributor: DIST }];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(1);
    expect(out[0].miloProduct).toEqual({ id: "99955686451243", distributor: DIST });
    expect(out[0].quantity).toBe(12);
  });

  it("a code with no cache row passes through untouched (→ live resolve)", () => {
    const items = [{ code: "9121", quantity: 1 }, { code: "0000", quantity: 2 }];
    const rows = [{ code: "9121", milo_product_id: "123", milo_distributor: DIST }];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(1);
    expect(out[0].miloProduct).toBeDefined();
    expect(out[1].miloProduct).toBeUndefined();
  });

  it("NEVER attaches when productId is null / empty / whitespace", () => {
    const items = [{ code: "a", quantity: 1 }, { code: "b", quantity: 1 }, { code: "c", quantity: 1 }];
    const rows = [
      { code: "a", milo_product_id: null, milo_distributor: DIST },
      { code: "b", milo_product_id: "", milo_distributor: DIST },
      { code: "c", milo_product_id: "   ", milo_distributor: DIST },
    ];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(0);
    expect(out.every((i) => i.miloProduct === undefined)).toBe(true);
  });

  it("NEVER attaches when distributor is null / not an object / an array", () => {
    const items = [{ code: "a", quantity: 1 }, { code: "b", quantity: 1 }, { code: "c", quantity: 1 }];
    const rows = [
      { code: "a", milo_product_id: "1", milo_distributor: null },
      { code: "b", milo_product_id: "2", milo_distributor: "221" },
      { code: "c", milo_product_id: "3", milo_distributor: [DIST] },
    ];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(0);
    expect(out.every((i) => i.miloProduct === undefined)).toBe(true);
  });

  it("matches across string/number code types (both normalized to string)", () => {
    const items = [{ code: 9121, quantity: 1 }];
    const rows = [{ code: "9121", milo_product_id: "77", milo_distributor: DIST }];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(1);
    expect(out[0].miloProduct.id).toBe("77");
  });

  it("coerces a numeric productId to a STRING (no float precision loss)", () => {
    const items = [{ code: "x", quantity: 1 }];
    const rows = [{ code: "x", milo_product_id: 252063246, milo_distributor: DIST }];
    const { items: out } = attachMiloProductCache(items, rows);
    expect(out[0].miloProduct.id).toBe("252063246");
    expect(typeof out[0].miloProduct.id).toBe("string");
  });

  it("does not mutate the original items array or objects", () => {
    const items = [{ code: "9121", quantity: 12 }];
    const rows = [{ code: "9121", milo_product_id: "1", milo_distributor: DIST }];
    attachMiloProductCache(items, rows);
    expect(items[0].miloProduct).toBeUndefined();
  });

  it("is safe on non-array inputs", () => {
    expect(attachMiloProductCache(null, null)).toEqual({ items: [], hits: 0 });
    expect(attachMiloProductCache(undefined, [])).toEqual({ items: [], hits: 0 });
    const r = attachMiloProductCache([{ code: "a", quantity: 1 }], "not-an-array");
    expect(r.hits).toBe(0);
    expect(r.items).toHaveLength(1);
  });

  it("skips malformed cache rows (null row, missing code) without throwing", () => {
    const items = [{ code: "a", quantity: 1 }];
    const rows = [null, {}, { milo_product_id: "1", milo_distributor: DIST }, { code: "a", milo_product_id: "9", milo_distributor: DIST }];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(1);
    expect(out[0].miloProduct.id).toBe("9");
  });

  it("skips a malformed cart item (null / missing code) without throwing", () => {
    const items = [null, { quantity: 5 }, { code: "a", quantity: 1 }];
    const rows = [{ code: "a", milo_product_id: "9", milo_distributor: DIST }];
    const { items: out, hits } = attachMiloProductCache(items, rows);
    expect(hits).toBe(1);
    expect(out[2].miloProduct.id).toBe("9");
  });
});
