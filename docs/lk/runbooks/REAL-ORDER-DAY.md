# Real Order Day — Pre-Flight Checklist (attempt N of 3)

**Goal:** get a real weekly Colony order through LK end-to-end, **in-app**,
toward lifting the feature freeze. The freeze lifts after **3 consecutive
clean real orders** (no manual MILO fallback).

**An attempt counts as 1 of 3 ONLY IF** the order was actually submitted
(green "Order submitted to MILO" banner + a real confirmation #),
start-to-finish in the app, with no hand-entry on MILO. Log each one in the
journal.

> Verified sound 2026-06-16: template-load fires the background pre-validate,
> validate is cache-or-latch, editing the cart forces a re-validate, the
> worker refuses any requested-vs-verified mismatch before a live submit, and
> the success banner requires the worker's explicit `submitted = true` (it
> cannot show a green "ordered" on a dry-run). The gating item below is
> operational, not code.

---

## A. Before you start the order

1. **Ship the queued code.** Commit the working tree, then deploy both apps:
   ```
   cd ~/dev/liquor-kings
   git add -A && git commit -m "validate-speed trims + 06-14 sweep"
   npm run deploy && npm run deploy:worker
   ```
   This ships the 06-14 reliability sweep (`29999ae`) + the 06-16 Stage 3
   speed trims. (The trims are behavior-neutral by default, so this is safe.)

2. **★ CONFIRM COLONY IS ARMED ★** — this is what makes the attempt count.
   In **prod** Supabase Studio (project `eamoozfhqolshdztbrez`), run:
   ```sql
   select id, mlcc_username, liquor_license, allow_order_submission from stores;
   ```
   Find Colony (`mlcc_username = samkado`, license `430342`). It must show
   `allow_order_submission = true`. If it's `false`, arm it **only when you're
   ready to place a real order**:
   ```sql
   update stores set allow_order_submission = true where mlcc_username = 'samkado';
   ```
   (Unarmed → dad does the whole flow and gets an honest "Nothing was ordered"
   preview. No order placed, attempt doesn't count.)

3. **Worker healthy + gate on.**
   ```
   fly status -a liquor-kings-worker            # machines started
   fly secrets list -a liquor-kings-worker      # LK_ALLOW_ORDER_SUBMISSION present
   ```

4. **Re-verify Colony's MLCC login** so a stale password doesn't surprise you:
   Settings → MLCC connection → Re-verify. Green = good.

5. **Price book fresh + the auto-refresh cron actually running.** Stale prices =
   wrong codes (the Bushmills/code-rotation incident). Two checks:
   - In the app, the staleness card now fires (06-14 fix) — if it shows stale,
     refresh now.
   - Confirm the daily refresh is LIVE on GitHub: repo → **Actions** tab →
     **"Liquor Kings daily cron"** should show recent green runs (price-book
     check-updates, 10:00 UTC / 6am ET). **It only runs if all three are true:**
     (a) the workflow is **pushed** to GitHub — note `fly deploy` ships prod from
     your working tree, NOT via git push, so prod can be current while GitHub is
     behind and this cron silently never fires; `git push` to be sure;
     (b) repo secret **LK_CRON_SECRET** is set (Settings → Secrets and variables
     → Actions) matching `fly secrets list -a liquor-kings`;
     (c) trigger it now to verify: Actions → Liquor Kings daily cron → **Run
     workflow** (workflow_dispatch), or `POST /price-book/check-updates` with the
     cron token.

---

## B. Placing the order (on your phone, in-app)

6. **Templates → Load** your weekly template. The cart fills and you land on
   the cart view.

7. **Leave the cart open ~30–60s while you review.** The background
   pre-validate is already running — by the time you tap Validate it's usually
   instant.

8. **Tap Validate.** Expect instant (cache hit) or a short wait that latches
   onto the running check. Read the result: in-stock vs OOS + MLCC's totals.
   - If you **edit any quantity, the validate resets** — re-tap Validate. (You
     can't submit a cart different from what MLCC checked. This is on purpose.)

9. **Tap Submit → review the confirmation modal** line-by-line (store, license,
   every bottle + unit price, MLCC subtotal/tax/total). This can't be unsent.

10. **Read the honest result:**
    - 🟢 **"Order submitted to MILO"** + confirmation count → success. (If it
      says "check the Orders page," the numbers are there — MILO doesn't always
      show them inline.)
    - 🟡 **"Nothing was ordered"** → store wasn't armed (step 2) or the gate
      downgraded it. **Order was NOT placed.** Fix arming, retry.
    - 🔴 **Error banner** → states the reason in one sentence + one-tap retry.

11. **Confirm for real:** check the Orders page AND log in to MILO directly to
    confirm the order + confirmation numbers exist.

---

## C. If anything felt slow or wrong (capture it, don't shrug)

- **Pull the run's stage timings:**
  `node services/api/scripts/inspect-execution-runs.mjs`
  (or Command Deck → Review → the run). Stage 1/2/3/4/5 durations + the typed
  failure tell you exactly where the time/failure went.

- **Big-cart validate dragged?** The Stage 3 per-item waits are now tunable.
  A/B on a Stage 1–3 test run (your usual test-runner invocation), prepending:
  ```
  POST_TAB_SETTLE_MS=120 INTER_BATCH_SETTLE_MS=400  <your STAGES=1,2,3 run>
  ```
  Compare the `[stage 3] OK in …ms` line. **Safety gate: `items rejected` must
  be 0.** If anything is rejected at the lower value, it's too aggressive —
  back off. Only then lower the defaults in `add-items-to-cart.js`.
