# Handoff — 2026-07-18 EOD (node-direct engine SHIPPED; next: engine submit)

> **⚠️ SUPERSEDED 2026-07-22: engine submit is BUILT + deployed (tests
> 632/0). Current truth + the Thu 7/23 order-day script live in
> `2026-07-22-engine-submit-closeout.md`.**

Paste this whole file into a new chat to pick up exactly where we left off.
It supersedes `2026-07-19-BOOT-PROMPT.md` (that mission's first half is DONE —
numbers below are the new truth). Phase 0 of that boot prompt (the 24-file
read + checkpoint) still applies to a fresh chat; read it there, then return
here for current state.

**Context that matters: Tony is at Kalahari 7/19–7/21 — his first vacation in
a year. Nothing is scheduled to run while he's away. Next work session is
~Wed 7/22; order day (mandate 2/3) is Thu 7/23.**

---

## PART 1 — CLOSEOUT: what shipped 2026-07-18 (evening session)

### A. The probe verdicts — the browser is dead on the MILO API path

Ran `scripts/probe-milo-node-direct.mjs` ON the worker, then a pure-Node
login one-liner. Measured live:

- Browser-harvested token replayed from pure Node: `GET /account` → **200 in 329ms**
- **NO cf_clearance cookie existed** (1 cookie total) — Cloudflare is not
  challenging this API route at all
- **Pure-Node `POST /auth/login` → 200**, accessToken present, **token exp = 30 min**
- `GET /account` with that Node-obtained token → **200**

The Cloudflare assumption engine-api.js was built on is not currently
enforced. The ~31s Stage-1 Chromium login was pure tax on checks.

### B. The node-direct engine — built, tested, deployed, PROVEN in prod

| Commit | What |
|---|---|
| `e35a4cd` | probe: match loginToMilo(credentials, options) signature (real bug — options were passed in the credentials slot) |
| `1341b96` | engine: node-direct MILO transport — the build below |

- `src/rpa/engine/engine-api.js` — pluggable transports.
  `makeNodeMiloTransport()` (plain fetch, 60s hang-stop/call) + the original
  page transport (byte-identical, kept as fallback). Same
  `{ms,status,ok,body}` contract everywhere. `buildAndValidateViaApi` accepts
  `{transport}` or `{page}` and an optional `preauth` that skips
  `/auth/login`+`/account` (~460ms — the handoff micro-win, closed).
  `submitCartViaApi` speaks transport too — **engine submit is browserless
  the day it arms.**
- `src/rpa/engine/milo-node-session.js` — per-store token+account cache:
  30-min JWT, 5-min refresh margin, same-username-only, invalidated on ANY
  engine failure. Login failures CLASSIFIED: `invalid_credentials` (400/401)
  vs `blocked_or_down` (403/503/5xx/network).
- `src/workers/execution-worker.js` — node-direct branch ahead of the
  browser pipeline for `LK_ORDER_ENGINE=api` validate_only runs.
  `invalid_credentials` → run fails LOUD (never burns a browser bad-password
  attempt — MLCC lockout risk). `blocked_or_down` → LOUD per-run fallback to
  the untouched browser engine. Kill switch: `LK_MILO_TRANSPORT=browser`
  (default is node; no secret set — default rules).
- Tests: **617 passed / 0 failed / 56 files / ~0.8s** (was 590). New suites:
  `milo-node-session.unit.test.js`, `milo-node-transport.unit.test.js`,
  plus preauth/transport additions to engine-api + engine-submit suites.
  **617/0 is the new bar — if npm test shows less, something broke.**

**Production proof (run `04383638`, 2026-07-19T02:11Z):**

| | 2026-07-18 morning | now |
|---|---|---|
| Cold check | 34.4s | **3.7s** (engine 2,653ms = MILO floor) |
| Repeat check | 3.0s (warm-only, was a coin flip) | ~3s, cached token, **no warm/cold concept left** |

Second prod run confirmed the token cache: `preauth reused`, zero login.
No fallback warnings observed. Docs updated:
`ordering-speed-strategy.md` §"R2 IS FULLY BROWSERLESS" +
`STATE-OF-LIQUOR-KINGS.md` Phase-3 item 12.

### C. Open observations (small, not urgent)

- **Client perceived latency unmeasured.** Worker does 3.7s; the phone adds
  queue pickup (≤2.5s idle poll) + client polling before the pill lands.
  Tony never reported what the check FELT like — ask him, and if it feels
  slower than ~5s, the next shave is client-side polling / the API's run
  dispatch, not the worker.
- `LK_RPA_PERSIST_SESSION=yes` still set — now only relevant to the browser
  fallback + submit path. Harmless; leave until the submit path goes node.
- Old boot prompt (`2026-07-19-BOOT-PROMPT.md`) says 590 tests and frames
  the probe as unrun — superseded by this file (stale-notice added at its top).

---

## PART 2 — THE NEXT MISSION: engine submit (the second half of Tony's order)

Tony's directive, verbatim, still standing: *"idc about repeat checks we
need the cold to be way faster and the submit."* Cold is done. Submit
remains: armed submits still run browser Stages 1–5 (~minutes on order
night). The target: **one POST, seconds.**

### What already exists (do NOT rebuild)

- Endpoint + payload contract: `docs/lk/milo-checkout-endpoint.md`
  (decompiled from MILO's bundle; `POST /users/cart/checkout?groupid=`).
- `submitCartViaApi` + `buildCheckoutPayload` in engine-api.js: triple-gate
  enforced in-function (`allowLiveSubmission !== true` → dry-run, no POST),
  fail-closed payload build, `dispatched:true` the instant the POST issues
  (truth-rule hook), transport-ready. 12 unit tests green incl. the gate.

### The build (fresh session, ~Wed 7/22)

1. In `processOneRpaRun`, add an engine-submit branch for
   `runType==="rpa_run"` + `stage5Mode==="submit"` (probably gated
   `LK_SUBMIT_ENGINE=api` so browser Stage 5 stays the default until the
   first live fire): node session → `buildAndValidateViaApi` (fresh green
   check, same cart) → re-verify canCheckout + boundary gate → existing
   duplicate-submit tripwire → `submitCartViaApi` with the triple gate.
2. **Truth rule at the worker level:** `dispatched:true` + no confirmations
   → finalize `submitted_unconfirmed`, NEVER the failed/retry branch. Reuse
   the existing second-chance backstop idea: poll `/users/orders` via the
   node transport for confirmations before settling.
3. Confirmations → `persistMiloOrderConfirmations` with `execution_run_id`
   (dedupe index already exists).
4. Browser Stage 5 remains the fallback path, untouched.
5. Go-live per `milo-checkout-endpoint.md` checklist: first real fire
   Thursday 7/23's actual order, Tony watching, `fly logs` open, capture the
   real request/response into a durable artifact (P0-2 machinery uploads
   rpa-output already; the engine path should write its own artifact JSON).

### Also queued (after submit)

- Speculative pre-validate on cart-settle (the only true sub-second check).
- Client polling shave if Tony reports perceived lag (see Part 1C).
- Backlog unchanged: "Ordered before" in typed search; rpa_run_summary
  contract test; 4 Royal Canadian placeholder photos; KMS (S4); autoscale (S1).

---

## PART 3 — RULES THAT CARRY OVER (unchanged, non-negotiable)

- **One-writer (RULEBOOK #11):** Tony runs ALL git, ALL deploys, ALL
  deletions. Claude edits files only. Sandbox git reads use
  `--no-optional-locks`.
- **Tony's zsh:** no `#` on command lines; single quotes for commit
  messages; avoid `!` in double quotes.
- **Truth rule:** dispatched submit without captured confirmation =
  `submitted_unconfirmed`, terminal, never auto-retried.
- **Triple gate:** `mode==="submit"` AND `LK_ALLOW_ORDER_SUBMISSION==="yes"`
  AND `stores.allow_order_submission===true`. All currently OFF/disarmed.
- **DB discipline:** count-only, 1,000-row cap, print target host first.
  Prod Supabase `eamoozfhqolshdztbrez`; Colony
  `e594fc3a-17b7-45d0-9dde-943ebbfa5391`.
- **Credentials:** encrypted via `LK_CREDENTIAL_ENCRYPTION_KEY`;
  `samkado@gmail.com` is the MILO credential, NOT the app login.
- **Tests: 617/0 in ~0.8s** (updated this session — the old 590 number is
  stale).
- **Measure before cutting. Prove before trust. THE STRIVE stands.**

## Vacation posture (7/19–7/21)

Nothing needs Tony. Submission fully disarmed (all three gates off).
UptimeRobot pings `/health` every 5 min → his phone if the API dies. Sentry
release-tagged on both apps. Worker idle-polls at 2.5s, dead-man switch
armed. Any check his family runs will simply be fast now.
