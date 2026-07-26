# Order day 2026-07-30 (Thu) — first ENGINE live fire, mandate 2/3

The 7/22 Part-2 script translated to the 2026-07-23 arming model
(`submit-arming-model.md` is the law: env = break-glass kill ONLY; the gates
are `mode==="submit"` from the deliberate flow + `stores.allow_order_submission`).
Every claim below re-verified against code 2026-07-26 (worker
`execution-worker.js` stage-5 arming at ~1151, shadow log at 1829, tripwire
helper at 721 + call site 1686).

## Preconditions — DONE and verified 2026-07-26

- Break-glass LIFTED on BOTH apps: `LK_ALLOW_ORDER_SUBMISSION` absent from
  `fly secrets list` on `liquor-kings` and `liquor-kings-worker`; machines
  cycled clean (worker 1/1, API 2/2). Absence permits — code kill is only
  the literal `"no"`.
- `LK_SUBMIT_ENGINE=api` set on worker (in today's secrets list). Browser
  Stage 5 untouched → remains the fallback.
- Colony `stores.allow_order_submission` = **false** → app is Check-only.
  Nothing can submit until Wednesday's deliberate step.
- Prod healthy at `667a11c`; bars API 694/0 · scanner 85/0.
- Check NEVER submits: `submit-guard.js` fail-closed guard + pinned test —
  independent of everything below.

## Why the shadow works under the new model

Run creation is API-side (API env: absent → permits; store flag true →
run mode `submit`; client shows Place). Stage-5 arming is WORKER-side with
the worker's OWN env: `LK_ALLOW_ORDER_SUBMISSION=no` on the worker only →
`finalMode=dry_run` → engine branch runs auth + validate + payload build,
then `submitCartViaApi` REFUSES the POST at the last gate. Client armed,
worker blocked = the 7/22 "never unsafe" state, reproduced with break-glass
semantics. Verified: the tripwire runs only when `allowOrderSubmission`
is true, and only matches FAILED runs at `rpa_checkout` — a completed
shadow can never block Thursday's real Place.

## WEDNESDAY EVENING 7/29 — prep (~3 min, order matters)

Step W1 — engage the shadow block FIRST (worker restarts, wait for the
machine-update success line):

    fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings-worker

Step W2 — arm Colony (Supabase SQL editor; verify the project ref in the
dashboard URL is eamoozfhqolshdztbrez before running):

    update stores set allow_order_submission = true where id = 'e594fc3a-17b7-45d0-9dde-943ebbfa5391';

Read-back (expect exactly one row, allow_order_submission = true):

    select id, allow_order_submission from stores where id = 'e594fc3a-17b7-45d0-9dde-943ebbfa5391';

Step W3 — reload the app: footer shows Check + Place (armed two-step).
Because W1 ran first, there is never a moment the system is fully live
before Thursday's supervised GO.

## THURSDAY 7/30 — before Colony cutoff (8pm ET — Tony confirm)

### Phase S — SHADOW (worker still blocked; never unsafe)

1. Build/adjust cart → **Check** → green.
2. **Place** → armed modal → Confirm. App may show a practice-style result
   for this one — known gates-diverged cosmetics, expected (7/22 note).
3. `fly logs -a liquor-kings-worker` must show BOTH lines:

       [worker] Stage 5 arming: requestedMode=submit, envKilled=true, storeAllowsSubmission=true, finalMode=dry_run
       [node-submit] run <id> dry-run shadow complete — validate green, payload built, POST refused by gate (correct)

4. Either line missing / any error → **STOP**. Fallback that still places
   tonight on the proven 7/16 browser path (two worker restarts):

       fly secrets set LK_SUBMIT_ENGINE=browser -a liquor-kings-worker
       fly secrets unset LK_ALLOW_ORDER_SUBMISSION -a liquor-kings-worker

   then continue from Phase GO step 6 (browser Stage 5 handles the click).

### Phase GO — LIVE (shadow green)

5. Lift the worker block; wait for the machine-update success line:

       fly secrets unset LK_ALLOW_ORDER_SUBMISSION -a liquor-kings-worker

6. **Fresh Check** → green → **Place** → "Confirm & send to MILO".
   Keep `fly logs -a liquor-kings-worker` open the whole time.
7. Expect, within seconds to ~2 min: arming line with `envKilled=false …
   finalMode=submit` → `checkout POST dispatched` → `finalized succeeded —
   confirmations: {…}`. Cross-check the MLCC confirmation email TO THE
   PENNY (`originalNetTotalAmt` is placement truth — ADA edits drift the
   bare totals).
8. If it lands `submitted_unconfirmed`: the order WAS dispatched — **never
   re-place** (truth rule). Check the MLCC email + MILO Orders page.

### After — nothing to disarm

Store flag STAYS true (Colony is a real store — that is the product now).
Env stays absent on both apps; the kill remains one command away
(`fly secrets set LK_ALLOW_ORDER_SUBMISSION=no` fleet-wide). Leave
`LK_SUBMIT_ENGINE=api`. Log mandate 2/3 + numbers in the journal closeout.
After 3 green engine orders: start the browser-pipeline retirement clock.
