import { describe, it, expect } from "vitest";

import { parseMiloValidate } from "./parse-milo-validate.js";
import cartFixture from "./__fixtures__/cart.json";
import inventoryFixture from "./__fixtures__/inventory.json";
import validateFixture from "./__fixtures__/validate.json";
import delivery141 from "./__fixtures__/delivery-141.json";
import delivery221 from "./__fixtures__/delivery-221.json";
import delivery321 from "./__fixtures__/delivery-321.json";

const deliveryByRef = { "141": delivery141, "221": delivery221, "321": delivery321 };

/**
 * parseMiloValidate — pure drop-in for the DOM-scraped validate result. Field
 * names must match validate-cart.js exactly. Bias is to SAFE: a missing
 * inventory row is never assumed in-stock; malformed input never throws.
 */
describe("parseMiloValidate", () => {
  it("happy path: validated, canCheckout, 0 OOS, 2 ADA orders w/ delivery dates, netTotal present", () => {
    const r = parseMiloValidate({ cart: cartFixture, inventory: inventoryFixture, validate: validateFixture, deliveryByRef });
    expect(r.validated).toBe(true);
    expect(r.canCheckout).toBe(true);
    expect(r.outOfStockItems).toHaveLength(0);
    expect(r.adaOrders).toHaveLength(2);
    for (const a of r.adaOrders) {
      expect(a.deliveryDate).toBeTruthy();
      expect(a.meetsMinimum).toBe(true);
    }
    expect(r.orderSummary.netTotal).toBe(529.08);
    // orderSummary matches validate-cart keys + sign convention (discount negative).
    expect(r.orderSummary.grossTotal).toBe(556.8);
    expect(r.orderSummary.liquorTax).toBe(66.96);
    expect(r.orderSummary.discount).toBe(-94.68);
    // deliveryDates carries all three ADAs.
    expect(r.deliveryDates["141"]).toBe("2026-07-02");
    expect(r.deliveryDates["221"]).toBe("2026-07-07");
    expect(r.deliveryDates["321"]).toBe("2026-07-07");
  });

  it("an item available:false lands in outOfStockItems and blocks canCheckout", () => {
    const inv = inventoryFixture.map((r) =>
      r.itemCode === "11022" ? { ...r, available: false } : r,
    );
    const r = parseMiloValidate({ cart: cartFixture, inventory: inv, validate: validateFixture, deliveryByRef });
    expect(r.validated).toBe(true);
    expect(r.canCheckout).toBe(false);
    const oos = r.outOfStockItems.find((o) => o.code === "11022");
    expect(oos).toBeDefined();
    expect(oos.needsRecheck).toBe(false);
    expect(oos.reason).toBe("oos_section");
    expect(oos.adaName).toBeTruthy();
  });

  it("an ADA under 9L → meetsMinimum false and canCheckout false", () => {
    // Drop 11022 (750ml) to qty 1 → 0.75L for ADA 221, below the 9L minimum.
    const cart = {
      ...cartFixture,
      items: cartFixture.items.map((it) =>
        it.product.code === "11022"
          ? { ...it, quantity: 1, total: it.product.price * 1 }
          : it,
      ),
    };
    const r = parseMiloValidate({ cart, inventory: inventoryFixture, validate: validateFixture, deliveryByRef });
    const ada221 = r.adaOrders.find((a) => a.adaNumber === "221");
    expect(ada221.meetsMinimum).toBe(false);
    expect(ada221.subtotalLiters).toBeLessThan(9);
    expect(r.canCheckout).toBe(false);
  });

  it("an ordered item missing from inventory is flagged needsRecheck (not silently in-stock)", () => {
    const invMissing = inventoryFixture.filter((r) => r.itemCode !== "11022");
    const r = parseMiloValidate({ cart: cartFixture, inventory: invMissing, validate: validateFixture, deliveryByRef });
    const nr = r.outOfStockItems.find((o) => o.code === "11022");
    expect(nr).toBeDefined();
    expect(nr.needsRecheck).toBe(true);
    expect(nr.reason).toBe("needs_recheck");
    expect(r.canCheckout).toBe(false); // safe bias: can't checkout with an uncertain item
  });

  it("malformed / empty inputs return validated:false and never throw", () => {
    const empty = parseMiloValidate({});
    expect(empty.validated).toBe(false);
    expect(empty.canCheckout).toBe(false);
    expect(empty.adaOrders).toEqual([]);
    expect(empty.outOfStockItems).toEqual([]);

    const nulls = parseMiloValidate({ cart: null, inventory: null, validate: null, deliveryByRef: null });
    expect(nulls.validated).toBe(false);

    // validate.success !== true → validated false even with a cart.
    const failedValidate = parseMiloValidate({ cart: cartFixture, inventory: inventoryFixture, validate: { success: false }, deliveryByRef });
    expect(failedValidate.validated).toBe(false);
    expect(failedValidate.canCheckout).toBe(false);

    // Garbage shapes don't throw.
    expect(() => parseMiloValidate({ cart: "nope", inventory: 42, validate: [], deliveryByRef: "x" })).not.toThrow();
  });

  it("adaOrders item shape matches validate-cart (code/name/bottleSizeMl/quantity/liters/lineTotal)", () => {
    const r = parseMiloValidate({ cart: cartFixture, inventory: inventoryFixture, validate: validateFixture, deliveryByRef });
    const item = r.adaOrders[0].items[0];
    expect(item).toHaveProperty("code");
    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("bottleSizeMl");
    expect(item).toHaveProperty("quantity");
    expect(item).toHaveProperty("liters");
    expect(item).toHaveProperty("lineTotal");
    expect(item).toHaveProperty("outOfStock");
    // liters reconciles: qty * sizeMl / 1000
    if (item.bottleSizeMl && item.quantity) {
      expect(item.liters).toBeCloseTo((item.quantity * item.bottleSizeMl) / 1000, 3);
    }
  });
});
