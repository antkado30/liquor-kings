# 2026-08-08 Closeout — SYNC DAY (CURRENT STATE)

Supersedes `2026-08-06-first-order-closeout.md`. Boot ritual:
BOOT-PROMPT → THIS file → `SYSTEM-BIBLE.md` → `RULEBOOK.md` (Rule 28
governs). Repo HEAD on Tony's Mac: **9f962fc** (pushed; two deploys
live off it + f701eae).

## WHAT SHIPPED LIVE TONIGHT (both apps deployed twice, ~1:00–1:25am)

Batch f701eae (46 files) + v2 9f962fc (7 files). Everything the
sandbox had staged is now IN PROD:

1. **#36 Phase A — MILO order re-sync** (bible §9 has the full spec):
   worker idle-loop reads MILO's own order history, current truth →
   `synced_*` columns, placement immutable, unknown orders imported
   (`origin='milo_sync'`). Migration 20260808010000 applied in prod
   by Tony (he first pasted into the WRONG project — it errored,
   nothing applied there — then prod: success). Proof on his phone:
   GW&L 8/5 shows MILO-current **$2,029.14**, parents' Jul-30
   hand-placed orders IMPORTED THEMSELVES (incl. Imperial Beverage, a
   distributor LK never knew), and a real ADA edit was caught that no
   human noticed: GW&L Jul-30 **$1,183.19 → $1,108.31** (green chip).
2. **Sync v2** (same night — Tony: "we have to make syncing faster"):
   tap fast-path checked every idle tick → tap-to-fresh ~5s; Orders
   auto-syncs on open when >10 min stale; $0.00-placement artifact
   reads as unknown + heals from MILO originals; date-only strings
   parse LOCAL (the AUG-4-for-an-Aug-5-order / delivery-day-early bug).
3. **#32 Updates bell** — built dark on 8/5, rode the batch: bell +
   unread badge on scanner home, /updates feed page, GET /home/updates
   (price changes, new bottles, sync events, order events).
4. Order-night fix pile: cart-clear-on-submitted, penny doctrine on
   Orders/Analytics, layout-law segments, confirmations-index
   migration file, TXT-watch UPC enrichment (#33), add-guard LIB
   (#29 UI wiring still open), store-meta/harness files.

Bars at ship: scanner **181/181** + tsc clean; API **787/787** on the
Mac (full env). Trees verified hash-identical before commit (637/637).

## FINDINGS (learned from first contact, all pinned)

- **MILO forgets owner edits.** `originalNetTotalAmt` tracks ADA edits
  only; an owner "Edit order" rewrites the baseline (why the 8/5 GW&L
  row shows no "was $5,209.14" chip — MILO now swears it was always
  $2,029.14, and our submit-night persist had bounced on the missing
  index so only the $0 backfill existed). Future orders are immune:
  worker captures placement at submit. Tony's guess was delivery
  timing — answered in chat, it's not.
- MILO order-history window ≈ ~3 weeks (Jul-15 rows came back
  unmatched — left untouched by design, placement record stands).
- `$0` placement = backfill artifact, never money (MILO minimums).
- flyctl: his ~/.fly/bin now reports v0.4.80 agent-warning during
  deploy but classic-builder deploys work fine; watch, don't touch.
- Colony's other distributor: **Imperial Beverage Company** (ADA
  ~#6398590-era conf) — beer/wine side, now visible in history.

## STRATEGY LOCKED TODAY (tap-confirmed, in bible §13 + COMPETITORS.md)

**$149/store/month flat** · **14-day free trial** (two Wednesdays of
proof) · **MLCC recognition letter: draft + send THIS WEEK** (Colony
story; sub-user path; Ohio OHLQ×Provi precedent — DRAFT IS OWED, next
session's first deliverable) · **next build: self-serve signup
machine** (store-count is the money: marketplaces/data/payments all
unlock at scale, none at one store). CoreVue war file =
`docs/lk/COMPETITORS.md` (also in Project): $249/site/mo anchor,
gas-station DNA, their strongsuits mapped to boards #38-#42. More
CoreVue screenshots may still come from Tony (20-image limit hit).
Universal print doctrine (#38): the OS print dialog IS the universal
remote; Tier 1 = any printer via print view; Colony printer photo
still wanted.

## BOARD (open, priority order)

1. **MLCC outreach letter draft** (owed, promised this week)
2. **Self-serve signup machine** (decided next build; needs design
   session: signup → MILO creds fortress → first scan same-day;
   fold in Round-2 scale questions: worker fleet math for Wednesday
   herds, billing at $149 flat, support model)
3. #36 Phase B edit-orders-in-app (re-sync foundation is live)
4. #29 add-guard UI wiring (lib shipped + pinned, half-day)
5. #38 labels Tier 1 (blocked on Colony printer photo)
6. #37 second half (true store-timezone grouping via stores.timezone)
7. #39 invoice-verify · #40 NRS/POS lane · #41 exports · #42
   quarterly competitor sweep + Saxon dossier
8. #30 GIT_SHA truth-probe endpoint (deploys already pass the arg) ·
   #9 chat restore · #28 save-for-later · #8/#19 proof batches ·
   #13 harness adoption (files shipped) · Serper photos · Capacitor
9. MLCC email glance-verification (pre-edit totals) — stale, low

## RHYTHM

Next order: **Wednesday 8/12, cutoff 8pm ET** (weekly trigger fires
4pm ET into this session; deploy freeze Wednesday afternoon until
order confirmed). Tony's 8/8: Zoom 9am → Colony till 11:30pm → shipped
all this till 1:30am. "Successful day."
