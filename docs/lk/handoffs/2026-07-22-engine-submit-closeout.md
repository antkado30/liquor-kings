# Handoff — 2026-07-22 EOD (engine submit SHIPPED + armed-for-shadow; order day TOMORROW)

> **⚠️ SUPERSEDED 2026-07-23: the mega session shipped the AI resolver rebuild,
> the promise-and-ghost fix, and retired money-path arming to a break-glass
> kill. Current truth + next mission: `2026-07-23-mega-session-closeout.md`.
> (The 7/22 order-day script here is stale — arming model changed.)**

Paste this whole file into a new chat to pick up exactly where we left off.
Supersedes `2026-07-19-node-direct-closeout.md` (its "next mission" — engine
submit — is now BUILT and deployed). For a fresh chat, the Phase-0 reading
list in `2026-07-19-BOOT-PROMPT.md` still applies; read it first, then this.

**TOMORROW IS ORDER DAY (Thu 7/23, Colony cutoff 8pm ET) — mandate 2/3 and
the engine submit's first live fire. The complete script is PART 2. Follow
it in order; the shadow step is deliberately BEFORE the last lock.**

---

## PART 1 — CLOSEOUT: what shipped 2026-07-22

### A. MILO orders API mapped (read-only probes, real responses)

`GET /users/orders?groupid=<groupId>` → 200, array of structured orders.
**groupid param REQUIRED** (400 without). Per order: `confirmationNumber`
(string), `orderNumber` (number), `placedOn` (ISO), `licenseNumber`, ADA
structured at `distributor.referenceNumber` + `.name`, line items under
`items[].product` (code/name) + quantity/unitPrice/total, and money truth in
`originalTotal`/`originalNetTotalAmt` (AT PLACEMENT — bare `total`/
`netTotalAmt` drift when the ADA edits; `updatedByAda:true` observed on the
real 7/16 order, which matched the postmortem net TO THE PENNY via
originalNetTotalAmt). Both 7/16 confirmations (5806580 / 31002245) verified
present. Timing fact: MILO stamps `placedOn` ~40s AFTER the submit click
(7/16 evidence) — the confirmation poll schedule accounts for this.

### B. Engine submit — built, tested, deployed (commit `64e7c10`)

- `src/rpa/engine/engine-orders.js` (NEW) — fetch/normalize /users/orders
  into browser-parser-shaped historyOrders blocks; dispatch-time +
  license-filtered selection; ADA-keyed confirmation map. Fixtures in its
  test file are copies of the real probed shapes.
- `engine-api.js` — `includeRaw` option on buildAndValidateViaApi hands the
  submit branch the priced cart + deliveries (never attached by default;
  never serialized into evidence).
- `execution-worker.js` — NODE ENGINE SUBMIT branch, gated
  `LK_SUBMIT_ENGINE=api` (default browser): node auth → fresh engine
  validate (boundary gate inside) → canCheckout hard gate →
  duplicate-submit tripwire (extracted to a shared helper — browser path
  uses the same one now) → `submitCartViaApi` (triple gate in-function) →
  confirmation poll of /users/orders (~2 min budget) → same
  `persistMiloOrderConfirmations` path → finalize. TRUTH RULE at worker
  level: past dispatch, EVERYTHING resolves to succeeded or
  submitted_unconfirmed — a catch-all guarantees no post-dispatch error can
  reach the failed/retry path. Pre-dispatch refusals stay honest retryable
  failures. Login blocked_or_down → LOUD fallthrough to the untouched
  browser pipeline; invalid_credentials → fail loud, never burn a browser
  bad-password attempt.
- Tests: **632 passed / 0 failed / 57 files / ~0.8s** (was 617). New:
  engine-orders suite incl. an end-to-end test feeding normalized API
  orders through the REAL persist-service row builder. **632/0 is the bar.**

### C. Live state as of tonight (verify, don't recall)

- Worker deployed at `64e7c10`, release confirmed in boot log.
- `LK_SUBMIT_ENGINE=api` **SET on liquor-kings-worker** (tomorrow's armed
  Place goes engine; kill switch = set it to `browser`).
- `LK_MILO_TRANSPORT` unset → default `node`. `LK_RPA_PERSIST_SESSION=yes`
  (only matters to browser fallback).
- `LK_ALLOW_ORDER_SUBMISSION` = OFF on BOTH apps; `stores.allow_order_submission`
  = false (fully disarmed). Client `REAL_SUBMISSION_WIRED = true` (verified
  in source — no client deploy needed tomorrow).
- Device proof today: cold check **3.1s** and 6.2s (MILO variance; our
  overhead 386ms) on the REAL order-day cart — 18 codes, 453 bottles, all
  in stock, **net $5,490.09**, green. Token cache proven (`fromCache=true`).
- UI fact (postmortem F7#5, rediscovered): DISARMED client has NO
  Place/Submit button — Check Order only. A submit-branch shadow therefore
  requires partial arming, which is why the shadow is woven into tomorrow's
  arming sequence instead of run tonight.

---

## PART 2 — ORDER DAY SCRIPT (Thu 7/23) — follow in order

**Prep (whenever):** adjust cart if needed → Check Order → green.

**Arm phase A (client armed; worker kill-switch still OFF):**
1. `fly secrets set LK_ALLOW_ORDER_SUBMISSION=yes -a liquor-kings`
2. Supabase SQL editor (prod `eamoozfhqolshdztbrez`):
   `update stores set allow_order_submission = true where id = 'e594fc3a-17b7-45d0-9dde-943ebbfa5391';`
3. Reload app → footer shows Check + Place (armed two-step).

**SHADOW (worker env still off → nothing can place; runbook calls this
state "never unsafe" — worker env + submitCartViaApi both refuse):**
4. Check → green → Place → armed modal → Confirm. Run dry-runs through the
   engine branch. (App may show a practice-style result for this one —
   known gates-diverged cosmetics, expected.)
5. `fly logs -a liquor-kings-worker` must show:
   `[node-submit] run … dry-run shadow complete — validate green, payload built, POST refused by gate (correct)`
   Missing/errored → STOP. Fallback that still places tonight's order: 
   `fly secrets set LK_SUBMIT_ENGINE=browser -a liquor-kings-worker`, then
   continue this script from step 6 (proven 7/16 browser Stage 5).

**GO LIVE (shadow green):**
6. `fly secrets set LK_ALLOW_ORDER_SUBMISSION=yes -a liquor-kings-worker`
7. Optional GO ritual: order-day preflight `--expect armed`.
8. App: Check → green → Place → "Confirm & send to MILO".
9. Logs: `checkout POST dispatched` → `finalized succeeded — confirmations: {…}`
   — expect SECONDS. Cross-check numbers vs the MLCC email.
   If it lands `submitted_unconfirmed`: the order was DISPATCHED — do NOT
   re-place. Check MLCC email + MILO Orders page; the truth rule held.
10. **After:** disarm — worker env `no`, API env `no`, store flag `false`.
    Leave `LK_SUBMIT_ENGINE=api` set (it's inert while disarmed).

---

## PART 3 — RULES THAT CARRY OVER

- One-writer (RULEBOOK #11): Tony runs ALL git/deploys/deletions. Sandbox
  git reads use `--no-optional-locks`.
- Tony's zsh: no `#` on command lines; single quotes for commit messages;
  avoid `!`.
- Truth rule: dispatched submit without captured confirmation =
  `submitted_unconfirmed`, terminal, never auto-retried.
- Triple gate: `mode==="submit"` AND worker `LK_ALLOW_ORDER_SUBMISSION==="yes"`
  AND `stores.allow_order_submission===true`.
- DB discipline: count-only, 1,000-row cap, print target host first. Prod
  `eamoozfhqolshdztbrez`; Colony `e594fc3a-17b7-45d0-9dde-943ebbfa5391`.
- Credentials encrypted (`LK_CREDENTIAL_ENCRYPTION_KEY`); `samkado@gmail.com`
  is the MILO credential, NOT the app login.
- **Tests: 632/0 in ~0.8s.** Measure before cutting. Prove before trust.
  THE STRIVE stands.

## After Thursday (queued)

Speculative pre-validate on cart-settle (the true sub-second check);
cart_reset_only via node transport (trivial now); decide the browser
pipeline's retirement timeline after 3 green orders; client polling shave if
perceived lag persists; backlog unchanged (rpa_run_summary contract test,
"Ordered before" in typed search, Royal Canadian photos, KMS S4, autoscale S1).
