# Real Order Day — Pre-Flight Checklist (attempt 1 of 3)

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
> cannot show a green "ordered" on a dry-run). The gating item is operational,
> not code.

---

## STEP 0 — Run the doctor (one command, full verdict)

From `services/api/` on your Mac (it reads PROD, read-only, changes nothing):

```
node scripts/preorder-doctor.mjs
```

It prints **GO / CHECK / STOP** after checking, in one shot:
armed status, the duplicate-store situation (+ **which store_id to build on**),
MLCC credentials, price-book freshness, catalog load, and recent run health.

- **GO** → you're clear; skim section B and place the order.
- **CHECK** → read the `[WARN]` lines; fix or accept each (guide below).
- **STOP** → fix the `[STOP]` lines first (guide below). Don't order on a STOP.

The two things SQL can't see — run them too:
```
fly status -a liquor-kings-worker      # the RPA machine is started
fly status -a liquor-kings             # the API is up
```

---

## A. Fixing anything the doctor flags

**Arming** (`allow_order_submission`). Both Colony rows under `samkado` were
armed `true` on 2026-06-24, so this should read OK. To re-confirm / re-arm in
prod Supabase (project `eamoozfhqolshdztbrez`):
```sql
select id, mlcc_username, liquor_license, allow_order_submission from stores
  where mlcc_username = 'samkado';
update stores set allow_order_submission = true where mlcc_username = 'samkado';
```
> **Duplicate store:** two rows share `samkado`/license `430342`. The doctor
> tags the **PRIMARY** (the one with the run history) and prints
> `BUILD THE ORDER ON: <id>`. Build your whole cart on that one store so the
> order doesn't split. Merging/retiring the duplicate is a **post-order**
> cleanup — don't touch it today.

**MLCC login.** Doctor shows last verify status. `success` or "never verified
but real runs exist" = fine. Anything else (invalid_credentials, timeout, …):
Settings → MLCC connection → Re-verify until green.

**Price book.** If the doctor says it's stale (older than 7d) or the in-app
staleness card shows: refresh now. Confirm the daily auto-refresh is actually
live on GitHub — repo → **Actions** → **"Liquor Kings daily cron"** has recent
green runs. It only fires if (a) the workflow is **pushed to GitHub** (`fly
deploy` ships prod from your working tree, NOT git — prod can be current while
GitHub lags and the cron silently never runs; `git push` to be sure),
(b) repo secret **LK_CRON_SECRET** matches `fly secrets list -a liquor-kings`,
(c) it works on demand: Actions → Run workflow.

**Ship latest code (if you haven't).** Deploys are batched — do this once,
before ordering, not per-change:
```
cd ~/dev/liquor-kings
git add -A && git commit -m "<what changed>"
npm run deploy && npm run deploy:worker
```
(`npm run deploy` carries the long Fly timeout — the bare `fly deploy` default
times out on this image.)

---

## B. Build + place the order (on your phone, in-app)

**First, lock the codes.** Once you have the order list, resolve every code
against prod so the cart is right first try:
```
node scripts/resolve-order-codes.mjs            # uses the embedded list, or:
node scripts/resolve-order-codes.mjs "crown royal apple 1.75" "tito's handmade 1.75" ...
```
Anything it flags **needs your eye** — confirm those before you build.

**Build the cart — any of these:**
- **Templates → Load** your weekly template (fills the cart, lands on cart view).
- **Paste an order** (the AI bulk sheet) → review lines → the review/no-match
  items float to the **top** with a flag; resolve those, then Add all.
- **Ask the assistant** in chat → it resolves bottles → confirm on the in-chat
  card → Add to cart. Follow-ups work ("make that one 6").
- **Scan** bottles straight into the cart.

> Whichever you use, the rule that bit us once: **the flagged / "needs your eye"
> lines are at the TOP. Handle them — don't skip to the easy part and miss a
> bottle.**

**Then:**
1. **Leave the cart open ~30–60s while you review.** Background pre-validate is
   already running, so Validate is usually instant.
2. **Tap Validate.** Instant (cache hit) or a short latch onto the running
   check. Read in-stock vs OOS + MLCC totals.
   - **Edit any quantity → validate resets → re-tap Validate.** You can't submit
     a cart different from what MLCC checked. On purpose.
3. **Tap Submit → review the confirmation modal** line-by-line (store, license,
   every bottle + unit price, MLCC subtotal/tax/total). Can't be unsent.
4. **Read the honest result:**
   - **GREEN — "Order submitted to MILO"** + confirmation count → success. (If
     it says "check the Orders page," the numbers are there — MILO doesn't
     always show them inline.)
   - **YELLOW — "Nothing was ordered"** → not armed / gate downgraded it.
     **Order NOT placed.** Fix arming, retry.
   - **RED — error banner** → one-sentence reason + one-tap retry.
5. **Confirm for real:** check the Orders page AND log in to MILO directly to
   confirm the order + confirmation numbers exist.
6. **Log the attempt in the journal** (counts toward 3 only if GREEN + real
   confirmation #, fully in-app).

---

## C. If anything felt slow or wrong (capture it, don't shrug)

- **Pull the run's stage timings:**
  `node services/api/scripts/inspect-execution-runs.mjs`
  (or Command Deck → Review → the run). Per-stage durations + the typed failure
  tell you exactly where the time/failure went. Drill one run:
  `node services/api/scripts/inspect-execution-runs.mjs <run-id>`

- **Big-cart validate dragged?** Stage 3 per-item waits are tunable. A/B on a
  Stage 1–3 test run, prepending:
  ```
  POST_TAB_SETTLE_MS=120 INTER_BATCH_SETTLE_MS=400  <your STAGES=1,2,3 run>
  ```
  Compare the `[stage 3] OK in …ms` line. **Safety gate: `items rejected` must
  be 0.** If anything is rejected at the lower value, back off. Only then lower
  the defaults in `add-items-to-cart.js`.
