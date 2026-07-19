# BOOT PROMPT — paste this entire file as your FIRST message in a new chat

You are picking up work on **Liquor Kings** — a B2B SaaS that automates
MLCC/MILO liquor ordering for retail stores. Tony (19, founder) built it and is
running real money through it. Your predecessor handed off mid-mission.

**DO NOT WRITE OR EDIT A SINGLE LINE OF CODE UNTIL YOU FINISH PHASE 0.**
Do not propose solutions. Do not guess at architecture. Read first.

---

## PHASE 0 — LOAD THE SYSTEM (mandatory, in this order)

Read every file below. They are real paths in this repo. If a file is large,
read all of it anyway — this is the one time it pays for itself.

### 0.1 — The rules and the standard (READ THESE FIRST, NON-NEGOTIABLE)

| File | Why |
|---|---|
| `docs/lk/RULEBOOK.md` | The operating rules. **Rule #11 (one-writer): Tony runs ALL git commands, ALL deploys, ALL file deletions. You edit files only.** Violating this is the fastest way to lose his trust. |
| `docs/lk/TONY-WANTS.md` | Permanent directives. Opens with **♾️ THE STRIVE** (the standing order) and **⚡ THE QUALITY MANDATE**. This file IS the spec for how good things must be. |
| `docs/lk/INTEGRITY-DOCTRINE.md` | The honesty bar. Nothing fails silently, ever. |
| `docs/lk/DEVELOPER_ANTI_DRIFT.md` | How the codebase resists rot. |
| `docs/SAFETY_INVARIANTS.md` | What must never break. Money path. |

### 0.2 — Where the system actually is

| File | Why |
|---|---|
| `docs/lk/STATE-OF-LIQUOR-KINGS.md` | Current state of everything, env vars, deploys. |
| `docs/PROJECT_STATE.md` | Project-level status. |
| `docs/lk/SCALE-READINESS.md` | What's ready for scale and what isn't (S1–S4 items). |
| `docs/lk/handoffs/2026-07-18-speed-dig-handoff.md` | **Yesterday's closeout — the immediate context for your mission.** |
| `docs/lk/runbooks/order-day-2026-07-16-postmortem.md` | The last REAL order ($5,338). What broke and why. Read this carefully — it's where the timeouts and the truth rule came from. |

### 0.3 — Architecture

| File | Why |
|---|---|
| `docs/lk/architecture/strategic-architecture.md` | The shape of the whole thing. |
| `docs/lk/architecture/execution-state-machine.md` | Run lifecycle: queued → running → succeeded/failed/**submitted_unconfirmed**. |
| `docs/lk/architecture/ordering-speed-strategy.md` | **Directly relevant to your mission.** Prior thinking on speed. |
| `docs/lk/architecture/api-contract-truth.md` | API contracts that must not drift. |
| `docs/lk/architecture/auth-and-store-scoping-invariants.md` | Store scoping / RLS invariants. |
| `docs/lk/architecture/rpa-safety-rules.md` | RPA safety rules. |
| `docs/lk/milo-checkout-endpoint.md` | The recovered MILO submit endpoint. Central to the submit half of the mission. |
| `docs/lk/runbooks/order-submission-go-live.md` | The arming procedure for a real submit. |

### 0.4 — The code on the hot path (read the actual source)

| File | Why |
|---|---|
| `services/api/src/workers/run-rpa-worker.js` | The production worker daemon entrypoint. |
| `services/api/src/workers/execution-worker.js` | `processOneRpaRun` — the whole run. Large; read it properly. Note the `[timing]` marks added 2026-07-18. |
| `services/api/src/rpa/engine/engine-api.js` | The API engine. **Read the header comments — they explain the Cloudflare `cf_clearance` constraint that defines your mission.** |
| `services/api/src/rpa/engine/engine-submit.js` | `submitCartViaApi` — built and tested, NOT live yet. |
| `services/api/src/rpa/stages/login.js` | Stage 1. **This is the 31 seconds you are trying to kill.** |
| `services/api/src/workers/rpa-session-manager.js` | Warm session hold/reuse, idle timeout, liveness probe. |
| `services/api/scripts/probe-milo-node-direct.mjs` | The probe you will verify and run. |

### 0.5 — CHECKPOINT (do this before anything else)

Report back to Tony, briefly, in your own words:

1. The **one-writer rule** and what it means for how you'll work.
2. The **truth rule** — what `submitted_unconfirmed` means and why a dispatched
   submit is never auto-retried.
3. The **triple gate** that must all be true for a real order to submit.
4. Why the RPA path uses a **browser at all** (hint: it's not laziness).
5. The current **cold vs warm** check numbers and where the time goes.

If you can't answer all five from the reading, read more. Do not proceed.

---

## PHASE 1 — THE MISSION

Tony's words, verbatim: **"idc about repeat checks we need the cold to be way
faster and the submit."**

The real workflow is: open the app, build a cart, hit check **once** (always
cold), and on order night, submit. So the only two numbers that matter:

- **Cold check: 34.4s** — of which **31.4s is the Stage 1 browser login**
- **Armed submit: minutes** — Stage 5 hands off to the browser for checkout

Measured live 2026-07-18 (runs `a2dad6b7` cold, `3922e8b6` warm):

| | Our overhead | MILO | Total |
|---|---|---|---|
| Cold | 31,680ms | 2,686ms | **34.4s** |
| Warm | 371ms | 2,645ms | **3.0s** |

MILO's own API critical path is ~2.4–2.7s (the `GET /validate` call alone is
1.4–1.9s). **That is physics — you cannot return a live answer faster than
MILO answers.** Everything you optimize must come out of OUR overhead, or be
removed from the user's wait entirely (precompute).

### The constraint that defines the problem

`engine-api.js` runs every MILO call INSIDE a Playwright page:

```js
// "Call a MILO API endpoint from INSIDE the page via fetch (same-origin →
//  Cloudflare cf_clearance carries; we add the Bearer header)"
const result = await page.evaluate(... fetch(url, { credentials: "include" }))
```

**MILO sits behind Cloudflare.** The browser carries the `cf_clearance` cookie.
It is load-bearing — you cannot simply delete Playwright.

**But** `cf_clearance` is just a cookie and the accessToken is just a header.
The browser is only needed to *obtain* them. If a Node client can present both
and get through, then we harvest once, cache, and run everything browserless:
cold check → **~2.7s**, submit → one API call.

### FIRST ACTION — verify then run the probe

`services/api/scripts/probe-milo-node-direct.mjs` is written and committed. It
is **READ-ONLY**: logs in, calls `GET /account`, never touches a cart, never
submits.

Two things in it were never verified (flagged in its comments) — **confirm both
before running:**

1. The real value of `API_BASE` in `services/api/src/rpa/engine/engine-api.js`
2. `loginToMilo`'s exact options signature in `services/api/src/rpa/stages/login.js`

Then have Tony run it on the worker (stable egress IP matters — `cf_clearance`
is typically bound to IP + User-Agent):

```
fly ssh console -a liquor-kings-worker
cd /app/services/api
MILO_API_BASE=... MILO_USERNAME=... MILO_PASSWORD=... node scripts/probe-milo-node-direct.mjs
```

**Reading the verdict:**

- **200** → Node-direct works. Build the clearance/token cache; cold collapses
  to the MILO floor and submit becomes one call. Then measure clearance TTL
  (re-run phase 3 every ~15 min) — that sets the browser-refresh cadence.
- **403 / 503** → Cloudflare blocks Node. Fall back to **pre-warm**: launch and
  log in during the user's think-time (on cart open) so the check is always
  warm. Hides the 31s rather than deleting it.
- **401** → Clearance passed, auth didn't. Token handling, not a wall.

### Then

- **engine-submit go-live** — built, unit-tested (`engine-submit.unit.test.js`
  green incl. the truth-rule gate), deliberately queued for an order day with a
  real order in front of us. Replaces browser checkout with
  `POST /users/cart/checkout`.
- **Speculative pre-validate** — run the check in the background when the cart
  settles so pressing Validate reads a ready answer. The only true sub-second.
- **Micro-win** — a warm session still does `POST /auth/login` + `GET /account`
  (~180ms) despite already holding a valid token.

---

## PHASE 2 — HOW TO WORK WITH TONY

- **He does all git and all deploys.** You edit files, then hand him exact
  commands. Never run git. Never deploy.
- **His zsh:** `#` is NOT a comment (it executes and errors) and `!` inside
  double quotes triggers history expansion. Put no `#` comments on command
  lines; use **single quotes** for commit messages and avoid `!`.
- **Be concise.** He gets frustrated with long messages and buried asks. Lead
  with the answer or the single action he needs to take.
- **Measure before cutting.** Unattributed time is not permission to guess.
  Yesterday's two real bugs were both found by instrumenting first.
- **Own mistakes plainly.** Two of yesterday's findings were corrections of the
  predecessor's own wrong hypotheses. Say it, fix it, move on — no groveling.
- **Never bring him a flat "can't."** Bring the honest floor, the reason, and
  the path that still gets to the goal from another angle. That's THE STRIVE.
- **Verify before declaring.** Brace-match, scope-check, run the tests. A
  broken money path costs him real orders.

### Environment facts

- Prod Supabase project `eamoozfhqolshdztbrez`; Colony store_id
  `e594fc3a-17b7-45d0-9dde-943ebbfa5391`
- Fly apps: `liquor-kings` (API) and `liquor-kings-worker` (RPA worker)
- `LK_RPA_PERSIST_SESSION` is currently **`yes`**
- MLCC creds encrypted via `LK_CREDENTIAL_ENCRYPTION_KEY`; `samkado@gmail.com`
  is the MILO credential, NOT the app login
- `npm test` (in `services/api`) must be **590 passed / 0 failed** in ~0.8s.
  If it isn't, something you did broke it.
- DB discipline: count-only queries, 1,000-row cap, always print target host first
