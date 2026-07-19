import { describe, it, expect, vi } from "vitest";
import {
  buildCheckoutPayload,
  extractConfirmationNumbers,
  submitCartViaApi,
} from "./engine-api.js";

/**
 * Engine submit (2026-07-17) — the seconds-fast /users/cart/checkout POST,
 * decompiled from MILO's bundle (docs/lk/milo-checkout-endpoint.md). These
 * lock the contract and, above all, the TRIPLE-GATE: no allow flag → no POST.
 */

const pricedCart = {
  items: [
    { product: { id: "1001", code: "9528" }, quantity: 3, available: true },
    { product: { id: "1002", code: "3797" }, quantity: 6, available: true },
  ],
};
const deliveries = [{ referenceNumber: "221", date: "2026-07-21" }];

describe("buildCheckoutPayload", () => {
  it("maps priced-cart lines to {productId, quantity, available} exactly", () => {
    const p = buildCheckoutPayload({ pricedCart, deliveries });
    expect(p.items).toEqual([
      { productId: "1001", quantity: 3, available: true },
      { productId: "1002", quantity: 6, available: true },
    ]);
    expect(p.deliveries).toBe(JSON.stringify(deliveries));
    expect(p.emails).toBeUndefined();
  });

  it("includes only valid emails, omits deliveries when empty", () => {
    const p = buildCheckoutPayload({
      pricedCart,
      deliveries: [],
      emails: ["a@b.com", "junk", " c@d.com "],
    });
    expect(p.emails).toEqual(["a@b.com", "c@d.com"]);
    expect(p.deliveries).toBeUndefined();
  });

  it("FAILS CLOSED on a line missing productId", () => {
    const bad = { items: [{ product: { code: "9528" }, quantity: 3, available: true }] };
    expect(() => buildCheckoutPayload({ pricedCart: bad })).toThrow(/missing product\.id/);
  });

  it("FAILS CLOSED on a non-positive quantity", () => {
    const bad = { items: [{ product: { id: "1001" }, quantity: 0, available: true }] };
    expect(() => buildCheckoutPayload({ pricedCart: bad })).toThrow(/invalid quantity/);
  });

  it("FAILS CLOSED on an empty cart", () => {
    expect(() => buildCheckoutPayload({ pricedCart: { items: [] } })).toThrow(/no items/);
  });
});

describe("extractConfirmationNumbers", () => {
  it("digs confirmation/order numbers out of a nested response", () => {
    const body = {
      results: [
        { adaNumber: "221", confirmationNumber: "5806580" },
        { adaNumber: "321", orderNumber: "31002245" },
      ],
    };
    const got = extractConfirmationNumbers(body);
    expect(got).toContain("5806580");
    expect(got).toContain("31002245");
  });

  it("returns [] on empty / junk", () => {
    expect(extractConfirmationNumbers(null)).toEqual([]);
    expect(extractConfirmationNumbers({ note: "ok" })).toEqual([]);
  });
});

describe("submitCartViaApi — the gate", () => {
  function fakeSession(postResult) {
    return {
      page: {
        // Mirrors engine apiCall's page.evaluate contract.
        evaluate: vi.fn(async () => postResult),
      },
    };
  }

  it("REFUSES to POST when allowLiveSubmission is not true (dry-run)", async () => {
    const session = fakeSession({ ok: true, status: 200, body: {}, ms: 1 });
    const r = await submitCartViaApi(session, {
      token: "tok",
      groupId: "g1",
      pricedCart,
      deliveries,
      // allowLiveSubmission omitted → must NOT fire
    });
    expect(r.mode).toBe("dry_run");
    expect(r.dispatched).toBe(false);
    expect(r.submitted).toBe(false);
    expect(session.page.evaluate).not.toHaveBeenCalled();
  });

  it("still validates the payload in dry-run (fails closed on bad cart)", async () => {
    const session = fakeSession({ ok: true, status: 200, body: {}, ms: 1 });
    await expect(
      submitCartViaApi(session, {
        token: "tok",
        groupId: "g1",
        pricedCart: { items: [{ product: { code: "x" }, quantity: 1 }] },
      }),
    ).rejects.toThrow(/missing product\.id/);
    expect(session.page.evaluate).not.toHaveBeenCalled();
  });

  it("POSTs and marks dispatched when allowLiveSubmission === true", async () => {
    const session = fakeSession({
      ok: true,
      status: 200,
      body: { results: [{ confirmationNumber: "5806580" }] },
      ms: 5,
    });
    const r = await submitCartViaApi(session, {
      token: "tok",
      groupId: "g1",
      pricedCart,
      deliveries,
      allowLiveSubmission: true,
    });
    expect(session.page.evaluate).toHaveBeenCalledTimes(1);
    expect(r.mode).toBe("submit");
    expect(r.dispatched).toBe(true);
    expect(r.submitted).toBe(true);
    expect(r.confirmationNumbers).toContain("5806580");
  });

  it("dispatched stays true on a failed POST (truth rule — caller must not retry)", async () => {
    const session = fakeSession({ ok: false, status: 500, body: { error: "boom" }, ms: 5 });
    const r = await submitCartViaApi(session, {
      token: "tok",
      groupId: "g1",
      pricedCart,
      deliveries,
      allowLiveSubmission: true,
    });
    expect(r.dispatched).toBe(true);
    expect(r.submitted).toBe(false);
    expect(r.status).toBe(500);
  });
});

describe("submitCartViaApi — node transport (2026-07-18)", () => {
  it("runs over a bare { transport } with no page; the gate is enforced identically", async () => {
    const call = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { results: [{ confirmationNumber: "123456" }] },
      ms: 2,
    }));
    const transport = { __miloTransport: true, kind: "node", call };

    const dry = await submitCartViaApi(
      { transport },
      { token: "tok", groupId: "g1", pricedCart, deliveries },
    );
    expect(dry.mode).toBe("dry_run");
    expect(dry.dispatched).toBe(false);
    expect(call).not.toHaveBeenCalled();

    const live = await submitCartViaApi(
      { transport },
      { token: "tok", groupId: "g1", pricedCart, deliveries, allowLiveSubmission: true },
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(live.mode).toBe("submit");
    expect(live.dispatched).toBe(true);
    expect(live.submitted).toBe(true);
    expect(live.confirmationNumbers).toContain("123456");
    const [method, path] = call.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/users/cart/checkout?groupid=g1");
  });
});
