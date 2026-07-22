/**
 * engine-api.unit.test.js — buildAndValidateViaApi against a MOCK page.
 *
 * The engine previously had no unit coverage (it needs a live browser page).
 * This suite fakes page.evaluate and routes by method+URL, returning the SAME
 * captured fixtures the parser tests use — so the whole engine pipeline runs
 * hermetically, with zero network.
 *
 * Written 2026-07-05 alongside the post-add parallelization (steps 6-8 fired
 * concurrently). What it proves, adversarially:
 *   1. PARITY — engine output equals the pure parser fed the same fixtures.
 *   2. CONCURRENCY — the five post-add reads overlap (wall ≈ max, not sum).
 *   3. ORDERING — reads start only after bulk-add; the taxes WRITE starts only
 *      after ALL five reads finish; perCallMs order stays deterministic.
 *   4. FAIL-SAFE BIASES preserved: stock-check failure → every item
 *      needsRecheck (never silently "in stock"); validate failure →
 *      validated:false; a failed delivery ref is omitted, run continues.
 *   5. Hard failures still throw with attribution (bulk add, page death).
 */
import { describe, it, expect } from "vitest";

import { buildAndValidateViaApi } from "./engine-api.js";
import { parseMiloValidate } from "./parse-milo-validate.js";
import accountFixture from "./__fixtures__/account.json";
import cartFixture from "./__fixtures__/cart.json";
import inventoryFixture from "./__fixtures__/inventory.json";
import validateFixture from "./__fixtures__/validate.json";
import delivery141 from "./__fixtures__/delivery-141.json";
import delivery221 from "./__fixtures__/delivery-221.json";
import delivery321 from "./__fixtures__/delivery-321.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CREDS = { username: "user", password: "pass" };

/** Cart items derived from the cart fixture, fully cached (miloProduct attached). */
const cachedCartItems = () =>
  cartFixture.items.map((it) => ({
    code: String(it.product.code),
    quantity: it.quantity,
    miloProduct: { id: String(it.product.id), distributor: it.product.distributor },
  }));

/**
 * Mock Playwright page. Routes by method + URL substring; overrides win over
 * defaults. Route: { method, match, body, status=200, ok=true, delayMs=0,
 * reject }. Records every call { method, url, body, startedAt, endedAt } in
 * page.calls (completion order).
 */
function makeMockPage(overrides = []) {
  const defaults = [
    { method: "POST", match: "/auth/login", body: { accessToken: "eyJmock.mock.mock" } },
    { method: "GET", match: "/account", body: accountFixture },
    { method: "DELETE", match: "/users/cart?", body: {} },
    { method: "POST", match: "/users/cart/items", body: { items: cartFixture.items } },
    { method: "PUT", match: "/inventory/check", body: inventoryFixture },
    { method: "GET", match: "/validate", body: validateFixture },
    { method: "GET", match: "referenceNumber=141", body: delivery141 },
    { method: "GET", match: "referenceNumber=221", body: delivery221 },
    { method: "GET", match: "referenceNumber=321", body: delivery321 },
    { method: "PUT", match: "/users/cart/taxes", body: cartFixture },
  ];
  const routes = [...overrides, ...defaults];
  const calls = [];
  return {
    calls,
    evaluate: async (_fn, { method, url, body }) => {
      const route = routes.find((r) => (!r.method || r.method === method) && url.includes(r.match));
      if (!route) throw new Error(`mock page: unmatched ${method} ${url}`);
      const startedAt = Date.now();
      if (route.delayMs) await sleep(route.delayMs);
      const endedAt = Date.now();
      calls.push({ method, url, body, startedAt, endedAt });
      if (route.reject) throw new Error(route.reject);
      return { ms: endedAt - startedAt, status: route.status ?? 200, ok: route.ok ?? true, body: route.body };
    },
  };
}

const run = (page, items = cachedCartItems()) => buildAndValidateViaApi({ page }, items, CREDS);

/** The exact result the pure parser produces from the same fixtures. */
const expectedParse = () =>
  parseMiloValidate({
    cart: cartFixture,
    inventory: inventoryFixture,
    validate: validateFixture,
    deliveryByRef: { "141": delivery141, "221": delivery221, "321": delivery321 },
  });

describe("buildAndValidateViaApi (parallel post-add reads)", () => {
  it("PARITY: engine output === pure parser output on the same fixtures", async () => {
    const page = makeMockPage();
    const r = await run(page);
    const { engineTimings, ...parsed } = r;
    expect(parsed).toEqual(expectedParse());
    expect(r.canCheckout).toBe(true); // sanity: happy fixture set really is green
    expect(engineTimings.cachedCount).toBe(cartFixture.items.length);
    expect(engineTimings.liveResolveCount).toBe(0);
    expect(engineTimings.postAddWallMs).toBeGreaterThanOrEqual(0);
    expect(engineTimings.loginMs).toBeGreaterThanOrEqual(0);
  });

  it("CONCURRENCY: five post-add reads overlap — wall ≈ max(80ms), not sum(400ms)", async () => {
    const delayed = [
      { method: "PUT", match: "/inventory/check", body: inventoryFixture, delayMs: 80 },
      { method: "GET", match: "/validate", body: validateFixture, delayMs: 80 },
      { method: "GET", match: "referenceNumber=141", body: delivery141, delayMs: 80 },
      { method: "GET", match: "referenceNumber=221", body: delivery221, delayMs: 80 },
      { method: "GET", match: "referenceNumber=321", body: delivery321, delayMs: 80 },
    ];
    const page = makeMockPage(delayed);
    const r = await run(page);
    expect(r.engineTimings.postAddWallMs).toBeGreaterThanOrEqual(80);
    // Sequential would be ≥ 400ms. Generous 3x slop still proves overlap.
    expect(r.engineTimings.postAddWallMs).toBeLessThan(240);
  });

  it("ORDERING: reads start after bulk-add ends; the taxes WRITE starts after ALL reads end", async () => {
    const delayed = [
      { method: "PUT", match: "/inventory/check", body: inventoryFixture, delayMs: 40 },
      { method: "GET", match: "/validate", body: validateFixture, delayMs: 25 },
      { method: "GET", match: "referenceNumber=141", body: delivery141, delayMs: 10 },
      { method: "GET", match: "referenceNumber=221", body: delivery221, delayMs: 35 },
      { method: "GET", match: "referenceNumber=321", body: delivery321, delayMs: 5 },
    ];
    const page = makeMockPage(delayed);
    await run(page);
    const one = (match, method) => {
      const found = page.calls.filter((c) => c.url.includes(match) && (!method || c.method === method));
      expect(found).toHaveLength(1);
      return found[0];
    };
    const clear = one("/users/cart?", "DELETE");
    const add = one("/users/cart/items", "POST");
    const taxes = one("/users/cart/taxes", "PUT");
    const reads = [
      one("/inventory/check"),
      one("/validate?licenseId"),
      one("referenceNumber=141", "GET"),
      one("referenceNumber=221", "GET"),
      one("referenceNumber=321", "GET"),
    ];
    expect(clear.endedAt).toBeLessThanOrEqual(add.startedAt);
    for (const rd of reads) {
      expect(rd.startedAt).toBeGreaterThanOrEqual(add.endedAt); // no read before the cart exists
      expect(taxes.startedAt).toBeGreaterThanOrEqual(rd.endedAt); // the write waits for every read
    }
  });

  it("DETERMINISM: perCallMs keeps the fixed sequential order even with scrambled completion", async () => {
    const scrambled = [
      { method: "PUT", match: "/inventory/check", body: inventoryFixture, delayMs: 90 },
      { method: "GET", match: "/validate", body: validateFixture, delayMs: 10 },
      { method: "GET", match: "referenceNumber=141", body: delivery141, delayMs: 60 },
      { method: "GET", match: "referenceNumber=221", body: delivery221, delayMs: 30 },
      { method: "GET", match: "referenceNumber=321", body: delivery321, delayMs: 5 },
    ];
    const page = makeMockPage(scrambled);
    const r = await run(page);
    expect(r.engineTimings.perCallMs.map((c) => c.label)).toEqual([
      "account",
      "clear",
      "cart/items",
      "inventory/check",
      "validate",
      "delivery/141",
      "delivery/221",
      "delivery/321",
      "cart/taxes",
    ]);
  });

  it("FAIL-SAFE: stock-check HTTP failure → EVERY item needsRecheck, canCheckout false (never silent in-stock)", async () => {
    const page = makeMockPage([{ method: "PUT", match: "/inventory/check", body: "boom", status: 500, ok: false }]);
    const r = await run(page);
    expect(r.outOfStockItems).toHaveLength(cartFixture.items.length);
    for (const o of r.outOfStockItems) {
      expect(o.needsRecheck).toBe(true);
      expect(o.reason).toBe("needs_recheck");
    }
    expect(r.canCheckout).toBe(false);
    expect(r.validated).toBe(true); // rules validated; STOCK is what's unknown
  });

  it("FAIL-SAFE: validate HTTP failure → validated:false, canCheckout false", async () => {
    const page = makeMockPage([{ method: "GET", match: "/validate", body: "boom", status: 502, ok: false }]);
    const r = await run(page);
    expect(r.validated).toBe(false);
    expect(r.canCheckout).toBe(false);
    expect(r.validationMessages).toContain("MLCC validation did not succeed.");
  });

  it("FAIL-SOFT: one delivery ref failing is omitted; taxes still runs with the other two", async () => {
    const page = makeMockPage([{ method: "GET", match: "referenceNumber=221", body: null, status: 500, ok: false }]);
    const r = await run(page);
    expect(r.deliveryDates["221"]).toBeNull();
    expect(r.deliveryDates["141"]).toBe(delivery141.deliveryDate);
    expect(r.deliveryDates["321"]).toBe(delivery321.deliveryDate);
    const taxes = page.calls.find((c) => c.url.includes("/users/cart/taxes"));
    expect(taxes).toBeTruthy();
    const arr = JSON.parse(decodeURIComponent(taxes.url.split("deliveries=")[1]));
    expect(arr).toHaveLength(2);
    expect(arr.map((d) => String(d.referenceNumber)).sort()).toEqual(["141", "321"]);
  });

  it("HARD FAIL: bulk-add failure throws with attribution and NO post-add read ever fires", async () => {
    const page = makeMockPage([
      { method: "POST", match: "/users/cart/items", body: { message: "nope" }, status: 500, ok: false },
    ]);
    await expect(run(page)).rejects.toThrow(/bulk add failed \(500\)/);
    expect(page.calls.some((c) => c.url.includes("/inventory/check"))).toBe(false);
    expect(page.calls.some((c) => c.url.includes("/users/cart/taxes"))).toBe(false);
  });

  it("HARD FAIL: page death during one parallel read rejects the whole run (same as sequential)", async () => {
    const page = makeMockPage([{ method: "PUT", match: "/inventory/check", reject: "page crashed" }]);
    await expect(run(page)).rejects.toThrow(/page crashed/);
  });

  it("FAIL CLOSED: cart-clear failure aborts BEFORE anything is added (found live 2026-07-08: MILO 500 on clear)", async () => {
    const page = makeMockPage([
      { method: "DELETE", match: "/users/cart?", body: "server error", status: 500, ok: false },
    ]);
    await expect(run(page)).rejects.toThrow(/cart clear failed \(500\)/);
    expect(page.calls.some((c) => c.url.includes("/users/cart/items"))).toBe(false);
    expect(page.calls.some((c) => c.url.includes("/users/cart/taxes"))).toBe(false);
  });

  it("BOUNDARY GATE: an EXTRA line in the priced cart fails the run loud (stale cart can't become truth)", async () => {
    const staleCart = {
      ...cartFixture,
      items: [
        ...cartFixture.items,
        { product: { code: "9999", name: "GHOST BOTTLE", distributor: cartFixture.items[0].product.distributor }, quantity: 6 },
      ],
    };
    const page = makeMockPage([{ method: "PUT", match: "/users/cart/taxes", body: staleCart }]);
    await expect(run(page)).rejects.toThrow(/does not match the requested order \((count_mismatch|extra:9999)\)/);
  });

  it("BOUNDARY GATE: a MISSING line in the priced cart fails the run loud", async () => {
    const shortCart = { ...cartFixture, items: cartFixture.items.slice(0, 1) };
    const page = makeMockPage([{ method: "PUT", match: "/users/cart/taxes", body: shortCart }]);
    await expect(run(page)).rejects.toThrow(/does not match the requested order/);
  });

  it("BOUNDARY GATE: a tampered QUANTITY fails the run loud with the code named", async () => {
    const tampered = {
      ...cartFixture,
      items: cartFixture.items.map((it, i) => (i === 0 ? { ...it, quantity: it.quantity + 1 } : it)),
    };
    const page = makeMockPage([{ method: "PUT", match: "/users/cart/taxes", body: tampered }]);
    await expect(run(page)).rejects.toThrow(new RegExp(`qty_mismatch:${cartFixture.items[0].product.code}`));
  });

  it("CACHE MIX: uncached item live-resolves exactly once; cached items make zero resolve calls", async () => {
    const items = cachedCartItems();
    const bare = { code: items[0].code, quantity: items[0].quantity }; // no miloProduct
    const page = makeMockPage([
      {
        method: "POST",
        match: `/products/code/${bare.code}`,
        body: { id: cartFixture.items[0].product.id, distributor: cartFixture.items[0].product.distributor },
      },
    ]);
    const r = await run(page, [bare, ...items.slice(1)]);
    expect(r.engineTimings.cachedCount).toBe(items.length - 1);
    expect(r.engineTimings.liveResolveCount).toBe(1);
    expect(page.calls.filter((c) => c.url.includes("/products/code/"))).toHaveLength(1);
  });
});

/*
 * ── 2026-07-18 additions: preauth (node session cache) + bare transport ──
 * The engine gained a pluggable transport and an optional preauth that skips
 * /auth/login + /account. These pin: preauth really skips both network calls,
 * an incomplete preauth fails closed back to the creds requirement, and the
 * whole pipeline runs identically over a { transport } with no page at all.
 */
describe("buildAndValidateViaApi (preauth + transport, 2026-07-18)", () => {
  const PREAUTH = () => ({
    token: "eyJmock.mock.mock",
    groupId: accountFixture.groups[0].id,
    subscriptionId: accountFixture.groups[0].subscriptionId,
  });

  it("PREAUTH: /auth/login and /account are NEVER called; output parity holds", async () => {
    const page = makeMockPage();
    const r = await buildAndValidateViaApi({ page }, cachedCartItems(), { preauth: PREAUTH() });
    const { engineTimings, ...parsed } = r;
    expect(parsed).toEqual(expectedParse());
    expect(engineTimings.preauthReused).toBe(true);
    expect(engineTimings.loginMs).toBe(0);
    expect(page.calls.some((c) => c.url.includes("/auth/login"))).toBe(false);
    expect(page.calls.some((c) => c.url.endsWith("/account"))).toBe(false);
    expect(engineTimings.perCallMs.map((c) => c.label)).not.toContain("account");
  });

  it("FAIL CLOSED: incomplete preauth (missing subscriptionId) still requires creds", async () => {
    const page = makeMockPage();
    await expect(
      buildAndValidateViaApi({ page }, cachedCartItems(), {
        preauth: { token: "t", groupId: "g" },
      }),
    ).rejects.toThrow(/username \+ password are required/);
    expect(page.calls).toHaveLength(0); // nothing fired before the guard
  });

  it("INCLUDE RAW: returns priced cart + deliveries only when asked (engine-submit handoff)", async () => {
    const page = makeMockPage();
    const withRaw = await buildAndValidateViaApi({ page }, cachedCartItems(), {
      ...CREDS,
      includeRaw: true,
    });
    expect(withRaw.raw.pricedCart).toEqual(cartFixture);
    expect(withRaw.raw.deliveries).toHaveLength(3);
    const withoutRaw = await buildAndValidateViaApi({ page }, cachedCartItems(), CREDS);
    expect(withoutRaw.raw).toBeUndefined(); // parity contract stays byte-stable by default
  });

  it("TRANSPORT: the full pipeline runs over a bare { transport } with no page", async () => {
    const page = makeMockPage(); // reuse the router as the transport backend
    const transport = {
      __miloTransport: true,
      kind: "node",
      call: (method, path, opts = {}) =>
        page.evaluate(null, { method, url: `https://mock${path}`, token: opts.token, body: opts.body }),
    };
    const r = await buildAndValidateViaApi({ transport }, cachedCartItems(), CREDS);
    const { engineTimings, ...parsed } = r;
    expect(parsed).toEqual(expectedParse());
    expect(engineTimings.transport).toBe("node");
    expect(engineTimings.preauthReused).toBe(false);
  });
});
