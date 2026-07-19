# Handoff — 2026-07-18 (strangler-fig completion + the speed dig)

Paste this whole file into a new chat to pick up exactly where we left off.

---

## PART 1 — CLOSEOUT: what shipped today

### A. The strangler-fig removal is COMPLETE and verified in production

Three commits removed **~28,040 lines** of dead legacy RPA browser-automation
code and the CI apparatus that policed it.

| Commit | What |
|---|---|
| `dc6b3d6` | strangler-fig 1/2 — 13 dead test files + dev npm script; trimmed anti-drift to live middleware |
| `879201c` | strangler-fig 2/2 — **26,807 lines** across 14 source files (browser-worker, add-by-code-probe, phase-2* policies, guards, evidence) |
| `28514b7` | strangler-fig 3/3 — **1,233 lines** of orphaned SAFE-MODE verification apparatus |

**The 3/3 commit was the important catch.** The legacy subsystem was policed by
CI scripts that read those files as *text* (`fs.readFileSync`, `node --test`) —
invisible to an import grep, so they survived the source cut and would have
turned CI red on the next push while asserting safety guarantees about code
that no longer existed. Removed: `tests/rpa/safe-mode-invariant.test.js`,
`scripts/lk-verify/verify-rpa-safety.mjs` (914 lines), `doctor-mlcc-dry-run.mjs`,
`mlcc-dry-run-doctor.mjs`. Rewired `verify-contracts.mjs` (dropped 4 dead
existence checks, kept all live ones), `verify-architecture.mjs` (contracts
only), the GitHub workflow (replaced the dead "RPA safety checks" step with
`verify:lk:architecture`, added `LK_TEST_SMOKE=1` to the staging smoke job),
and root `package.json`.

**Verified live:** API healthy, worker booted on the new image, and a real
validate run completed end to end against MILO with 28k lines gone.

### B. The test suite is trustworthy again

`16e5b7e` split hermetic unit tests from integration smoke tests
(`services/api/vitest.config.js`, toggled by `LK_TEST_SMOKE=1`).

- **Before:** 40 failed / 600 passed, permanently red, 150 seconds
- **After:** **590 passed / 54 files / 0 failed, 0.8 seconds**

Those 40 were `*.smoke.test.js` suites needing a live API + Supabase; they'd
failed on every run for months. Now `npm test` is green-means-safe and
`npm run test:smoke` runs the integration tier when a backend is up.

### C. The speed dig — measured, not guessed

Added `[timing]` instrumentation (`0d97663`) attributing every phase of a run.
Then found and fixed two real bugs:

**Bug 1 (`54aecc0`) — sessions were never held for reuse.**
`attachFreshSession()` lives at the end of the old stage-by-stage path; the API
engine returns long before reaching it. So with `LK_RPA_PERSIST_SESSION=yes`,
`sessionId` stayed null forever and every run logged `no_held_session`. Warm
reuse had never once worked. (What looked like a warm speedup — 31s → 5.6s —
was only Chromium/OS warm-start.)

**Bug 2 (`907d3f2`) — the engine never ran on a warm session.**
The engine block sat *inside* `if (!sessionWasReused)`. A reused session
skipped it entirely: the run did no work, the session manager tore it down as
`run_did_not_complete`, and the run was re-claimed and re-run cold. Measured on
run `ed2359a7`: warm acquire at 22:27:16, session closed in the *same second*,
cold re-run after. On `adc38c07` the cold retry took **141,860ms**. That made
every check a coin flip between 0.3s and 2min21s.

Fix: login is now the only cold-only step; the engine always runs; Stage 2
navigate re-enters a cold-only guard so cold runs stay as fast as before.

**Result, measured live (runs `a2dad6b7` cold, `3922e8b6` warm):**

| | Our overhead | MILO | Total |
|---|---|---|---|
| Cold | 31,680ms | 2,686ms | **34.4s** |
| Warm | **371ms** | 2,645ms | **3.0s** |

Warm is now deterministic and essentially at the MILO floor — our code costs
371ms. `LK_RPA_PERSIST_SESSION` is currently **`yes`** on the worker.

### D. Also saved

`docs/lk/TONY-WANTS.md` now opens with **♾️ THE STRIVE — THE STANDING ORDER**
(Tony, 2026-07-18): "It works" is never the finish line; never accept a number
just because it beat the last one; when a limit is real, say so honestly and
attack the assumption around it; measure before cutting.

---

## PART 2 — THE MISSION: kill the cold check and the submit

Tony's direction, verbatim: *"idc about repeat checks we need the cold to be
way faster and the submit."* He's right — the real workflow is open the app,
build a cart, check **once** (always cold), and on order night, submit.

### The two numbers that matter

- **Cold check: 34.4s** — of which **31.4s is Stage 1 browser login**
- **Armed submit: minutes** — Stage 5 hands off to the browser for checkout

### The finding that reframes both

`engine-api.js` runs every MILO call *inside* a Playwright page:

```js
// "Call a MILO API endpoint from INSIDE the page via fetch (same-origin →
//  Cloudflare cf_clearance carries; we add the Bearer header)"
const result = await page.evaluate(... fetch(url, { credentials: "include" }))
if (!session?.page) throw new Error("buildAndValidateViaApi: session.page is required")
```

**MILO is behind Cloudflare.** The browser exists to carry `cf_clearance` —
it is load-bearing, not habit. So Playwright cannot simply be deleted.

**But** `cf_clearance` is just a cookie and the accessToken is just a header.
The browser is only needed to *obtain* them. If a Node client can present both
and get through, then:

- Harvest clearance + token once with a browser, cache them
- Run every check and submit from Node — **no browser on the hot path**
- Cold check → **~2.7s** (the MILO floor). Submit → one API call.
- Refresh with a browser only when the clearance expires

### NEXT STEP — run the probe (already written, uncommitted)

`services/api/scripts/probe-milo-node-direct.mjs` answers this decisively.
It is **READ-ONLY** — logs in, calls `GET /account`, never touches the cart,
never submits. Run it on the worker (stable egress IP matters; cf_clearance is
usually bound to IP + User-Agent):

```
fly ssh console -a liquor-kings-worker
cd /app/services/api
MILO_API_BASE=<same as API_BASE in src/rpa/engine/engine-api.js> \
MILO_USERNAME=... MILO_PASSWORD=... node scripts/probe-milo-node-direct.mjs
```

Before running, confirm two things the probe assumes (flagged in its comments):
`API_BASE`'s real value in `engine-api.js`, and `loginToMilo`'s exact options
signature in `src/rpa/stages/login.js`.

**Reading the verdict:**

- **200** → Node-direct works. Build the clearance/token cache. Cold collapses
  to the MILO floor and submit becomes one call. Then measure clearance TTL by
  re-running phase 3 every ~15 min — that number sets the refresh cadence.
- **403 / 503** → Cloudflare blocks Node. Fall back to **pre-warm**: launch and
  log in during the user's think-time (on cart open) so the check is always
  warm. Hides the 31s instead of deleting it.
- **401** → Clearance passed, auth didn't. Token handling problem, not a wall.

### After that

- **engine-submit go-live** — `submitCartViaApi` / `buildCheckoutPayload` are
  built and unit-tested (`engine-submit.unit.test.js` green, truth-rule gate
  included). Replaces the browser checkout with `POST /users/cart/checkout`.
  Deliberately queued for an order day with a real order in front of us.
- **Speculative pre-validate** — run the check in the background when the cart
  settles so pressing Validate reads a ready answer. The only true sub-second.
- **Micro-win** — on a warm session the engine still does `POST /auth/login` +
  `GET /account` (~180ms) despite already holding a valid token.

### Backlog (unchanged)

"Ordered before" filter in typed search (needs store-auth on the price-book
route); a contract test for the live `rpa_run_summary` (built inline at
`execution-worker.js`, never had one — needs a testable seam); curate 4 Royal
Canadian placeholder photos; KMS (S4); autoscale worker (S1).

---

## PART 3 — RULES THAT CARRY OVER

- **One-writer rule (RULEBOOK #11):** Tony runs ALL git commands, ALL deploys,
  ALL file deletions. Claude edits files only.
- **Tony's zsh:** `#` is not a comment (it runs as a command) and `!` inside
  double quotes triggers history expansion. Never put `#` comments on command
  lines; use single quotes for commit messages, avoid `!`.
- **Truth rule:** a dispatched submit whose confirmation isn't captured is
  `submitted_unconfirmed` — never "failed", never auto-retried. Double-order
  prevention.
- **Triple gate for submit:** `mode==="submit"` AND
  `LK_ALLOW_ORDER_SUBMISSION==="yes"` AND `stores.allow_order_submission===true`.
- **DB discipline:** count-only queries with a 1,000-row cap; always print the
  target host first. Prod Supabase `eamoozfhqolshdztbrez`; Colony store_id
  `e594fc3a-17b7-45d0-9dde-943ebbfa5391`.
- **Credentials:** MLCC creds are encrypted (`LK_CREDENTIAL_ENCRYPTION_KEY`).
  `samkado@gmail.com` is the MILO credential, NOT the app login.
- **Measure before cutting.** Unattributed time is not an excuse to guess.
