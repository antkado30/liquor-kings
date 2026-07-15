# Liquor Kings — Build Journal

Founder's log. Milestone entries — the moments that mattered.

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
