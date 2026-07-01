/**
 * Adversarial tests for Stage 5's orders-history parsing — the code that
 * reads the CONFIRMATION NUMBERS for a real submitted order off
 * /milo/account/orders (checkout.js: navigateToOrdersAndCapture →
 * parseOrdersHistoryPage).
 *
 * Written 2026-07-01, the night before the first supervised real order.
 * NO production code is touched: parseOrdersHistoryPage is module-private,
 * so every test drives the EXPORTED navigateToOrdersAndCapture with a fake
 * Playwright page whose evaluate() returns controlled DOM-pass payloads.
 * (Call 1 = the readiness poll, call 2 = the parse pass — matching the real
 * call order in checkout.js.)
 *
 * What's under attack:
 *  - regex extraction per order block (confirmation #, order #, distributor,
 *    SUBTOTAL|TOTAL pair, placed/delivery dates, per-line items)
 *  - the "today" date filter (UTC + Eastern double-candidate)
 *  - top-N-most-recent selection against session.adaOrders
 *  - ADA-key mapping (distributor name → 141/221/321, session fallback,
 *    ada_N last resort)
 *  - the loud NO_RECENT_MATCH failure when nothing matches
 *  - the HISTORY_FETCH_FAILED failure when the orders page won't load
 */
import { describe, it, expect } from "vitest";
import { navigateToOrdersAndCapture } from "../src/rpa/stages/checkout.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function miloDate(d) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
const TODAY = miloDate(new Date());
// -3 days is safely outside BOTH "today" candidates (UTC and Eastern) no
// matter what wall-clock hour the suite runs at.
const THREE_DAYS_AGO = miloDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

/** One order block exactly in the layout the code comments document
 * (verified 2026-05-29 against real MILO /milo/account/orders). */
function orderBlock({
  placed = TODAY,
  delivery = TODAY,
  distributor = "NWS Michigan, Inc.",
  conf = "30765405",
  orderNo = "118693",
  subtotal = "3,127.44",
  total = "3,283.81",
  lines = 'Liquor Code 9128 Product J DANIELS OLD 7 BLACK Quantity 6 Unit Price $22.14 Subtotal $132.84 Order Type MILO',
} = {}) {
  const confPart = conf === null ? "" : `Confirmation # ${conf} `;
  const distPart = distributor === null ? "" : `DISTRIBUTOR ${distributor} `;
  return (
    `ORDER PLACED ${placed} DELIVERY DATE ${delivery} ${distPart}` +
    `${confPart}SUBTOTAL | TOTAL $${subtotal} | $${total} ` +
    `Order # | Order Type ${orderNo} | MILO ${lines}`
  );
}

/**
 * Fake Playwright page. evaluate() call 1 = readiness poll (report ready
 * immediately), call 2 = the structured/text parse payload.
 */
function makeFakePage({ structuredOrders = [], textBlocks = [], gotoError = null } = {}) {
  let evalCalls = 0;
  return {
    async goto() {
      if (gotoError) throw gotoError;
    },
    async waitForTimeout() {},
    url: () => "https://www.lara.michigan.gov/milo/account/orders",
    async evaluate() {
      evalCalls += 1;
      if (evalCalls === 1) {
        return { hasConfirmation: true, hasOrderHeader: true, hasEmpty: false, bodyLength: 9999 };
      }
      return {
        structuredOrders,
        textBlocks,
        currentUrl: "https://www.lara.michigan.gov/milo/account/orders",
        bodyLength: 9999,
      };
    },
  };
}

function structured(raws) {
  return raws.map((raw) => ({ raw, selector: "app-order-card" }));
}

const TWO_ADA_SESSION = { adaOrders: [{ adaNumber: "321" }, { adaNumber: "221" }] };

// ─── The real 2-ADA shape (what tomorrow's order should produce) ────────────

describe("orders-history parse — happy paths", () => {
  it("parses two same-day ADA orders into {321, 221} confirmation keys with full detail", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "30765405" }),
        orderBlock({
          distributor: "General Wine & Liquor Co.",
          conf: "5654920",
          orderNo: "118694",
          subtotal: "2,001.00",
          total: "2,178.99",
          lines: "Liquor Code 7156 Product TITOS HANDMADE VODKA Quantity 12 Unit Price $17.50 Subtotal $210.00 Order Type MILO",
        }),
      ]),
    });

    const out = await navigateToOrdersAndCapture(page, TWO_ADA_SESSION, null, []);

    expect(out.confirmationNumbers).toEqual({ "321": "30765405", "221": "5654920" });
    expect(out.recoveredFromHistoryPage).toBe(true);
    expect(out.historyOrders).toHaveLength(2);

    const nws = out.historyOrders[0];
    expect(nws.orderNumber).toBe("118693");
    expect(nws.subtotal).toBe(3127.44);
    expect(nws.total).toBe(3283.81);
    expect(nws.lineItems).toEqual([
      {
        liquorCode: "9128",
        productName: "J DANIELS OLD 7 BLACK",
        quantity: 6,
        unitPrice: 22.14,
        lineSubtotal: 132.84,
        orderType: "MILO",
      },
    ]);
  });

  it("parses from the text-block fallback when no structured containers matched", async () => {
    const page = makeFakePage({
      structuredOrders: [],
      textBlocks: [
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "30765405" }),
        orderBlock({ distributor: "General Wine & Liquor", conf: "5654920" }),
      ],
    });

    const out = await navigateToOrdersAndCapture(page, TWO_ADA_SESSION, null, []);
    expect(out.confirmationNumbers).toEqual({ "321": "30765405", "221": "5654920" });
  });

  it("Imperial Beverage maps to the 141 key", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "Imperial Beverage LLC", conf: "77001234" }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "141" }] },
      null,
      [],
    );
    expect(out.confirmationNumbers).toEqual({ "141": "77001234" });
  });
});

// ─── Adversarial layout attacks ──────────────────────────────────────────────

describe("orders-history parse — adversarial layouts", () => {
  it("distributor capture stops at the bleeding 'Confirmation' column header", async () => {
    // The exact bleed the code comment warns about: the next column header
    // runs into the distributor cell with no separator.
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "30765405" }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "321" }] },
      null,
      [],
    );
    expect(out.historyOrders[0].distributorRaw.toLowerCase()).toContain("nws michigan");
    expect(out.historyOrders[0].distributorRaw.toLowerCase()).not.toContain("confirmation");
  });

  it("takes only the N most recent of several same-day orders (N = ADA count)", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "11111111" }),
        orderBlock({ distributor: "General Wine & Liquor", conf: "22222222" }),
        orderBlock({ distributor: "Imperial Beverage", conf: "33333333" }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(page, TWO_ADA_SESSION, null, []);
    expect(out.historyOrders).toHaveLength(2);
    // The two KEPT orders are the first two blocks (most recent); the third
    // (Imperial) must be dropped. Assert via the map + the kept rows — not
    // Object.values order (JS sorts integer-like keys numerically).
    expect(out.confirmationNumbers).toEqual({ "321": "11111111", "221": "22222222" });
    expect(out.historyOrders.map((o) => o.confirmationNumber)).toEqual([
      "11111111",
      "22222222",
    ]);
  });

  it("filters out orders from other days", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "99990000", placed: THREE_DAYS_AGO }),
        orderBlock({ distributor: "General Wine & Liquor", conf: "5654920" }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "221" }] },
      null,
      [],
    );
    expect(out.historyOrders).toHaveLength(1);
    expect(out.confirmationNumbers).toEqual({ "221": "5654920" });
  });

  it("keeps a block whose placed-date failed to parse (over-report beats missing a recovery)", async () => {
    const noDateBlock =
      "DISTRIBUTOR NWS Michigan, Inc. Confirmation # 44445555 " +
      "SUBTOTAL | TOTAL $100.00 | $105.00 Order # | Order Type 200001 | MILO";
    const page = makeFakePage({ structuredOrders: structured([noDateBlock]) });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "321" }] },
      null,
      [],
    );
    expect(out.confirmationNumbers).toEqual({ "321": "44445555" });
  });

  it("unknown distributor name falls back to the session's ADA number for that slot", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "SOME NEW ADA LLC", conf: "12341234" }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "321" }] },
      null,
      [],
    );
    expect(out.confirmationNumbers).toEqual({ "321": "12341234" });
  });

  it("missing confirmation cell yields a null value (renderers must drop nulls, never invent)", async () => {
    const page = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: null }),
      ]),
    });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "321" }] },
      null,
      [],
    );
    expect(out.historyOrders).toHaveLength(1);
    expect(out.confirmationNumbers["321"]).toBeNull();
  });

  it("a confirmation-number-looking string never becomes a line-item liquor code", async () => {
    // Liquor codes are 1-7 digits; the 8-digit confirmation must be rejected
    // by the code guard even when a stray "Liquor Code" label precedes it.
    const trapBlock =
      `ORDER PLACED ${TODAY} DISTRIBUTOR NWS Michigan, Inc. Confirmation # 30765405 ` +
      "SUBTOTAL | TOTAL $50.00 | $52.50 Order # | Order Type 300001 | MILO " +
      "Liquor Code 30765405 Product PHANTOM ROW Quantity 1 Unit Price $1.00 Subtotal $1.00 Order Type MILO " +
      "Liquor Code 9128 Product J DANIELS OLD 7 BLACK Quantity 2 Unit Price $22.14 Subtotal $44.28 Order Type MILO";
    const page = makeFakePage({ structuredOrders: structured([trapBlock]) });
    const out = await navigateToOrdersAndCapture(
      page,
      { adaOrders: [{ adaNumber: "321" }] },
      null,
      [],
    );
    expect(out.historyOrders[0].lineItems).toHaveLength(1);
    expect(out.historyOrders[0].lineItems[0].liquorCode).toBe("9128");
  });
});

// ─── Loud failures ───────────────────────────────────────────────────────────

describe("orders-history parse — loud failures (doctrine: never silent)", () => {
  it("throws MILO_STAGE5_HISTORY_NO_RECENT_MATCH when nothing on the page matches a real submission", async () => {
    const page = makeFakePage({ structuredOrders: [], textBlocks: [] });
    await expect(
      navigateToOrdersAndCapture(page, TWO_ADA_SESSION, null, []),
    ).rejects.toMatchObject({ code: "MILO_STAGE5_HISTORY_NO_RECENT_MATCH" });
  });

  it("throws MILO_STAGE5_HISTORY_FETCH_FAILED when the orders page will not load", async () => {
    const page = makeFakePage({ gotoError: new Error("net::ERR_CONNECTION_RESET") });
    await expect(
      navigateToOrdersAndCapture(page, TWO_ADA_SESSION, null, []),
    ).rejects.toMatchObject({ code: "MILO_STAGE5_HISTORY_FETCH_FAILED" });
  });

  it("diagnostic path (no session ADAs) returns every order without throwing, even when empty", async () => {
    const empty = makeFakePage({ structuredOrders: [], textBlocks: [] });
    const out = await navigateToOrdersAndCapture(empty, { adaOrders: [] }, null, []);
    expect(out.historyOrders).toEqual([]);

    const stale = makeFakePage({
      structuredOrders: structured([
        orderBlock({ distributor: "NWS Michigan, Inc.", conf: "88880000", placed: THREE_DAYS_AGO }),
      ]),
    });
    const out2 = await navigateToOrdersAndCapture(stale, { adaOrders: [] }, null, []);
    expect(out2.historyOrders).toHaveLength(1); // diagnostic sees non-today orders too
  });
});
