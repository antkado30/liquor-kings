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
import { cartExactlyMatchesRequest } from "../../lib/cart-match.js";

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

  // Step 3: resolve each code → productId + distributor (productId kept STRING).
  // FAST PATH: if the caller pre-attached a cached MILO product (item.miloProduct,
  // sourced from mlcc_items.milo_product_id/milo_distributor by the worker), we
  // SKIP the per-code /products/code network round-trip entirely — that call is
  // ~1.3s each (first ~5.5s), so a fully-cached cart makes ZERO of them. For the
  // bulk-add + inventory payloads the engine only needs {id, distributor}, and
  // add already hardcodes restrictedQuantity:0, so the cached shape is complete.
  // An UNCACHED code falls through to the identical live resolve as before.
  const resolved = [];
  let cachedCount = 0;
  for (const item of cartItems) {
    const cached = item.miloProduct;
    if (cached && cached.id != null && String(cached.id).trim() !== "" && cached.distributor) {
      resolved.push({
        code: item.code,
        quantity: item.quantity,
        product: { id: String(cached.id), distributor: cached.distributor },
        fromCache: true,
      });
      cachedCount += 1;
      continue;
    }
    const r = await apiCall(page, "POST", `/products/code/${item.code}`, {
      token,
      body: { include_pr: subscriptionId },
      label: `POST /products/code/${item.code}`,
    });
    track(r, `products/code/${item.code}`);
    if (!r.ok || !r.body?.id) throw new Error(`resolve ${item.code} failed (${r.status}): ${safeBody(r)}`);
    resolved.push({ code: item.code, quantity: item.quantity, product: r.body, fromCache: false });
  }
  if (cachedCount > 0) {
    console.log(`  productId cache: ${cachedCount}/${cartItems.length} codes pre-mapped (skipped ${cachedCount} /products/code call${cachedCount === 1 ? "" : "s"})`);
  }

  // Step 4: clear cart (prep; NOT a submit).
  const clear = await apiCall(page, "DELETE", `/users/cart?groupid=${groupId}`, { token, label: "DELETE /users/cart (clear)" });
  track(clear, "clear");
  // FAIL CLOSED (2026-07-08, doctrine §14): a failed clear means the cart is
  // in an UNKNOWN state — adding onto it would price/validate a cart that
  // isn't the requested order. Found live: MILO returned 500 on clear and the
  // engine sailed on. Never again. (No status carve-outs on purpose — if MILO
  // ever 404s a clear we want to SEE it and decide with evidence, not assume.)
  if (!clear.ok) {
    throw new Error(
      `cart clear failed (${clear.status}): ${safeBody(clear)} — cart state unknown, refusing to build on it`,
    );
  }

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

  // Steps 6+7+8 IN PARALLEL (2026-07-05): the stock check, the rules
  // validate, and the 3 per-ADA delivery lookups are five independent READ
  // calls — none mutates the cart, none consumes another's response. Firing
  // them concurrently cuts post-add wall time from sum(5) to max(5). The only
  // cart WRITE after bulk-add (taxes, step 9) still runs strictly AFTER all
  // five complete, so read/write ordering vs the sequential version is
  // unchanged. NOTE apiCall never rejects on an HTTP failure (returns
  // { ok:false }); a rejection here means the PAGE died, which failed the run
  // in the sequential version too. Every soft-fail bias is preserved exactly:
  // inv not-ok → inventory [] (parser flags every item needsRecheck —
  // fail-safe), validate not-ok → { success:false } (fail-safe), a failed
  // delivery ref is omitted (same as before).
  const DELIVERY_REFS = ["141", "221", "321"];
  const invPayload = resolved.map((r) => ({
    quantity: r.quantity,
    itemCode: r.code,
    productId: String(r.product.id),
  }));
  const postAddStart = Date.now();
  const [inv, validate, ...deliveryResults] = await Promise.all([
    // Step 6: inventory check (stock).
    apiCall(page, "PUT", `/inventory/check?groupid=${groupId}`, {
      token,
      body: invPayload,
      label: "PUT /inventory/check (stock)",
    }),
    // Step 7: validate (rules).
    apiCall(page, "GET", `/validate?licenseId=${subscriptionId}`, { token, label: "GET /validate (rules)" }),
    // Step 8: per-ADA delivery info → deliveryByRef + deliveriesArr (raw).
    ...DELIVERY_REFS.map((ref) =>
      apiCall(page, "GET", `/distributor/delivery?groupId=${groupId}&referenceNumber=${ref}`, {
        token,
        label: `GET /distributor/delivery ${ref}`,
      }),
    ),
  ]);
  const postAddWallMs = Date.now() - postAddStart;

  // Record results in the SAME fixed order as the old sequential flow so
  // perCallMs stays deterministic regardless of which call finished first.
  track(inv, "inventory/check");
  const inventory = inv.ok ? inv.body : [];

  track(validate, "validate");
  const validateBody = validate.ok ? validate.body : { success: false };

  const deliveryByRef = {};
  const deliveriesArr = [];
  DELIVERY_REFS.forEach((ref, i) => {
    const d = deliveryResults[i];
    track(d, `delivery/${ref}`);
    if (d.ok && d.body) {
      deliveryByRef[ref] = d.body;
      deliveriesArr.push(d.body);
    }
  });

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

  // Step 9.5 — BOUNDARY COMPARISON GATE (2026-07-08, doctrine §11 + §14/§18):
  // what we sent === what came back. The priced cart MILO returned must hold
  // EXACTLY the requested lines — same codes, same quantities, nothing extra,
  // nothing missing. Uses the same pure matcher the RPA path trusts
  // (cart-match.js, bias toward false). ANY mismatch fails the run LOUD
  // before the result can reach the user as truth. This is what turns a
  // silently-ignored clear failure (or any MILO cart weirdness) into an
  // honest, named failure instead of a wrong validate result.
  const requestedLines = resolved.map((r) => ({ code: r.code, quantity: r.quantity }));
  const pricedLines = (Array.isArray(pricedCart?.items) ? pricedCart.items : []).map((it) => ({
    code: it?.product?.code,
    quantity: it?.quantity,
  }));
  const cartGate = cartExactlyMatchesRequest(requestedLines, pricedLines);
  if (!cartGate.match) {
    throw new Error(
      `MILO cart does not match the requested order (${cartGate.reason}) — ` +
      `failing closed. Requested ${requestedLines.length} line(s), MILO returned ${pricedLines.length}. Nothing was submitted.`,
    );
  }

  // Step 10: parse the priced cart into the validate-result shape. DRY-RUN ENDS.
  const result = parseMiloValidate({ cart: pricedCart, inventory, validate: validateBody, deliveryByRef });

  const totalApiMs = perCallMs.reduce((s, c) => s + c.ms, 0);
  return {
    ...result,
    engineTimings: {
      loginMs,
      perCallMs,
      totalApiMs, // sum of per-call durations (≥ wall time now that reads overlap)
      postAddWallMs, // wall-clock time of the parallel read batch (steps 6-8)
      cachedCount,
      liveResolveCount: cartItems.length - cachedCount,
    },
  };
}
