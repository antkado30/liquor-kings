# Liquor Kings — Build Journal

Founder's log. Milestone entries — the moments that mattered.

---

## Entry #13 — The robot reads MILO back (2026-08-07 → 08)

Friday was strategy: a competitor surfaced — CoreVue, $249/site/month,
polished, Azure-hosted, "built for convenience stores and gas
stations" by their own FAQ, fuel tanks as a flagship. Twenty
screenshots became a permanent war file, and the doctrine got a name:
ALWAYS-BETTER — strong where they're weak, beat every strongsuit.
Tony's universal-printer question got its answer the same hour: the
universal remote already exists, it's the print button — every printer
on earth registers with the phone's print system, and CoreVue's
"Zebra printer compatibility" is a compatibility list we don't need.
Then four taps locked the business: $149/store/month flat, 14-day
trial, MLCC recognition letter this week, self-serve signup machine
next.

Then Tony said "batch me" and the night went vertical. #36 Phase A —
order re-sync — built 10pm to 1am: the worker's idle loop logs into
MILO, reads the account's own order history, and pulls current truth
into synced_* columns while placement stays immutable. 41 files
shipped tree-identical (637/637 hashes matched both sides), bars
181/787, two deploys by 1:00am. The first sync did something nobody
scripted: his parents' hand-placed Jul 30 orders imported themselves —
including Imperial Beverage Company, a distributor LK had never met —
and the robot caught a real ADA edit ($1,183.19 → $1,108.31) that no
human had noticed. The app got a bell that night too: the Updates tab,
built dark on 8/5, rode the batch out.

First contact broke three small things, all fixed and redeployed
within the hour: Sync taps took a minute (worker now checks every
2.5s — tap-to-fresh ~5s, and Orders auto-syncs on open), the $0.00
backfill artifact put a false "Edited" chip on an untouched order
(zero placement now reads as unknown and heals from MILO's originals),
and date-only strings parsed as UTC shifted every calendar date a day
early (AUG 4 for an Aug 5 order; fixed, and the parents' group
snapped to its true JUL 30). One finding to remember: MILO's
originalNetTotalAmt only remembers ADA edits — an owner's "Edit
order" rewrites the baseline. MILO forgets. LK captures placement at
submit, so LK remembers.

Tony's day: Zoom at 9am, Colony till 11:30pm, shipping code till
1:30am. His words: "successful day."

## Entry #12 — FIRST ORDER DAY (2026-08-05, a Wednesday)

At 6:59 pm on the first Wednesday of the standing law — orders every
Wednesday, cutoff 8, decided with his mom because he's off Thursdays —
Tony tapped Place Order on a cart he built himself, and 25 seconds
later the system he owns had placed a real order with the State of
Michigan: General Wine & Liquor #5869217, NWS Michigan #31086407,
everything in stock, an hour ahead of cutoff. The push notification,
the green sheet, the confirmation numbers — all of it exactly as
designed. The company became real tonight.

Then order night taught like only production teaches. Reading MILO's
line items, Tony spotted 150 units of a $22 party bucket — $3,349.50
he never meant to order — and killed it through MILO's own Edit
feature inside ten minutes; the order settled at $3,378.67 across
both distributors. (The add-guard that makes that mistake impossible
was designed the day before and pinned in tests within the hour.)
Then the app's Orders page didn't show the new order at all — one log
line found the culprit in a minute: the confirmation-save code
depended on a database uniqueness rule that no migration had ever
created. Every save since had bounced politely. Tony pasted one index,
ran one backfill script from his kitchen table — terminal prompting
him for the secret key like a bank teller — and by 8:53 pm his first
order sat in his own app, confirmations and all.

The scoreboard for the day: a standing weekly cadence, an owner with
his own keys, a real order placed and surgically corrected, a
schema-drift class of bug found and fenced, and a fix-list — penny-
exact money, edit-in-app, MILO re-sync, the big-line tripwire —
already built or boarded before midnight. The system buys the liquor
now. Next Wednesday it does it again, better.

---

## Entry #11 — Armed day, and the phantom deploy (2026-08-04 → 05)

Tonight Tony asked for his own keys — "i dont want it to be locked
anymore so i have to ask u to unlock it" — and got them. Worker
break-glass to yes, Colony's allow_order_submission flipped true in
prod SQL with his own hands, and by the end of the night his phone
showed what no screenshot of this app has ever shown: **Check with
MLCC and Place Order, side by side.** The Place button he'd never
seen, locked politely behind a fresh green Check, in a store he can
now fire real money from any time he chooses. No ceremony left, no
unlock requests, no one to ask. Two days before the first engine
order, the operator owns the trigger.

The same day shipped the biggest single-day feature haul yet: price
memory (a migration he applied himself — "was $11.49" chips that light
up when a price book moves a bottle), Remove buttons on every
out-of-stock line of the result sheet plus remove-all, the cart
footer's broken seam and hollow gap fixed, the armed-status fetch
hardened to retry instead of hiding Place over one bad network moment,
and — his "always up to date in ALL aspects" mandate — the daily price
sync now swallows MLCC's between-book files too: retail price changes,
ADA changes, new-item lists, the day they publish.

And then the deploy war, which deserves its lesson written large. The
fly CLI's self-updater ate its own binary mid-command; the reinstalled
version had a broken classic-builder and an agent version fight; and in
the middle of it, a verification probe aimed at the marketing landing
page instead of /scanner/ produced an hour-long hunt for stale deploys
that were probably never stale. Five deploys, three build paths, one
pinned CLI at ~/.fly/bin later, the truth came from building the app
locally and comparing ground truth: the probe was blind, not the
build. The permanent fix is boarded — the app will carry its own
GIT_SHA stamp and a verify script, so "is prod really running my
code" is a command, not a debate. Tools lie, hashes don't.

Tomorrow the freeze. Thursday the order. The system going into it is
armed by its owner, priced to the day, honest about what's out of
stock, and — after tonight — verified by evidence instead of trust.

---

## Entry #10 — The watchdog and the wedge (2026-07-27 → 28)

Two days before the first engine order, the system failed in the exact
way that would have ruined Thursday — and that's the best thing that
could have happened, because it failed on a Tuesday practice cart
instead. Tony tapped his brand-new live pill (the 7/5 want, finished
that morning: tap mid-run, see the full stage checklist and the honest
elapsed clock) and the new panel told a terrible truth beautifully:
2:21 elapsed, zero stages, "MILO is slow today." MILO wasn't slow. The
worker daemon had been silently wedged for TWELVE HOURS — no claims, no
errors, no logs — a hang class the old Stage-1 dead-man could never
see, because it only counts runs that fail, not runs that never return.
Even `fly machine restart` bounced off it: the graceful shutdown
handler was politely waiting for a hung run to finish. It never would.

The fix is the dead-man's lesson generalized: a process can't always
heal itself, but it can refuse to keep lying. The worker now carries a
loop watchdog — twenty minutes without a completed iteration and it
declares itself wedged, exits, and Fly restarts it from a clean slate.
Deployed, the next practice check ran end to end in 5.5 seconds: claim
in under three, node engine through MILO, green sheet, real totals.
The same day also shipped the assistant's readable progress (labels
hold long enough to actually read — "it said reading your photo then
something else i couldnt catch it" is dead), streaming on every ask,
and the Settings "Saved matches" door: THE MOAT's memory, visible and
deletable by the operator it belongs to. Tomorrow the freeze. Thursday
the first engine order. The system that goes into it now restarts
itself when it's stuck and shows its work while it runs.

---

## Entry #9 — The scanner war, won by arithmetic (2026-07-26 → 27)

Tony walked the floor with ten bottles and five of them would not scan —
"like we weren't scanning at all." No guessing this time; the measured
method from the 42px hunt got its own decode harness: Playwright driving
the exact @zxing pipeline the app ships, against synthetically degraded
UPC barcodes — 145 measured rows. The verdict was arithmetic, not vibes.
At 720p capture, a small bottle barcode only carries enough pixels to
decode when the phone is closer than the iPhone lens can focus. Enough
pixels → no focus; focus → not enough pixels. Those five bottles were
MATHEMATICALLY unscannable — no amount of holding them up could ever
work, which is exactly what Tony reported. And a second bug hid under
it: every failed decode burned 586–944ms of synchronous main-thread
work, fired every 220ms with no guard — the frozen preview and the hot
phone were a runaway decode pile-up.

Phase 1 shipped the measured fix: 4K capture (the same 22mm barcode
reads out to 30cm now), a guarded fast-tick loop that catches the SAME
barcodes in every measured scenario at 1/20th–1/45th the miss cost, a
green flash the instant a barcode decodes, and the granted resolution
printed under the camera so the phone itself proves the fix. Phase 2
killed the vision picker's private brain — the thing that read a plain
Smirnoff correctly and recommended SOURS GREEN APPLE anyway. Photos now
rank through the SAME resolver as the AI chat and paste-order, flavor
penalty and all; Tony's screenshot is pinned as a permanent test.

Tony took the same bottles back to the shelves: "everything looks good."
The night closed with the last app-feel want — the Cart tab is a real
page now. Not a rewrite: the 2.5k-line Check/Place drawer learned a
page mode, chrome only, money machine byte-identical, layout proven by
a harness before it shipped. Three days to the first engine live fire,
and the front door finally feels like the product Tony is selling.

---

## Entry #8 — The AI narrates its work + Tony rewired how we work (2026-07-26)

The day started with the gate and ended with a new constitution. Morning:
the break-glass kill came off BOTH apps — verified in code first (only the
literal "no" kills), verified gone after — leaving Colony's store flag as
the single closed gate before Thursday's first engine live fire (mandate
2/3). The whole order-day script got rewritten for the new arming model as
a runbook Tony will never have to read: the shadow trick survives
(worker-only block = armed client, refusing worker, never unsafe), and the
duplicate tripwire was proven unable to false-trip on it.

Night: the dead 60-second "Thinking" got replaced by an AI that narrates
its own work — "Reading your photo… Matching 87 lines to MLCC bottles… 40
of 87 done…" — streamed live, heartbeat killing the platform-timeout class
that used to eat monster asks, fail-soft by law so progress can never
break an answer. Tony watched it talk on his phone: proven. Chat
persistence proven on device the same minute.

Then the most important thing shipped all day, and it wasn't code. Tony
was honest: walls of text don't stay in his head — "that's just how I'm
programmed." Interrogated, answered, locked as RULEBOOK #28: Fable is the
brain, Tony is the hands. One thing per message. The task board is the
anti-loss machine — every want gets a card + receipt the second it's said.
Ships are proven by DOING, not by paragraphs. The first message under the
new law was four commands; it deployed clean.

Honest ledger: two jank fixes (iOS input-zoom class, chat restore
position) shipped at 74a1759 and FAILED device proof minutes later — both
stay open, stale-PWA-bundle the prime suspect, Monday's first dig. New
from the floor at 1:52am: bottom-bar taps fighting the iPhone home-bar
gesture, and Cart must become a full page. All captured, nothing lost —
that's the whole point of #28.

API 708/0 · scanner 91/0. Thursday: the first engine order. All glory to
God — the constant holds the standard.

---

## Entry #7 — The store you TEACH by talking (2026-07-25 evening)

Tony stood on the floor at Colony and taught his store its own language —
by talking to it. "Remember that my usual limoncello is the Lucina" → saved
in one sentence. Next ask → ★ REMEMBERED, "that's your usual." "What have
you learned about my store?" → it listed its own memories and named the one
that had just fired. It caught an ambiguous teach and asked the right
question back. "Forget the limoncello thing" → gone, honest contested card
returned, and it OFFERED to learn again. Teach → fire → audit → forget →
offer: the whole lifecycle, live in production, five for five.

Same night: the chat stopped forgetting itself — conversations now persist
across tab switches and restarts, with Claude-style history (reopen, delete,
new chat), built simple like Tony asked. And his sharpest business question
yet — "are we actually making money if stores hammer this AI?" — got
answered with engineering, not a shrug: prompt caching on the static prefix
cut the biggest input cost ~90% on every hot call. The AI now gets CHEAPER
the harder a store uses it.

API 694/0, scanner 85/0. Thursday: the first real order. All glory to God —
the moat learned to listen.

---

## Entry #6 — MOAT DAY (2026-07-24→25)

The day the app started LEARNING. Morning: the resolve card became a receipt
— every matched bottle's name, size, price, code visible at a glance (the
dropdown-tapping misery, dead). Afternoon: Tony asked THE question — "does
this work for all 14,000 bottles or just mainstream ones?" — and got a
measured answer: a seeded catalog-wide stress harness, two calibration
rounds, and a final board reading HIGH-WRONG 0.0% in every phrasing class.
A wrong bottle can no longer wear a green badge anywhere in the catalog.
Night: THE MOAT went live — store_resolver_memory. Tony swapped Lim→Lucina
limoncello once; the very next ask came back "LUCINA · ★ REMEMBERED — that's
your usual." Colony's brain formed its first memory in production. Then the
size-flip chip (every size the family carries, one tap), and at 1am a full
catalog-integrity audit: 13 split families found (MLCC's own punctuation),
canonicalization built + pinned, 2,611-row backfill applied and verified —
final board all zeros, zero false merges, every bottle provably coded to one
law. API 680/0, scanner 79/0. "We are not banking tn im feeling a late night
baby" — and the late night delivered the whole moat.

---

## Entry #5 — The mega session (2026-07-23)

One night, an absurd amount of ground. Cold check landed at the MILO floor
(~3s, browserless — node-direct proven the week prior). Engine submit built
and shadow-ready. The AI assistant, which had been LYING ("I'll add all these
— give me a second!" then doing nothing), got its promise-and-ghost bug killed
and its resolver rebuilt from ~half-wrong to ~35/37 correct on Tony's real
weekly order — three evidence-driven surgery rounds, every fix pinned. Then the
money path itself modernized: env-var arming retired to a break-glass kill
(Submit is now a real button with deliberate steps, phone-armable, no laptop),
and a fail-closed guard made "a check never submits" a hard law. RINSE + no-drift
became permanent rules; Obsidian stood up as the knowledge base. 661 tests, 0
failed. Full detail: `handoffs/2026-07-23-mega-session-closeout.md`. Tony:
"amazing day." It was.

---

## Entry #4 — The catalog got honest (the 48-hour truth pass)

**July 12–14, 2026 — EOD closeout, written by Fable**

Sunday night the premium catalog shipped — family-first scrolling, stacked
cards, the redesign Tony drew with Fable over mockups. Then Tony walked
Tito's on his phone and found the truth gap: "ad-tile" photos sailing
through the strict gate (it policed scenes, never marketing graphics) and
pack variants rendering as three identical "50 ML · Glass" clone chips
that read as corruption. Both were fixed at the CLASS level, and the
48 hours that followed made the catalog honest end to end.

**Shipped, deployed, device-proven ("everything looks amazing" — Tony):**
- Photo truth: gate rejects ad creatives; a new `--regate` retro-pass
  re-judged every written photo (cleared 1,041 = 15.4%, dead on the
  dry-run projection); 4 shards rebuilt coverage through the tightened
  gate. Standing: **10,682 of 14,123 photographed (76%)**, 2,624 honest
  placeholders, 812 retryable flakes.
- Pack truth everywhere: "50 mL · Glass · 12-pack" rides chip → cart →
  confirm modal → AI verify card → UPC/vision pickers → search rows.
  The AI card had been silently stripping pack/container off cart lines.
- Tony's chip order: singles small→large, biggest far right, ALL packs
  grouped at the tail (6 unit pins on the real Tito's lineup).
- **295 new SKUs** from MLCC's July 5 New Item Price List, live in
  search/browse/AI weeks before competitors see them (Option A built +
  applied same night; cron wiring deferred past 7/16 by deal).

**Laws learned the cheap way:**
- *An error is never a verdict; uncertainty never deletes.* Dead API
  credits printed as "WOULD CLEAR" in a dry-run — one flag away from
  wiping photos on errors. Both modes now hard-stop on credit death.
- *A new data kind must be checked against every consumer of the old
  invariant.* The new-item ingest moved the freshness baseline and turned
  the whole catalog red "likely discontinued" — Tony's eyes caught it in
  one walkthrough; baseline now = latest FULL book run.

**Found + FIXED same night:** browse_families timed out even on a quiet
DB — the Catalog tab had been silently on its flat fallback since Sunday
(the function's output was CORRECT; it built cards for all 9,800 families
per page request). Page-scoped rewrite: **timeout → 625ms**, applied
straight to prod via SQL editor — no deploy needed, the app had been
ready since Sunday. *Device proof of family cards on the Catalog tab is
the ONE open box — first glance tomorrow.*

**The late-night recall fix (Tony: "no way there's not one clean photo"):**
he was right — the matcher spoke wholesale and the internet speaks retail.
Searching raw MLCC strings ("ARROW PPRMNT SCHNAPPS PL") found nothing AND
the variant guard REJECTED pages saying "Peppermint" as a wrong flavor.
Fix: curated name expansion feeds the query + every text gate (vision
keeps the raw name), candidate walk 4 → 8. Result: +664 photos in one
pass, noMatch floor 2,630 → 1,953. **Final standing: 11,994 of 14,123
photographed (85%)** — the remaining ~1,950 are genuine in-store-snap /
curation territory, the moat path.

**Also this night:** order-day preflight cross-checked against current
code (clean — nothing drifted); Sentry swept (Tony's org, ZERO unresolved
issues across a 3-deploy week; noted gap: handled 5xxs are invisible —
the dark-fallback week never appeared); NEXT-CHAT-PROMPT bootstrap
rewritten for the current stack; STATE's PATH reconciled (Phases 0 + 2
complete).

**Board:** git `5822ad1` · gates + Colony flag OFF at rest · prod healthy ·
THU 7/16 = order day (runbook verified, two-button flow's first armed use).
Wednesday is deliberately quiet by Tony's own sequencing — polish waits
for the other side of Thursday.

All glory to God — two days of finding out the product we said we had, we
now actually have.

---

## Entry #1 — First customer order placed by the RPA

**May 7, 2026 — ~5:57 PM Michigan time**

🥃 First customer order placed by Liquor Kings RPA: ✅ May 7, 2026, ~5:57 PM Michigan time, by Tony Kado, age 19, on his MacBook inside of colony party store. this is a moment worthy of the books first of many all thanks and glory to Jesus Christ the man himself.

---

## Entry #2 — Catalog UPC foundation shipped

**May 13, 2026 — 4:11 PM**

Catalog UPC foundation shipped. Found MLCC publishes UPCs free in the TXT version of their price book — two weeks of distributor calls were chasing data already on michigan.gov. Built the ingest pipeline this afternoon. 0% → 97% catalog UPC coverage on local + prod. 13,409 SKUs mapped. Every future Liquor Kings store now gets instant-scan coverage day one without scanning a single bottle. Commit 307e0a6. All glory to Jesus Christ none of this would be possible without him.

---

## Entry #3 — Liquor Kings got its brain

**May 20, 2026**

Today Liquor Kings got its brain.

Built the AI assistant from nothing to live in production in one day. A store owner can now ask it anything — a bottle's code, what an order will cost, why a cart won't validate, what they ordered last week — and it answers from real data in seconds. Locked it down so a competitor who signs up can't extract how the system works or see another store's data. This is the moat. The competitive research turned up nobody else in Michigan with anything like it.

Also locked down the ordering robot. The RPA that places orders at MLCC went from "works most of the time" to genuinely reliable — it checks its own work, heals its own stale state, and when MLCC blocks something it says exactly why. Got it all the way to checkout-ready against real MILO, repeatedly.

Built the catalog to update itself — when MLCC publishes new prices, Liquor Kings catches it and re-ingests on its own. The thing I said I wanted on day one.

Found out who we're really up against (Saxon — one real competitor), locked down what V1 is, proved the wedge is real and unfilled.

More than a dozen commits. The biggest build day this project has had. A week ago the MLCC rules were a screenshot I was squinting at on my phone. Tonight they're a database the AI reasons over.

Thursday: the first real order through the whole system.

---
