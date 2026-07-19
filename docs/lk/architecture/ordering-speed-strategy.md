# Ordering Speed Strategy — 2hr → 5min (2026-06-27)

**Goal:** complete ordering (scan → submitted) in ~5 minutes, down from ~2 hours. Must scale to ANY store: ours is ~500 bottles/week, but a Kroger/Meijer/Art&Jake's could order tens of thousands of bottles. Architecture must handle that. Solve it right — stop patching, test multiple routes.

**The reframe (the crux):** The bottleneck is NOT MLCC's validate — MILO validates in ~5s once the cart is built. The slowness is that our RPA REBUILDS the whole cart inside MILO every run by puppeteering the site (login + Add-By-Code one item at a time). MLCC is fast natively because the cart's already in their system; validate is one backend call. We're slow because we shove the cart through the browser like a human typing. LK is strong where MLCC hurts (fast input: scan/photo/search); weak where MLCC is strong (native validate+submit).

**Confirmed facts (Tony, 2026-06-27):**
- MILO validate: ~5s once cart built.
- MILO login: username + password + accept-terms checkbox. NO 2FA, NO captcha.
- MILO has only Add-By-Code + Products(search). NO bulk import/upload.
- No official MLCC electronic ordering known — website by hand only.
- Each store has a weekly mandatory cutoff (Colony = Thu 8pm).

**Routes (✅ tried / ⬜ untested):**
- ✅ R1 Browser RPA (current) — slow+flaky, re-types whole cart. All we've tested.
- ✅ R2 MILO backend API direct — PROVEN 2026-06-28 (see section below). Clean JWT REST API; bulk-add = one call.
- ✅ R3 Hybrid — PROVEN 2026-06-28. Browser login (passes Cloudflare + yields JWT), then all cart ops as same-origin fetch. This is the recommended production route.
- ⬜ R4 Live cart sync — push each scanned item into MILO in the background as you scan; validate-time the cart's already there.
- ⬜ R5 Bulk import — DEAD (MILO has none).
- ⬜ R6 Official MLCC EDI/API — likely none; low-priority check.
- ⬜ R7 Smooth manual fallback — dump cart as MILO-ready lines to hand-key on deadline.

**Decisive experiment:** instrument the existing RPA to RECORD every HTTP request MILO makes during add+validate, then replay them directly (no browser). If their backend answers us like it answers their site → 5-second path found.

**Honest caveat:** R2 is still automating MLCC (same "is this sanctioned" question as R1). Testing is safe; going live is the same judgment call.

**Scale mandate:** per-item browser typing can't scale to tens of thousands of bottles. This alone argues R2 over R1.

---

## ⭐ R2 + R3 PROVEN — 2026-06-28 (no-browser-typing path works on live MILO)

Captured a HAR of a real add+validate run (after fixing Stage 2's license-dropdown handling), mapped MILO's REST API, then **replayed the whole cart-build + validate as direct API calls — no DOM typing — against live MILO, DRY-RUN.** It worked end to end. Reference spike: `services/api/src/rpa/_test_r2_replay.js` (dry-run only; never calls submit/checkout).

**Architecture:** MILO is an Angular SPA over a JWT REST API at `/LiquorOrderingApi/api/*`. Auth = `Authorization: Bearer <accessToken>` on every call (no server cookie session). Cloudflare sits in front (`__cf` cookie), so the reliable pattern is **R3 hybrid**: real browser login (passes Cloudflare + yields the JWT), then fire every cart op as same-origin `fetch` from the page context.

**Token capture:** MILO does NOT persist the JWT in reachable localStorage / sessionStorage / cookies — re-POST `/auth/login` from the page after the browser login and read `{accessToken}` from the response.

**Endpoint map (verified):**
| Step | Call | Notes |
|---|---|---|
| Login | `POST /auth/login` `{username,password}` | → `{accessToken, refreshToken}` |
| Identity | `GET /account` | → `groups[0].id` (**groupId**), `groups[0].subscriptionId` |
| Resolve code | `POST /products/code/<code>` `{include_pr: subscriptionId}` | → product `{id, distributor, restrictedQuantity, …}`. One per code. |
| Clear cart | `DELETE /users/cart?groupid=<groupId>` | prep, not a submit |
| **★ BULK ADD** | `POST /users/cart/items?groupid=<groupId>` body `[{productId, quantity, distributor, restrictedQuantity}, …]` | **entire cart in ONE call**; response = full cart w/ per-line totals |
| Stock | `PUT /inventory/check?groupid=<groupId>` body `[{quantity, itemCode, productId}]` | `available:false` = OOS |
| Validate | `GET /validate?licenseId=<subscriptionId>` | → `{success, licenseNumber}` |
| Read cart | `GET /users/cart?groupid=<groupId>&deliveries=<json>` | needs `deliveries` param (500 without); totals also in bulk-add response |
| (also seen) | `PUT /users/cart/taxes`, `GET /users/current/orders` | tax recompute, order history |

**Critical query params (calls 400 without them):** cart/inventory → `?groupid=<account.groups[0].id>`; validate → `?licenseId=<account.groups[0].subscriptionId>`.

**Timings (spike run, COLD):** browser login 2935ms (one-time). Direct API 13137ms / 8 calls — dominated by two cold calls (`products/code` 5505ms, `inventory/check` 4435ms). Cart-critical path (clear 122 + **bulk-add 96** + validate 1530) ≈ 1.75s. The per-item-typing bottleneck is GONE and it scales (a 10k-bottle order = a bigger array, still one POST).

**Biggest optimization:** pre-store MILO's `productId` in our own catalog → delete the slow `/products/code/*` resolves at order time. Live path becomes login → bulk-add → inventory+validate. Plausibly ~2–4s warm.

**GAP — submit is unmapped.** The spike is dry-run; `confirmationNumber` stays null. The submit/checkout endpoint is NOT captured. To map it: a SUPERVISED ARMED run on a real Colony order with HAR recording, per the go-live runbook. Deliberate step — real order, real money. *(Closed 2026-07-17: endpoint recovered from the Angular bundle — see docs/lk/milo-checkout-endpoint.md.)*

---

## ⭐⭐ R2 IS FULLY BROWSERLESS — PROVEN + BUILT 2026-07-18 (the Node-direct dig)

Ran `scripts/probe-milo-node-direct.mjs` ON the worker (stable egress IP),
then a pure-Node login test. Measured live:

- Browser-harvested token replayed from pure Node: `GET /account` → **200 in 329ms**
- **NO `cf_clearance` cookie existed** (1 cookie total) — Cloudflare is not
  challenging this API route at all right now
- **Pure-Node `POST /auth/login` → 200**, accessToken present, **token exp = 30 min**
- `GET /account` with that Node-obtained token → **200**

Conclusion: the browser was load-bearing for NOTHING on the API path. The
Cloudflare assumption (engine ran inside `page.evaluate` to carry
`cf_clearance`) is not currently enforced by MILO. The ~31s Stage-1 login was
pure tax.

**BUILT same day (worker-side; default ON via `LK_MILO_TRANSPORT=node`):**

- `src/rpa/engine/engine-api.js` — pluggable transports:
  `makeNodeMiloTransport()` (plain fetch, 60s hang-stop per call) alongside
  the original page transport (kept byte-identical as the fallback). Same
  `{ms,status,ok,body}` contract; the engine body, fail-closed clear,
  parallel reads, and boundary gate are unchanged. `submitCartViaApi` speaks
  transport too — engine-submit fires browserless the day it arms (still
  triple-gated, still order-day-only per the go-live runbook).
- `src/rpa/engine/milo-node-session.js` — per-store token+account cache
  (30-min JWT, 5-min refresh margin, same-username-only, invalidated on ANY
  engine failure). Also kills the handoff's warm micro-win: `preauth` skips
  the redundant `/auth/login` + `/account` pair (~460ms).
- `src/workers/execution-worker.js` — node-direct branch ahead of the
  browser pipeline for `LK_ORDER_ENGINE=api` validate_only runs. Login
  failures are classified: `invalid_credentials` fails the run LOUD and
  never touches the browser (a second bad-password attempt risks an MLCC
  lockout); `blocked_or_down` (Cloudflare/network shaped) falls back LOUDLY
  to the untouched browser engine for that run. Kill switch:
  `LK_MILO_TRANSPORT=browser`.

**Expected cold check: ~2.5–3.5s (was 34.4s), every time — no warm/cold
distinction left.** MILO's own ~2.4–2.7s API floor is now the whole cost.

Honest caveat: Cloudflare posture can change any day. The browser path stays
deployed and reachable per-run (automatic fallback) or wholesale (env flip).
If fallback warnings ever appear in worker logs, re-run the probe.
