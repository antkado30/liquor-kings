# 2026-08-06 Closeout — FIRST ORDER DAY (CURRENT STATE)

Supersedes `2026-08-05-armed-day-closeout.md`. Boot ritual: BOOT-PROMPT
→ THIS file → `SYSTEM-BIBLE.md` → `RULEBOOK.md` (Rule 28 governs).

## THE MILESTONE

Wed 2026-08-05 6:59pm ET: **first owner-placed live order.** 25s
submit, General Wine **#5869217** (order #277169025) + NWS
**#31086407** (order #277169053), delivery Aug 11. Tony caught an
accidental 150× "99 Party Bucket" line ($3,349.50) reading MILO's line
items and removed it via MILO "Edit order" — final **$3,378.67 net**
(GW&L $2,029.14 + NWS $1,349.53). Standing law confirmed live: orders
EVERY WEDNESDAY, cutoff 8pm ET; weekly 4pm ET trigger exists.

## WHAT ORDER NIGHT EXPOSED → STATE

1. **Confirmations never persisted** (worker log: ON CONFLICT with no
   matching constraint — code referenced an index no migration
   created). FIXED LIVE: Tony created
   `milo_order_confirmations_run_ada_key` UNIQUE (execution_run_id,
   ada_number) in prod SQL (migration file exists in repo:
   `supabase/migrations/` — ship with next batch), then ran
   `scripts/backfill-milo-order-confirmations.mjs` (env passed via
   zsh `read` prompt — the clipboard-race lesson: never make Tony edit
   a command; prompt for secrets). 2 rows persisted; Orders page now
   shows AUG 5 with both confirmations ("—" totals by design until
   re-sync). Worker path self-heals going forward.
2. Cart didn't clear after Place (clear was wired only to the drawer
   Done button) — **cart-clear-on-submitted built** in sandbox
   (useActiveOrder one-truth layer + pins), ships next batch.
3. Money rounded on Orders/dashboard ($3,753) — **PENNY DOCTRINE fix
   built** (never round money anywhere). Ships next batch.
4. Layout clipping (CONFIRMATIONS header, chips, meta dots) — **layout
   law fixes built** (segments never break mid-fact, chips fade,
   "Confirmed" label). Ships next batch.
5. Placed-order data goes stale the moment MILO edits happen; submit
   sheet lacked totals; July rows have 0 line items; dashboard says no
   history; day-grouping used UTC ("YESTERDAY" bug, #37) — all covered
   by **#36 MILO re-sync + edit-in-app** (boarded, next build) and the
   grouping fix.

## BUILT IN SANDBOX, UNSHIPPED (tomorrow's batch)

- Index migration file + service comment fix (worker deploy needed too)
- Cart-clear on submitted (client + pins)
- Penny-exact money (OrdersPage, AnalyticsDashboard)
- Layout law fixes (OrdersPage + CSS)
- `lib/add-guard.ts` decision engine, 8 pins (duplicate-add + big-line
  ≥24 units / ≥$500) — UI wiring still to do (ProductCard/BulkAdd)
- TXT-watch UPC auto-enrichment (#33: scheduler + route + 5 pins)
- Scanner suite in sandbox: 160/160, tsc clean; API scheduler file
  18/18 in sandbox. Mac bars pending at ship time.

## BOARD (open)

#8/#9 chat-restore fix + proof batch · #13 harness · #28 save-for-later
· #29 guard UI wiring · #30 GIT_SHA truth-probe · #32 Updates bell
(DESIGN LOCKED: bell top-right w/ unread badge; feed = price changes +
new bottles + sync events + order events) · #34/#35 remainder swept by
built fixes · #36 edit-in-app + re-sync (HEADLINE) · #37 timezone
grouping · Serper photos · model bump · Capacitor.

## SCHEDULED

- Thu 8/6 9am ET: post-order verification backstop (email
  originalNetTotalAmt vs MILO edited totals; resolver miss-list).
- Weekly Wednesdays 4pm ET: order-day play (permanent).

## LAWS ADDED THIS SESSION (bible §10 has them)

Accuracy doctrine (100% right or say so) · barcode/data auto-currency
· order-night build safety (sandbox only until confirmed) · Wednesday
cadence · penny doctrine · layout law · NEVER hand Tony a command he
must edit — prompt for secrets via zsh read.
