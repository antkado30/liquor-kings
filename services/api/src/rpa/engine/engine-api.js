/**
 * engine-api — LIVE dry-run MILO API fetch module (Phase 1b, 2026-06-28).
 *
 * Feeds the Phase-1a parser (parse-milo-validate) by building + pricing +
 * validating a cart via MILO's REST API directly — NO DOM typing. Reuses the
 * exact in-page fetch pattern proven in _test_r2_replay.js (page.evaluate
 * fetch, credentials:"include", Bearer header, redacted token).
 *
 * DRY-RUN ONLY. The sequence ENDS at validate + priced-cart read. It NEVER
 * calls any submit / checkout / place-order endpoint — none exists in our map
 * and we do not invent one.
 *
 * Auth model: MILO is a JWT REST API behind Cloudflare. The caller passes a
 * browser session from loginToMilo (which cleared Cloudflare) and the MILO
 * credentials; we re-POST /auth/login from the page to capture the accessToken
 * (MILO doesn't persist it in reachable storage). Token is redacted in all logs.
 */
import { parseMiloValidate } from "./parse-milo-validate.js";

const API_BASE = "https://www.lara.michigan.gov/LiquorOrderingApi/api";

/** Redact JWTs / Bearer tokens anywhere they might surface in a log or error. */
export const redact = (v) =>
  String(v)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "<jwt-redacted>");

/**
 * Call a MILO API endpoint from INSIDE the page via fetch (same-origin →
 * Cloudflare cf_clearance carries; we add the Bearer header). Times the call
 * with performance.now() inside the page. Returns { ms, status, ok, body }.
 * `silent:true` suppresses the per-call console.log (for non-harness callers).
 */
export async function apiCall(page, method, path, { token, body, label, silent = false } = {}) {
  const result = await page.evaluate(
    async ({ method, url, token, body }) => {
      const t0 = performance.now();
      let res, text;
      try {
        res = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          ...(body != null ? { body: JSON.stringify(body) } : {}),
        });
        text = await res.text();
      } catch (e) {
        return { ms: Math.round(performance.now() - t0), status: 0, ok: false, body: String(e), error: true };
      }
      const ms = Math.round(performance.now() - t0);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      return { ms, status: res.status, ok: res.ok, body: json ?? text };
    },
    { method, url: API_BASE + path, token, body },
  );
  if (!silent) {
    console.log(
      `  ${label ?? `${method} ${path}`}: ${result.status} (${result.ms}ms)${result.ok ? "" : " ⚠️ not ok"}`,
    );
  }
  return result;
}

/**
 * Capture an accessToken by re-POSTing /auth/login from the page. The response
 * body (which contains the token) is NEVER logged — only status/ms. Any error
 * thrown is redacted so the token can't leak via the message.
 */
export async function loginViaApi(page, username, password, { silent = false } = {}) {
  const r = await apiCall(page, "POST", "/auth/login", {
    body: { username, password },
    label: "POST /auth/login (capture token)",
    silent,
  });
  if (!r.ok || !r.body?.accessToken) {
    throw new Error(`In-page /auth/login failed (${r.status}): ${redact(JSON.stringify(r.body)).slice(0, 200)}`);
  }
  return r.body.accessToken;
}

/** Redacted body snippet for error messages (never leaks a token). */
function safeBody(r) {
  return redact(JSON.stringify(r?.body)).slice(0, 200);
}

/**
 * Build + price + validate a cart via MILO's API. DRY-RUN: ends at validate +
 * priced-cart read; never submits.
 *
 * @param {object} session  logged-in browser session from loginToMilo (has .page).
 * @param {Array<{code: string, quantity: number}>} cartItems
 * @param {{username: string, password: string}} creds
 * @returns {Promise<object>} parseMiloValidate result + engineTimings.
 */
export async function buildAndValidateViaApi(session, cartItems, { username, password } = {}) {
  if (!session?.page) throw new Error("buildAndValidateViaApi: session.page is required");
  if (!Array.isArray(cartItems) || cartItems.length === 0) throw new Error("buildAndValidateViaApi: cartItems must be non-empty");
  if (!username || !password) throw new Error("buildAndValidateViaApi: username + password are required");

  const page = session.page;
  const perCallMs = [];
  const track = (r, label) => perCallMs.push({ label, ms: r.ms, status: r.status, ok: r.ok });

  // Step 1: capture accessToken (re-POST /auth/login in-page). Token redacted.
  const loginStart = Date.now();
  const token = await loginViaApi(page, username, password);
  const loginMs = Date.now() - loginStart;
  console.log(`  accessToken captured (${token.length} chars, redacted: ${redact(token)})`);

  // Step 2: account → groupId + subscriptionId.
  const account = await apiCall(page, "GET", "/account", { token, label: "GET /account" });
  track(account, "account");
  if (!account.ok) throw new Error(`GET /account failed (${account.status}): ${safeBody(account)}`);
  const group = account.body?.groups?.[0] ?? {};
  const groupId = group.id;
  const subscriptionId = group.subscriptionId;
  if (!groupId || !subscriptionId) throw new Error(`Missing groupId/subscriptionId from /account: ${safeBody(account)}`);

  // Step 3: resolve each code → full product (productId kept as STRING).
  const resolved = [];
  for (const item of cartItems) {
    const r = await apiCall(page, "POST", `/products/code/${item.code}`, {
      token,
      body: { include_pr: subscriptionId },
      label: `POST /products/code/${item.code}`,
    });
    track(r, `products/code/${item.code}`);
    if (!r.ok || !r.body?.id) throw new Error(`resolve ${item.code} failed (${r.status}): ${safeBody(r)}`);
    resolved.push({ code: item.code, quantity: item.quantity, product: r.body });
  }

  // Step 4: clear cart (prep; NOT a submit).
  const clear = await apiCall(page, "DELETE", `/users/cart?groupid=${groupId}`, { token, label: "DELETE /users/cart (clear)" });
  track(clear, "clear");

  // Step 5: BULK ADD — entire cart in ONE call. Keep its .items (full product
  // objects) for the step-9 pricing call.
  const addPayload = resolved.map((r) => ({
    productId: String(r.product.id),
    quantity: r.quantity,
    distributor: r.product.distributor,
    restrictedQuantity: 0,
  }));
  const add = await apiCall(page, "POST", `/users/cart/items?groupid=${groupId}`, {
    token,
    body: addPayload,
    label: "POST /users/cart/items (BULK ADD)",
  });
  track(add, "cart/items");
  if (!add.ok) throw new Error(`bulk add failed (${add.status}): ${safeBody(add)}`);
  const addedItems = Array.isArray(add.body?.items) ? add.body.items : [];

  // Step 6: inventory check (stock).
  const invPayload = resolved.map((r) => ({
    quantity: r.quantity,
    itemCode: r.code,
    productId: String(r.product.id),
  }));
  const inv = await apiCall(page, "PUT", `/inventory/check?groupid=${groupId}`, {
    token,
    body: invPayload,
    label: "PUT /inventory/check (stock)",
  });
  track(inv, "inventory/check");
  const inventory = inv.ok ? inv.body : [];

  // Step 7: validate (rules).
  const validate = await apiCall(page, "GET", `/validate?licenseId=${subscriptionId}`, { token, label: "GET /validate (rules)" });
  track(validate, "validate");
  const validateBody = validate.ok ? validate.body : { success: false };

  // Step 8: per-ADA delivery info → deliveryByRef + deliveriesArr (raw).
  const deliveryByRef = {};
  const deliveriesArr = [];
  for (const ref of ["141", "221", "321"]) {
    const d = await apiCall(page, "GET", `/distributor/delivery?groupId=${groupId}&referenceNumber=${ref}`, {
      token,
      label: `GET /distributor/delivery ${ref}`,
    });
    track(d, `delivery/${ref}`);
    if (d.ok && d.body) {
      deliveryByRef[ref] = d.body;
      deliveriesArr.push(d.body);
    }
  }

  // Step 9: price the cart. PUT /users/cart/taxes with the cart items + the
  // deliveries array. Its RESPONSE is the PRICED cart (taxes[] populated).
  // CRITICAL: orderSummary only exists after this call; the parser reads
  // cart.taxes (cart.netTotal is garbage — do not use).
  const encoded = encodeURIComponent(JSON.stringify(deliveriesArr));
  const taxes = await apiCall(page, "PUT", `/users/cart/taxes?groupid=${groupId}&deliveries=${encoded}`, {
    token,
    body: addedItems,
    label: "PUT /users/cart/taxes (price)",
  });
  track(taxes, "cart/taxes");
  if (!taxes.ok) throw new Error(`price cart failed (${taxes.status}): ${safeBody(taxes)}`);
  const pricedCart = taxes.body;

  // Step 10: parse the priced cart into the validate-result shape. DRY-RUN ENDS.
  const result = parseMiloValidate({ cart: pricedCart, inventory, validate: validateBody, deliveryByRef });

  const totalApiMs = perCallMs.reduce((s, c) => s + c.ms, 0);
  return { ...result, engineTimings: { loginMs, perCallMs, totalApiMs } };
}
