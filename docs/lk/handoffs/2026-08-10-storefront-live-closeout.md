# 2026-08-10 — STOREFRONT-LIVE CLOSEOUT

## SHIPPED THIS SESSION (batch `703e43b`, deployed + Tony-verified)
- **Landing page v2 "the storefront" LIVE** on liquor-kings.fly.dev —
  Tony confirmed with screenshots: Fraunces type, barcode brand,
  family story (cousins, Clay Township + Detroit), Scan-Check-Done,
  trust rows, $149 card, sticky Start-free. One-way-mirror doctrine
  holds: zero mechanics revealed.
- **Settings › Billing panel** live (pinned copy: founding-store /
  trial / expired / past-due states; checkout button appears only
  when Stripe configured).
- **Saxon dossier + GTM plan + 8/9 closeout** in repo docs.
- **MLCC letter SENT 8/9** by Antonios — license 430342, 6525 Dyke
  Rd, Clay Township MI 48001 (township confirmed via public
  listings), (810) 671-3333. Watch the inbox; ~1 week then phone
  follow-up (800-701-0513).

## VERIFIED
Bars on Tony's Mac: API green, scanner green (189 incl. 8 billing
pins), tsc clean — the && chain proved suites green even where tail
cut counts. Start-free-while-signed-in behavior explained (session →
app; STRANGERS get the wizard — incognito test outstanding, 10s).

## BUSINESS STATE (see GTM-PLAN.md — canon)
- Pricing: $149 flat + **multi-store $99/mo each after the first**
  (staged on landing card; Tony may round to $100 — one char).
- **Published-pricing doctrine locked 8/10: hide how it works, show
  what it costs.** Whale deals: page price = floor, room in the room.
- Field updates: **minimum.** app logged (consumer price-checker,
  7-day book lag vs our day-of) · **Michigan Liquor Orderer** "huge
  update" — Tony has it installed, standing recon offer (5 shots:
  what's-new, order flow, MILO-submission touchpoint, monetization,
  About) · POS directive verbatim on #40 (NRS first).

## STAGED IN SANDBOX (unshipped — next batch, commit `7ddb0c8`+)
1. **Board #30 DONE: deploy truth-probe** — Dockerfile now bakes
   GIT_SHA env; `/health` returns `git_sha`. Post-deploy proof
   becomes ONE curl matching `git rev-parse --short HEAD`.
2. Multi-store $99 line on the landing $149 card.
3. Pricing doctrine in GTM/bible/COMPETITORS.

## NEW OPEN ITEM (Tony, at close 8/10)
**Tags.** "we didnt talk about how were able to do tags" — LK prints
shelf tags today (`/tags`), it is Saxon's ENTIRE moat, and our
storefront says nothing. Decide next session: quiet outcome line on
landing ("print your own shelf tags — any printer") vs keep as
in-trial surprise. Ties to #38 universal print doctrine (Tier 1);
Colony printer photo still the first concrete step.

## STANDING ASKS (no pressure, whenever easy)
Colony sub-user INVITE + role-options screenshot (finishes wizard
copy AND starts pilot off main login) · MLO 5 recon screenshots ·
printer photo · one word on $99 vs $100.

## NEXT SESSION MENU
Batch the truth-probe + pricing line (tiny batch, one curl proof) ·
tags-on-landing decision · MLO recon ingest · incognito signup test ·
#38 Tier-1 when photo lands · MLCC inbox watch.

## RITUAL REMINDERS (unchanged)
One-writer · sandbox commits never pushed (ignore hook) · tar
--overwrite on the mount, NEVER git via bridge (index.lock trap) ·
device VM has no network — probes from Tony's Terminal · Wednesday
freeze law.
