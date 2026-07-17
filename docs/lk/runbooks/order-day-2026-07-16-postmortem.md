# Postmortem — Order Day, Thursday July 16, 2026

**Outcome: SUCCESS with scars.** Colony's weekly order — $5,338.26 net, 34 SKUs,
414 bottles — was built in the scanner, checked green, and placed in-app from
the phone. Both ADAs confirmed on MILO. **Mandate: 1/3.**

- General Wine & Liquor (#221): Order **#274509587**, Confirmation **#5806580**,
  $3,752.60 net, delivery 7/21
- NWS Michigan, Inc. (#321): Order **#274509604**, Confirmation **#31002245**,
  $1,585.66 net, delivery 7/21
- $3,752.60 + $1,585.66 = **$5,338.26 — the validated net to the penny.**
  No Imperial (141) order: those lines went out-of-stock and were removed
  pre-place.

It took **four submit attempts, two live hotfixes, one deliberate mid-run
kill, and one emergency disarm.** Goal #2 (HAR capture of MILO's submit
endpoint) was **lost** to an ephemeral-disk wipe. Everything below exists so
next order day is boring.

All times UTC (ET + 4h).

---

## Timeline

| Time | Event |
|---|---|
| ~20:30 | Assistant chat kills Tony's big order paste — client 30s AbortController. **Hotfix #1:** ask 30s→90s, resolve-order 30s→60s. Deployed (API app) mid-afternoon. |
| 21:30–21:39 | Capture switch set (persist=no), three locks armed, preflight `--expect armed` = GO. |
| 21:35–21:40 | Checks (API engine, fast): oos=9 → 7 → 1 → **green** (canCheckout=true, oos=0) after OOS lines removed. |
| 21:41:27 | **Submit attempt #1.** MILO slow (products settle 93s, delivery dates never parsed). Stage 3 light-validate matched. **Died silently in stage 4.** |
| 21:51:30 | **Attempt #2 (auto-retry 1/2).** Delivery dates parsed (141: 7/23; 221 + 321: 7/21). Stage-3 cart read failed → full rebuild: 34 stale rows cleared, 34 items typed in 4 batches, one self-heal (11937), **34/34 verified 22:09:07.** **Died silently in stage 4.** |
| 22:12:50 | **Attempt #3 (auto-retry 2/2)** starts, signing in. |
| 22:16:35 | **Deliberate kill** (Tony's call: stop gambling, fix it) — worker gate dropped via `fly secrets set`, machine restart takes the run down cleanly pre-submit. |
| 22:16–22:24 | **Hotfix #2 root-caused and deployed** (see Finding 1): stage-4 budgets raised, stage-4 failures now print to fly logs. Worker redeployed, re-armed, preflight GO. |
| 22:26:16 | **Attempt #4.** MILO in a fast window (license 2s, products 6s, delivery dates 12s). Light-validate matched 22:27:03. Stage 4 passed. **Stage 5 clicked the real submit ~22:27–28. MLCC confirmation email landed.** |
| ~22:31 | Stage 5 exceeded its 240s budget settling/scraping the receipt → run finalized **FAILED**. Client showed "Order didn't go through" **on a placed $5,338 order.** |
| 22:33–22:34 | **Emergency disarm** (both gates + store flag) to strangle auto-retry → a queued retry DID fire and ran as a harmless dry_run (proof: its HAR shows login+cart only, no submit). |
| 22:34+ | MILO Orders page verified by eye: both orders confirmed. Submit-run HAR confirmed lost (ephemeral FS wiped by the disarm restart; only the dry-run HAR survived). Confirmations manually inserted into `milo_order_confirmations` (+ dedupe after an accidental double insert). Capture switch reverted (persist=yes). |

---

## Findings & fixes

### F1 — Stage 4's 45s guillotine killed two perfect runs *(fixed tonight)*
`validate-cart.js` ran a 45s total budget with 30s sub-waits, sized for API-engine
speed, not for MILO's order-night browser reality (products page settling in
90s+). Attempts #1 and #2 built the cart flawlessly and were beheaded at the
Validate step. Stage 5 already had 180s+; stage 4 never got the memo.
**Fix (deployed 22:24):** overall 45s→300s, finalize-wait 30s→90s,
click-response 30s→60s, post-validate 30s→90s. Keepalive beats every 15s, so
the reaper never confuses slow-MILO with dead.

### F2 — Stage-4 failures were invisible in fly logs *(fixed tonight)*
Both deaths wrote failure only to the DB. The log stream went silent and cost
~20 blind minutes mid-order. **Fix (deployed 22:24):** stage-4 catch now
`console.error`s run id + code + message. **Follow-up (P0-3):** same one-liner
for stages 1, 2, 3, 5.

### F3 — 🔴 P0: Stage 5 declared a PLACED order "failed" (receipt-blindness)
The submit click succeeded; MLCC emailed confirmation; the receipt
scrape/settle blew the 240s budget; the run finalized `failed`; the client
told the operator "Order didn't go through." Only the email and Tony's eyes
prevented a catastrophic misread. This same class fired 2026-05-07 (parse-too-
eager) — it is now the **#1 reliability bug in the system.**
**Fix (P0-1, the truth rule):** once stage 5 enters the submit sequence, a
timeout may NEVER finalize as `failed`. New terminal state
**`submitted_unconfirmed`** → backstop scrape of `/milo/orders` (parser already
exists: `test-orders-history-scrape.mjs`) → upgrade to `succeeded` with
confirmations, or surface "submitted — confirming" honestly to the client.
Client copy for this state: never "didn't go through."

### F4 — 🔴 P0: Auto-retry + submitted-but-unconfirmed = double-order machine
Failed submit runs self-retry (that machinery ran attempts #2 and #3). If a
retry had fired after attempt #4's false "failure," it would have rebuilt the
cart and **submitted a second $5,338 order.** The emergency disarm was the only
guard.
**Fix (P0-1b):** retries are BANNED the moment stage 5 enters the submit
sequence — a run past that line finalizes as `submitted_unconfirmed` or
`succeeded`, never re-queues. Enforced worker-side (not client, not ops
discipline).

### F5 — 🔴 P0: Run artifacts live on ephemeral disk (the HAR loss)
`rpa-output/` sits on the worker's container FS — no volume. The 22:33 disarm
restart wiped the submit run's HAR: **goal #2 (submit-endpoint capture) lost.**
"Keep track of everything" must include binary artifacts, not just DB rows.
**Fix (P0-2):** upload HAR + screenshots + trace to Supabase Storage at context
teardown (the flush moment), before `finalizeRun` — every run, success or
fail. `pull-latest-har.mjs` gains a `--run <id>` that pulls from Storage.

### F6 — Confirmation ingest is manual and fragile
Tonight's rows were hand-inserted from screenshots (and double-inserted once —
no run id, no dedupe key). **Fix (P1):** stage-5 backstop (F3) writes
confirmations with `execution_run_id` so the unique index dedupes; nightly (or
post-order) orders-history scrape backfills `line_items` and totals; the
Orders tab stops depending on a perfect stage 5.

### F7 — Operator UX lied or starved at every failure point *(TONY-WANTS 7/16 batch)*
The night's live wants, all logged in TONY-WANTS.md:
one-tap **"Remove these N out-of-stock and re-check"** on the result sheet
(#0, the big one); OOS lines shown as **names, not bare codes**; check results
**pinned at the cart bottom**, not only in a dismissable sheet; **post-validate
prices reconciled** into the cart (7-cent drift tonight); "Practice check"
copy shown on armed validate runs (stale wording); red "didn't go through"
banner on a placed order (F3's client half).

### F8 — The submit endpoint is still gettable without a HAR
The API family is mapped (`/LiquorOrderingApi/api/…` — auth/login, users/cart,
users/cart/items, inventory/check, users/cart/taxes, validate — all captured
tonight). The checkout call is sitting in MILO's Angular bundle, readable any
day without placing an order. **Fix (P2):** bundle recon pass + confirm on next
order day's durable capture. This unlocks the seconds-fast engine submit.

---

## Doctrine addition

**The email is truth.** External confirmation signals (MLCC email, MILO Orders
page) outrank internal run state. Any internal "failed" that contradicts an
external "placed" is an internal bug, and the operator-facing UI must never
present internal state as ground truth for money actions. (Candidate for
RULEBOOK / INTEGRITY-DOCTRINE.)

---

## Fix queue (priority order)

1. **P0-1 — Stage-5 truth rule:** `submitted_unconfirmed` + orders-page
   backstop + client copy. **P0-1b:** retry ban past the submit click.
2. **P0-2 — Durable artifacts:** HAR/screenshots/trace → Supabase Storage at
   flush; `pull-latest-har.mjs --run`.
3. **P0-3 — Failure lines to stdout** for stages 1/2/3/5 (4 done).
4. **P1 — Confirmation ingest:** run-id-keyed writes + orders-history
   line-items backfill (start with tonight's two rows).
5. **P1 — Result-sheet UX batch:** remove-OOS+recheck, names-not-codes,
   pinned results, price reconciliation, armed-mode copy.
6. **P2 — Submit-endpoint recon** from the Angular bundle; verify next order
   day. **P2 — Assistant batch:** multi-photo, streaming, model bump,
   resolver miss-list tuning.

## What went right

- The triple-gate + preflight discipline held through arm → kill → re-arm →
  disarm, four times, under stress, zero safety violations.
- The deliberate mid-run kill (Tony's call) beat gambling on retry #3 — the
  25-minute live hotfix loop (logs → root cause → deploy → re-arm → place) is
  a real capability now, not a theory.
- Batch typing self-healed (11937 re-typed), light-validate skipped rebuilds
  when safe, and the dry-run retry after disarm proved the gates do exactly
  what they claim.
- The two-step Check→Place flow was honest the whole way: it never unlocked
  Place on a cart MILO hadn't blessed.

**Next two Thursdays: 2/3 and 3/3, boring on purpose.**
