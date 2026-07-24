# Submit arming model — from pre-launch scaffold to real product

**Decided direction (Tony, 2026-07-23):** the env-var arming
(`LK_ALLOW_ORDER_SUBMISSION`) is pre-launch scaffolding. A published product
can't have customers flipping Fly secrets to place an order. Kill env-gating
as the *model* — but REPLACE the safety, never just remove it. The safety
moves from an env var to the deliberate UX flow, where it belongs for a real
checkout.

## The invariant that outranks everything

**A Check / preview NEVER submits.** Enforced three ways:
1. Structural — `validate_only` runs Stages 1–4 and returns before any submit
   call site (always been true).
2. Fail-closed runtime guard — `assertSubmitMachineryAllowed({ runType })`
   (`src/workers/submit-guard.js`) is called immediately before BOTH submit
   call sites in `execution-worker.js`; it throws unless `run_type ==="rpa_run"`.
   A refactor can rearrange the flow and this still holds. (2026-07-23.)
3. Test — `tests/submit-guard.unit.test.js` pins it.

This invariant is independent of the arming model below and never changes.

## Today (pre-launch scaffold)

A real submit requires the triple gate, each re-checked independently:
1. `metadata.mode === "submit"` (run-creation, `resolve-run-mode.js`)
2. env `LK_ALLOW_ORDER_SUBMISSION === "yes"` on BOTH apps (the master, laptop-only)
3. `stores.allow_order_submission === true` (per-store DB flag)

Plus the deliberate client flow already exists: fresh green check →
place-gate (cart byte-unchanged since the check) → confirmation modal
(line-by-line, "real order, can't be unsent") → explicit confirm. Plus
boundary comparison, the truth rule (`submitted_unconfirmed`), and the
30-min duplicate-submit tripwire.

The pain (Tony, Tigers game 2026-07-22): gates 2 & 3 need a laptop, so a real
order couldn't be placed from the phone → hand-placed on MILO → mandate stayed
1/3.

## Target (real product)

Remove env from the gate. The safety becomes:
1. **Per-store "real ordering enabled"** = `stores.allow_order_submission`
   reinterpreted as "this is a real store, not a demo/trial." Set ONCE per
   store (onboarding/admin), never an env var. For Colony: on.
2. **The deliberate per-order step = the flow** (unchanged, already built):
   green check → place-gate → confirmation modal → explicit confirm. This IS
   the arming, per order, the way every real checkout works.
3. **Submit button always visible** in the app; when a store isn't
   real-ordering-enabled, its confirm modal says "preview only" (honest, no
   hidden button).
4. Guard + boundary gate + truth rule + tripwire all stay.

Net: no env var, no laptop, no per-order toggle — Submit is a real button
with real steps, exactly Tony's ask.

## Sequencing (money path — prove before trust)

- **Done 2026-07-23:** the fail-closed guard + test (the invariant floor).
- **Build (careful, testable, safe to deploy):** drop env from the gate
  logic; make the client Submit always-available with the confirm steps;
  keep `stores.allow_order_submission` as the per-store real-ordering setting.
  Safe to ship because the per-store flag (false until deliberately set) still
  holds the line — nothing goes live on deploy.
- **First real submit under the new model = SUPERVISED once** (rule 5 / rule
  19 / prove-before-trust): watch the first real order place under the new
  flow, `fly logs` open, confirm the numbers vs the MLCC email. After that,
  it's just the product. No deadline pressure — next order day is a week out.

## Non-negotiables carried forward

- Check never submits (the guard).
- Never place a cart MILO hasn't blessed (green check + place-gate + boundary).
- A dispatched submit without confirmation = `submitted_unconfirmed`, never
  retried (truth rule).
- Every real submit deliberate + confirmed + audited.
