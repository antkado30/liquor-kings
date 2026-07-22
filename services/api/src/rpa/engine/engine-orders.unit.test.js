/**
 * engine-orders.unit.test.js — the node submit path's confirmation source.
 *
 * The fixtures below are structural COPIES of the real GET /users/orders
 * response probed live on the worker 2026-07-22 (Tony's actual 7/16 order —
 * order 274509587, confirmation 5806580, ADA 221 — field-for-field, values
 * lightly edited). If MILO ever changes this shape, these tests are the
 * tripwire and the fixtures are the record of what the shape USED to be.
 *
 * The most important test is the LAST one: normalized blocks feed the REAL
 * persist-service row builder (buildMiloConfirmationRows) and must come out
 * as correct, ADA-keyed confirmation rows — proving the node path and the
 * browser path share one persistence contract.
 */
import { describe, it, expect, vi } from "vitest";

import {
  fetchMiloOrders,
  normalizeMiloApiOrder,
  selectOrdersForSubmit,
  buildConfirmationMapFromOrders,
} from "./engine-orders.js";
import { buildMiloConfirmationRows } from "../../services/milo-order-confirmations.service.js";

/** Real-shape API order (7/16 GW&L order, values as probed). */
const apiOrder221 = () => ({
  orderNumber: 274509587,
  licenseNumber: "430342",
  placedOn: "2026-07-16T22:28:10.376Z",
  anticipatedDeliveryDate: "2026-07-22",
  confirmationNumber: "5806580",
  distributor: {
    createdBy: "system",
    id: "2",
    referenceNumber: "221",
    name: "General Wine & Liquor",
    abbreviation: null,
    active: true,
  },
  items: [
    {
      id: 0,
      product: {
        id: "99955686434837",
        code: "3797",
        name: "PLATINUM 7X PL",
        price: 8.03,
        caseSize: 12,
        proof: "80",
        distributor: { id: "2", referenceNumber: "221", name: "General Wine & Liquor" },
        sizeInMilliliters: 750,
        bottlesPerPack: 1,
      },
      quantity: 6,
      unitPrice: 8.03,
      available: true,
      updatedByAda: true,
      discountPercent: 17,
      orderType: "MILO",
      total: 48.18,
      originalTotal: 0,
    },
  ],
  taxAmt: 478.05,
  salesTaxAmt: 0,
  discountAmt: 680.29,
  total: 3998.07,
  netTotalAmt: 3795.83,
  originalTaxAmt: 472.56,
  originalDiscountAmt: 672.55,
  originalTotal: 3952.59,
  originalNetTotalAmt: 3752.6000000000004,
  updatedByAda: true,
  originalDeliveryDate: "2026-07-21",
  orderType: "MILO",
  adaConfirmed: true,
  addedByAda: false,
});

const apiOrder321 = () => ({
  ...apiOrder221(),
  orderNumber: 274509604,
  placedOn: "2026-07-16T22:28:11.578Z",
  confirmationNumber: "31002245",
  distributor: { id: "3", referenceNumber: "321", name: "NWS Michigan, Inc.", active: true },
  originalTotal: 1650.0,
  originalNetTotalAmt: 1585.66,
  updatedByAda: false,
  adaConfirmed: true,
});

/** An older order that must be filtered out of a fresh submit's selection. */
const oldApiOrder = () => ({
  ...apiOrder221(),
  orderNumber: 273585497,
  placedOn: "2026-07-09T23:23:47.640Z",
  confirmationNumber: "5784369",
});

describe("normalizeMiloApiOrder", () => {
  it("maps the real API shape into the browser-parser historyOrders block", () => {
    const n = normalizeMiloApiOrder(apiOrder221());
    expect(n.confirmationNumber).toBe("5806580");
    expect(n.orderNumber).toBe("274509587"); // numeric → string
    expect(n.adaNumber).toBe("221"); // structured, no name inference
    expect(n.distributorRaw).toBe("General Wine & Liquor");
    expect(n.licenseNumber).toBe("430342");
    expect(n.placedIso).toBe("2026-07-16T22:28:10.376Z");
    expect(n.placedDate).toBe("2026-07-16");
    expect(n.status).toBe("Confirmed");
    expect(n.updatedByAda).toBe(true);
  });

  it("prefers AT-PLACEMENT money truth (original*) over ADA-edited current totals", () => {
    const n = normalizeMiloApiOrder(apiOrder221());
    expect(n.total).toBe(3752.6); // originalNetTotalAmt, rounded — the postmortem's penny-exact net
    expect(n.subtotal).toBe(3952.59); // originalTotal
  });

  it("falls back to current totals when original* fields are absent", () => {
    const o = apiOrder221();
    delete o.originalNetTotalAmt;
    delete o.originalTotal;
    const n = normalizeMiloApiOrder(o);
    expect(n.total).toBe(3795.83);
    expect(n.subtotal).toBe(3998.07);
  });

  it("prefers originalDeliveryDate over anticipatedDeliveryDate (ADA edits move dates)", () => {
    const n = normalizeMiloApiOrder(apiOrder221());
    expect(n.deliveryRaw).toBe("2026-07-21");
  });

  it("maps line items to the browser lineItems shape (code/name/qty/price/subtotal/type)", () => {
    const n = normalizeMiloApiOrder(apiOrder221());
    expect(n.lineItems).toEqual([
      {
        liquorCode: "3797",
        productName: "PLATINUM 7X PL",
        quantity: 6,
        unitPrice: 8.03,
        lineSubtotal: 48.18,
        orderType: "MILO",
      },
    ]);
    expect(n.lineItemCount).toBe(1);
  });

  it("never throws on junk — nulls through", () => {
    expect(normalizeMiloApiOrder(null)).toBeNull();
    expect(normalizeMiloApiOrder("nope")).toBeNull();
    const n = normalizeMiloApiOrder({});
    expect(n.confirmationNumber).toBeNull();
    expect(n.adaNumber).toBeNull();
    expect(n.lineItems).toEqual([]);
  });
});

describe("selectOrdersForSubmit", () => {
  const normalizedHistory = () =>
    [apiOrder221(), apiOrder321(), oldApiOrder()].map(normalizeMiloApiOrder);

  it("selects exactly the orders placed after dispatch (7/16 pair in, 7/09 out)", () => {
    const selected = selectOrdersForSubmit(normalizedHistory(), {
      dispatchedAtIso: "2026-07-16T22:27:30.000Z", // ~40s before MILO stamped them (real lag)
      expectedCount: 2,
      licenseNumber: "430342",
    });
    expect(selected.map((o) => o.confirmationNumber).sort()).toEqual(["31002245", "5806580"]);
  });

  it("tolerates clock skew — an order stamped slightly BEFORE dispatch still matches", () => {
    const selected = selectOrdersForSubmit(normalizedHistory(), {
      dispatchedAtIso: "2026-07-16T22:29:00.000Z", // dispatch 'after' placedOn by <180s
      expectedCount: 2,
      licenseNumber: "430342",
    });
    expect(selected).toHaveLength(2);
  });

  it("excludes other licenses and caps at expectedCount (never claims someone else's order)", () => {
    const foreign = normalizeMiloApiOrder({ ...apiOrder221(), licenseNumber: "999999", confirmationNumber: "777" });
    const selected = selectOrdersForSubmit([...normalizedHistory(), foreign], {
      dispatchedAtIso: "2026-07-16T22:27:30.000Z",
      expectedCount: 1,
      licenseNumber: "430342",
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].confirmationNumber).toBe("31002245"); // most recent wins the cap
  });

  it("returns [] on missing dispatch timestamp or timestampless orders (unattributable = unclaimed)", () => {
    expect(selectOrdersForSubmit(normalizedHistory(), { expectedCount: 2 })).toEqual([]);
    const noTs = normalizeMiloApiOrder({ ...apiOrder221(), placedOn: null });
    expect(
      selectOrdersForSubmit([noTs], {
        dispatchedAtIso: "2026-07-16T22:27:30.000Z",
        expectedCount: 1,
      }),
    ).toEqual([]);
  });
});

describe("buildConfirmationMapFromOrders", () => {
  it("keys by structured ADA number with ada_<n> fallback; skips no-confirmation orders", () => {
    const a = normalizeMiloApiOrder(apiOrder221());
    const b = normalizeMiloApiOrder(apiOrder321());
    const noAda = { ...a, adaNumber: null, confirmationNumber: "444" };
    const noConf = { ...b, confirmationNumber: null };
    expect(buildConfirmationMapFromOrders([a, b])).toEqual({ "221": "5806580", "321": "31002245" });
    expect(buildConfirmationMapFromOrders([a, noAda, noConf])).toEqual({ "221": "5806580", ada_2: "444" });
    expect(buildConfirmationMapFromOrders([])).toEqual({});
  });
});

describe("fetchMiloOrders", () => {
  it("hits /users/orders with the REQUIRED groupid param (400s without it — probed)", async () => {
    const call = vi.fn(async () => ({ ms: 1, status: 200, ok: true, body: [] }));
    const transport = { __miloTransport: true, kind: "node", call };
    await fetchMiloOrders(transport, { token: "tok", groupId: "g 1" });
    const [method, path, opts] = call.mock.calls[0];
    expect(method).toBe("GET");
    expect(path).toBe("/users/orders?groupid=g%201");
    expect(opts.token).toBe("tok");
  });

  it("guards its inputs before any network call", async () => {
    const call = vi.fn();
    const transport = { __miloTransport: true, kind: "node", call };
    await expect(fetchMiloOrders(transport, { groupId: "g" })).rejects.toThrow(/token is required/);
    await expect(fetchMiloOrders(transport, { token: "t" })).rejects.toThrow(/groupId is required/);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("END-TO-END persist contract: normalized API orders → real confirmation rows", () => {
  it("buildMiloConfirmationRows produces ADA-keyed rows from node-path blocks unchanged", () => {
    const selected = [apiOrder221(), apiOrder321()].map(normalizeMiloApiOrder);
    const confirmationMap = buildConfirmationMapFromOrders(selected);
    const rows = buildMiloConfirmationRows({
      storeId: "store-1",
      executionRunId: "run-1",
      checkedOut: {
        submitted: true,
        mode: "submit",
        historyOrders: selected,
        confirmationNumbers: confirmationMap,
      },
      sessionAdaOrders: [
        { adaNumber: "221", adaName: "General Wine & Liquor", items: [{}] },
        { adaNumber: "321", adaName: "NWS Michigan", items: [{}] },
      ],
    });

    expect(rows).toHaveLength(2);
    const byConf = Object.fromEntries(rows.map((r) => [r.confirmation_number, r]));

    const gw = byConf["5806580"];
    expect(gw.ada_number).toBe("221");
    expect(gw.order_number).toBe("274509587");
    expect(gw.net_total).toBe(3752.6); // at-placement net, penny-exact vs the postmortem
    expect(gw.gross_total).toBe(3952.59);
    expect(gw.delivery_date).toBe("2026-07-21");
    expect(gw.line_item_count).toBe(1);
    expect(gw.line_items[0].liquorCode).toBe("3797");
    expect(gw.store_id).toBe("store-1");
    expect(gw.execution_run_id).toBe("run-1");

    const nws = byConf["31002245"];
    expect(nws.ada_number).toBe("321");
    expect(nws.net_total).toBe(1585.66);
  });
});
