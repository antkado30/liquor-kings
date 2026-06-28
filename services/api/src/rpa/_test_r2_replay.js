/**
 * R3 NO-BROWSER-TYPING PROTOTYPE (throwaway spike, 2026-06-28).
 *
 * Proves the 2hr→5min path: log in via the real browser (that's what passes
 * Cloudflare + yields the JWT), then build the cart + validate by calling
 * MILO's REST API DIRECTLY from the page's fetch context — NO DOM typing.
 * Times each call. DRY-RUN ONLY.
 *
 * SAFETY (non-negotiable):
 *   - DRY-RUN. Resolve → clear → bulk-add → inventory-check → validate →
 *     read-cart. We NEVER call any submit / checkout / finalize / place-order
 *     endpoint. That endpoint is unmapped and is NOT touched here.
 *   - Creds from the gitignored services/api/.env (no secret on the command
 *     line). The accessToken is redacted in all logging.
 *
 * Endpoints + payload shapes come straight from the HAR captured by
 * _test_validate.js (login-20260628_190207/network.har).
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { loginToMilo } from "./stages/login.js";

const API_BASE = "https://www.lara.michigan.gov/LiquorOrderingApi/api";

// Same 2-item cart as _test_validate.js so results are comparable.
const TEST_CART = [
  { code: "9121", quantity: 12 },
  { code: "11022", quantity: 12 },
];

const redact = (v) =>
  String(v).replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>").replace(/eyJ[A-Za-z0-9._-]+/g, "<jwt-redacted>");

/**
 * Call a MILO API endpoint from INSIDE the page via fetch (same-origin →
 * Cloudflare cf_clearance cookie carries; we add the Bearer header). Times
 * the network call with performance.now() inside the page.
 */
async function apiCall(page, method, path, { token, body, label } = {}) {
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
  console.log(
    `  ${label ?? `${method} ${path}`}: ${result.status} (${result.ms}ms)${result.ok ? "" : " ⚠️ not ok"}`,
  );
  return result;
}

/**
 * Capture an accessToken by re-POSTing /auth/login FROM THE PAGE (same-origin
 * → Cloudflare cf_clearance already cleared by the browser login; MILO returns
 * {accessToken, refreshToken}). More reliable than hunting storage — MILO
 * doesn't persist the JWT in reachable localStorage/sessionStorage/cookies.
 * The response body (which contains the token) is NOT logged; only status/ms.
 */
async function loginViaApi(page, username, password) {
  const r = await apiCall(page, "POST", "/auth/login", {
    body: { username, password },
    label: "POST /auth/login (capture token)",
  });
  if (!r.ok || !r.body?.accessToken) {
    throw new Error(`In-page /auth/login failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return r.body.accessToken;
}

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const licenseNumber = process.env.MILO_TEST_LICENSE;
  if (!username || !password || !licenseNumber) {
    throw new Error("Missing MILO_USERNAME / MILO_PASSWORD / MILO_TEST_LICENSE in services/api/.env");
  }

  console.log("=== R3 NO-BROWSER-TYPING PROTOTYPE (DRY-RUN, no submit) ===\n");

  // ── Step 1: browser login (passes Cloudflare) ─────────────────────────
  console.log("Step 1: browser login (Cloudflare + JWT)…");
  const loginStart = Date.now();
  const session = await loginToMilo(
    { username, password },
    { headless: true, slowMo: 0, captureArtifacts: false },
  );
  const loginMs = Date.now() - loginStart;
  console.log(`  logged in (${loginMs}ms) — url: ${session.page.url()}`);

  const page = session.page;
  const token = await loginViaApi(page, username, password);
  console.log(`  accessToken captured (${token.length} chars, redacted: ${redact(token)})\n`);

  const apiTimes = [];
  const track = (ms) => apiTimes.push(ms);

  try {
    // ── Step 2a: account → subscriptionId (for /products/code include_pr) ──
    console.log("Step 2: direct MILO API calls (no DOM typing)…");
    const account = await apiCall(page, "GET", "/account", { token, label: "GET /account" });
    track(account.ms);
    // Cart/validate calls need the group id (groupid query param) and the
    // subscription id (validate's licenseId param) — both come from /account.
    const group = account.body?.groups?.[0] ?? {};
    const groupId = group.id ?? null;
    const subscriptionId = group.subscriptionId ?? null;
    console.log(`     groupId: ${groupId}, subscriptionId: ${subscriptionId}`);

    // ── Step 2b: resolve each code → productId + distributor ──────────────
    const resolved = [];
    for (const item of TEST_CART) {
      const r = await apiCall(page, "POST", `/products/code/${item.code}`, {
        token,
        body: { include_pr: subscriptionId },
        label: `POST /products/code/${item.code}`,
      });
      track(r.ms);
      if (!r.ok) {
        console.log(`     ⚠️ resolve failed for ${item.code}: ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      const p = r.body;
      resolved.push({
        code: item.code,
        quantity: item.quantity,
        productId: p?.id,
        distributor: p?.distributor,
        restrictedQuantity: p?.restrictedQuantity ?? 0,
      });
      console.log(`     ${item.code} → productId=${p?.id}, distributor=${p?.distributor?.referenceNumber} (${p?.distributor?.name})`);
    }

    // ── Step 2c: CLEAR cart (prep; NOT a submit) ──────────────────────────
    const clear = await apiCall(page, "DELETE", `/users/cart?groupid=${groupId}`, { token, label: "DELETE /users/cart (clear)" });
    track(clear.ms);

    // ── Step 2d: BULK ADD — both items in ONE call ────────────────────────
    const addPayload = resolved.map((r) => ({
      productId: r.productId,
      quantity: r.quantity,
      distributor: r.distributor,
      restrictedQuantity: r.restrictedQuantity,
    }));
    console.log("     bulk-add payload:", JSON.stringify(addPayload));
    const add = await apiCall(page, "POST", `/users/cart/items?groupid=${groupId}`, { token, body: addPayload, label: "POST /users/cart/items (BULK ADD)" });
    track(add.ms);
    const cartItems = Array.isArray(add.body?.items) ? add.body.items : [];
    console.log(`     cart now has ${cartItems.length} item(s); first total: ${cartItems[0]?.total ?? "n/a"}`);

    // ── Step 2e: inventory check (stock) + validate (rules) ───────────────
    const invPayload = resolved.map((r) => ({ quantity: r.quantity, itemCode: r.code, productId: r.productId }));
    const inv = await apiCall(page, "PUT", `/inventory/check?groupid=${groupId}`, { token, body: invPayload, label: "PUT /inventory/check (stock)" });
    track(inv.ms);
    const oos = Array.isArray(inv.body) ? inv.body.filter((x) => x.available === false) : [];
    console.log(`     stock: ${inv.body?.length ?? 0} checked, ${oos.length} out of stock`);

    const validate = await apiCall(page, "GET", `/validate?licenseId=${subscriptionId}`, { token, label: "GET /validate (rules)" });
    track(validate.ms);
    console.log(`     validate.success: ${validate.body?.success}, license: ${validate.body?.licenseNumber}`);

    // ── Step 2f: read cart (final totals) ─────────────────────────────────
    const cart = await apiCall(page, "GET", `/users/cart?groupid=${groupId}`, { token, label: "GET /users/cart (totals)" });
    track(cart.ms);
    const totals = cart.body?.orderSummary ?? cart.body?.summary ?? null;
    console.log(`     totals: ${JSON.stringify(totals)}`);

    // ── Summary ───────────────────────────────────────────────────────────
    const apiTotal = apiTimes.reduce((a, b) => a + b, 0);
    console.log("\n=== RESULT ===");
    console.log(`Browser login: ${loginMs}ms (one-time; Cloudflare)`);
    console.log(`Direct API total (resolve + clear + bulk-add + stock + validate + read-cart): ${apiTotal}ms across ${apiTimes.length} calls`);
    console.log(`  per-call: [${apiTimes.join(", ")}] ms`);
    console.log(`validated: ${validate.body?.success === true}, canCheckout implied by stock (OOS=${oos.length})`);
    console.log("DRY-RUN COMPLETE. No submit/checkout endpoint was called.");
  } finally {
    if (session?.context) await session.context.close().catch(() => {});
    if (session?.browser) await session.browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("R3 prototype failed:", error?.message || String(error));
  process.exit(1);
});
