# Handoff — 2026-07-24→25 EOD (MOAT DAY: the store that learns, proven at catalog scale)

Paste this whole file into a new chat to pick up exactly where we left off.
Supersedes `2026-07-23-mega-session-closeout.md`. Fresh chat: read the
Phase-0 list in `2026-07-19-BOOT-PROMPT.md`, then this, then [[START-HERE]].

**Tests: 680 API / 79 scanner, 0 failed. Prod healthy at `415c0ae`.**
Everything below is committed + deployed + (where marked) DB-applied.

---

## What shipped (in order)

### 1. Glanceable resolve card (`6606d2a`)
Matched bottle is the headline — name, size · price · code visible AT REST,
"You said:" receipt, loud size-mismatch flag, "x case" prefills real case
qty (was DROPPED — showed 1). Swap = opt-in chip (invisible native select
overlay). Tony's live retest: whole 3-photo order read like a receipt.

### 2. The 14,000-bottle question → answered with numbers (`f0d3eed`, `2468dba`)
`scripts/stress-catalog-2026-07-24.mjs`: N random SKUs × 4 phrasings
(full/short/typo/nosize), seeded, scored vs ground truth. Round 1 exposed:
(a) old confidence rule let wrong-brand fallbacks wear HIGH; (b) perfect
matches wore amber (alarm fatigue). Fix: EVIDENCE-BASED CONFIDENCE
(`termCoverage` + margin ladder) + round 2: brand-initial only counts as the
name's FIRST token ("C&D"/"D'" tails were faking coverage). Harness gained
brand-fair bucket (flagship-law picks aren't "wrong").
**FINAL BOARD (docs/lk/stress-catalog-2026-07-24.md): HIGH-WRONG 0.0% in
every phrasing class; 98.2% of resolves are correct behavior; med-wrong
15.6%→1.8% (intra-brand, truth in top-5, honest amber).**

### 3. THE MOAT Phase A — store memory, LIVE (`e553815` + migration 20260725010000 APPLIED)
Tony's design (RINSE'd): every swap teaches silently; remembered phrases pin
green "★ REMEMBERED". Table `store_resolver_memory` (RLS, provenance,
usage counters) · `lib/store-memory.js` (key symmetry pinned:
learn key ≡ lookup key, apostrophe-proof) · resolve_bottles pre-checks
memory, pins hits conf-high with memory_note · POST /assistant/memory ·
card learn-on-swap (default add teaches NOTHING — no false learnings).
**PROVEN LIVE: Tony swapped Lim→Lucina limoncello once; next ask pinned
LUCINA · ★ REMEMBERED and the model said "that's your usual."**
Colony's first memory row exists in prod.

### 4. Added-to-cart receipt (`f3117fd`)
Done-state lists qty × name · size per added line (was a bare count —
"the actual bottle disappeared").

### 5. Size flip on the card (`bf096a1`)
Server ships every size the matched family carries (one batched family_key
query, combos excluded, prices+codes). Card: "Switch size (N carried)" chip
— native picker, truth line updates live. Guard: a size flip NEVER teaches
the phrase memory (spoken size wins). Bonus honesty: container/pack markers
now reach the card (labels can say "200 ML PL").

### 6. Family integrity: 100% board (`415c0ae` + backfill APPLIED)
Tony's ask: "100% of bottles coded with correct siblings + are we following
our own DB rules." Self-audit: one-writer clean, read-only clean, 1k-cap
rule amended (RULEBOOK §1.6). Audit script found: 0 null/stale/drift, but
13 SPLIT families — all MLCC's own punctuation (apostrophes, periods,
hyphens, "X O", "(P R)"). Fix: `canonicalizeFamilyKey()` (decimal-guarded,
first-token-safe; family suite 16→21 pins). Backfill: dry-run 2,611 rows
(NOT ~30 — canonicalization reformats every punctuated key; families move
as units) → --apply 2,611/2,611 → --verify PASS → re-audit:
**NULL 0 · STALE 0 · SPLIT 0 · merge-smell unchanged at 16 known relists
(zero false merges) · chip reach 41.33%→41.47%.**
Evidence: docs/lk/family-sibling-audit-2026-07-25.md.

### 7. RULEBOOK updates (this closeout)
§1.5 rewritten to the CURRENT arming model (env = break-glass kill;
was stale, still described the retired required-arm). §1.6 added: DB access
discipline (ad-hoc count-only/≤1k; dated read-only audit scripts may page
the catalog; writes = script/migration + dry-run + Tony + verify).

---

## ADDENDUM — 2026-07-25 afternoon: the connoisseur round (`65b6e8c` + no-size polish)

Tony stress-tested the AI as a store owner ("top tier whiskeys… add one of
each") and it failed loudly-but-honestly: Blanton's → CRUZAN rum, Four Roses
LE → BACARDI TROPICAL, Michter's/WhistlePig 10 → non-10 bottles, counts in
prose contradicting the card. Four root causes found + fixed same session:
1. **Brand outranks descriptors** — LEAD_MISSING_PENALTY 150 (was 60 like
   any word); descriptor-laden wrong brands can't headline.
2. **Ages scored** — pure-number terms ("10","17","18") present-checked on
   word boundaries ("10" never hides in "100").
3. **MLCC abbreviations decoded** — consonant-skeleton equality (single→SNGL,
   barrel→BRRL, year→YR) in the SHARED termPresentIn (scoring+coverage now
   literally one function — mirror law enforced by construction).
4. **Absent brands say so** — `leadMissing` → tool `brand_absent` + card's
   loud "⚠ Likely NOT in the current MLCC book… don't add it blind" + prompt
   law names them plainly. Count narration BANNED (the card is count truth).

**Rematch verdict (live, phone):** Blanton's $71.24 ✓, Eagle Rare 17 ✓,
WhistlePig Old World 12 ✓, Midwinter Night's Dram ✓, Sagamore ✓; Four Roses
LE + Michter's Toasted wore the amber not-in-book warning; reply named them,
zero counts. Stress same-seed after: HIGH-WRONG 0.0% held, typo right
57→67%, total right 65→68.2%.

**No-size confidence polish (this addendum's code):** no-size lines
defaulted review even when the phrase names ONE bottle. New: no size +
brand present + all words covered + ≥2 eligible terms + product exists at
exactly one size + clear margin → high; all-covered multi-size → medium
(Switch-size chip is the next tap); single-word phrases capped medium;
absent-brand/partial unchanged. 5 pins.

Known catalog oddity (not ours): "MYERS'S GEORGE T. STAGG" #34470 appears to
be MLCC's real listing name (stable across runs) — probe if curious.

## NOT proven yet (no code — just eyes)
1. **Size-flip phone test**: "Add limoncello fifth" → ★ remembered Lucina →
   "Switch size" chip → flip → truth line updates → Add → receipt shows the
   flipped size → re-ask: memory STILL says the 750 (flip didn't corrupt it).
2. Memory table check anytime: `select phrase, size_ml, mlcc_code, source,
   times_used from store_resolver_memory;` (times_used ticks on each pin).

## NEXT MISSION (fresh session)
- **Thursday ~7/30 = go-live day, mandate 2/3**: set Colony
  `stores.allow_order_submission=true` (SQL, one-time "real store" flip) →
  Place appears with confirm flow → FIRST real order watched (fly logs +
  MLCC email cross-check) → engine submit (`LK_SUBMIT_ENGINE=api` already
  set) rides the same order after its shadow (2026-07-22 closeout Part 2
  script structure, minus the retired env-arming steps — arming model doc
  is the truth now).
- **Moat Phase B**: chat teaching ("remember we call X Y" tool), memory
  management UI in Settings (list/delete learnings), seed from order history.
- Queued: streaming replies (kills the ~60s wait-feel); model bump eval;
  always-show Submit as preview for un-enabled stores; phone toggle for the
  store flag.
- Backlog unchanged: speculative pre-validate; cart_reset via node; browser
  pipeline retirement after 3 green orders; rpa_run_summary contract test;
  "Ordered before" typed-search filter; Royal Canadian photos; KMS (S4);
  autoscale (S1).

## RULES THAT CARRY OVER
One-writer (Tony runs git/deploys/SQL; sandbox git reads use
`--no-optional-locks`; zsh: no `#`, single-quote commit msgs, no `!`).
Money path: read code, never recall; check never submits (guard); truth
rule submitted_unconfirmed never retried; supervised first fire. RINSE
(#26) + no-drift (#27). DB: RULEBOOK §1.6 (new). Prod
`eamoozfhqolshdztbrez`; Colony `e594fc3a-17b7-45d0-9dde-943ebbfa5391`;
`samkado@gmail.com` = MILO credential, not app login.
**Bars: API 680/0 · scanner 79/0 · stress HIGH-WRONG 0.0% · family audit
all-zeros. Re-run both audits after any resolver/family change.**
