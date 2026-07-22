# Order Submission Go-Live Runbook (P2·c)

**Purpose:** deliberately arm real MLCC submission and place the first real order under supervision. This is the ONLY procedure that lets the app place a real order. Default state is DISARMED (practice-only).

## The four locks — ALL must be ON for a real order
1. Client `REAL_SUBMISSION_WIRED = true` in `apps/scanner/src/config/submission.ts` (then deployed).
2. `LK_ALLOW_ORDER_SUBMISSION=yes` on **liquor-kings** (API — flips the confirm modal/button to real-order copy).
3. `LK_ALLOW_ORDER_SUBMISSION=yes` on **liquor-kings-worker** (so the worker actually submits).
4. `stores.allow_order_submission = true` for the store (Colony = `e594fc3a-17b7-45d0-9dde-943ebbfa5391`).
Each gate is enforced independently: the API stamps `mode:"submit"` only if env(API)+store; the worker re-checks env(worker)+store; checkout.js re-checks mode+env+store.

## Pre-flight — do NOT arm until all true
- [ ] Practice flow soaked clean: several real Check Orders, result sheets accurate, no errors.
- [ ] You have a REAL order you actually want to place (arm for a real order, never a "test").
- [ ] `fly status` healthy for both liquor-kings and liquor-kings-worker.
- [ ] A second set of eyes watching (planner/auditor).

## Arm — in this order
1. Set `REAL_SUBMISSION_WIRED = true` in submission.ts → commit → `npm run deploy`.
2. `fly secrets set LK_ALLOW_ORDER_SUBMISSION=yes -a liquor-kings`
3. `fly secrets set LK_ALLOW_ORDER_SUBMISSION=yes -a liquor-kings-worker`
4. Set `stores.allow_order_submission = true` for the store (prod DB or admin).

## Verify ARMED before placing (visual)
- Reload the scanner. The confirm modal must show the ARMED copy: "This goes to MILO immediately and can't be unsent" + button "Confirm & send to MILO"; the primary button reads "Place Order".
- If it still shows "Preview only — no order will be placed" / "Run preview" → something isn't armed. STOP.

## Place ONE real order (supervised)
- Build the real cart → Place Order → confirm (armed modal) → pill shows "Placing your order" → wait for terminal.
- SUCCESS = pill "Order placed" + the run's `submit_result.submitted === true` + a confirmation number.
- Verify: Orders page shows the new confirmation; cross-check it directly on MILO.

## Immediately after
- Confirm the confirmation number matches MILO.
- Decide: leave armed, or disarm until the next order. Recommended: disarm between orders until several have placed cleanly.

## ROLLBACK / ABORT — instant, no redeploy
- `fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings-worker`
- `fly secrets set LK_ALLOW_ORDER_SUBMISSION=no -a liquor-kings`
→ back to practice-only immediately (the env gate alone forces dry-run). For a stuck run, use the "Start over" button / recover route.

## Note
Keep the API and worker env in sync. If they diverge, the button may say "Place Order" while the worker dry-runs (or vice versa) — confusing, though never unsafe.

---

## ENGINE SUBMIT (2026-07-22) — the seconds-fast path, fifth switch

Built behind `LK_SUBMIT_ENGINE` on the **worker** (default `browser` = the
proven Stage-5 browser path, unchanged). Setting it to `api` routes armed
submits through the node engine: fresh MILO validate → same gates + the
duplicate-submit tripwire → ONE `POST /users/cart/checkout` → confirmations
read from `GET /users/orders` (structured JSON, shape probed 2026-07-22) →
same `milo_order_confirmations` rows. Truth rule enforced: a dispatched POST
without captured confirmations finalizes `submitted_unconfirmed`, never
retried.

**Shadow first (any time, DISARMED):**
```
fly secrets set LK_SUBMIT_ENGINE=api -a liquor-kings-worker
```
Then run a practice Place from the app. Logs show `[node-submit] … dry-run
shadow complete — validate green, payload built, POST refused by gate
(correct)`. That is the full live path minus the POST.

**Go-live (order day):** arm the four locks per this runbook as always. With
`LK_SUBMIT_ENGINE=api` already set, the armed Place fires the engine submit —
watch `fly logs -a liquor-kings-worker` for `checkout POST dispatched` then
`finalized succeeded — confirmations: {...}`. Cross-check the numbers against
the MLCC email exactly as before.

**Rollback (instant, no deploy):**
```
fly secrets set LK_SUBMIT_ENGINE=browser -a liquor-kings-worker
```
Armed submits return to browser Stage 5. The engine also falls back to the
browser pipeline BY ITSELF (loudly) if MILO/Cloudflare blocks the node
transport at login.
