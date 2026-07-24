# Catalog stress run — 2026-07-24 (the 14,000-bottle question)

Tony (2026-07-24, after the glanceable-card live test): *"is this guaranteed
to work the same way if we have completely random bottles… we have to make
sure this works for all 14,000+ bottles in MLCC/Milo."*

Method: `services/api/scripts/stress-catalog-2026-07-24.mjs` — 200 random
SKUs from the 13,641 orderable (combos excluded), 4 deterministic phrasings
each (full+size-slang, brand-short, fat-finger typo, no-size), through the
real `resolveOrderLine`, seeded (reproducible before/after).

## BEFORE calibration (N=200 seed=20260724, 729 resolves)

| phrasing | right | honest-miss | med-wrong | HIGH-WRONG | truth in top-5 |
|---|---|---|---|---|---|
| full   | **97.0%** | 0.0% | 3.0% | **0.0%** | **100%** |
| short  | 44.7% | 7.9% | 47.4% | 0.0% | 78.9% |
| typo   | 57.1% | 21.5% | 20.3% | **1.1%** | 71.2% |
| nosize | 55.5% | 44.5% | 0.0% | 0.0% | 75.5% |
| TOTAL  | 65.0% | 19.1% | 15.6% | **0.3%** | 81.9% |

## Reading it honestly

1. **The mainstream-bottle fear is disproven for well-phrased lines**: name
   the bottle + size and it's 97% right with truth in top-5 100%, on random
   obscure SKUs (soju, rakije, shochu, Kirkland single malts).
2. **med-wrong on `short` is mostly NOT failure**: dropping the
   distinguishing word ("yukon jack" when truth was YUKON JACK FIRE) makes
   the plain/flagship pick CORRECT behavior (Tony's own flagship law). The
   harness's ground truth is unfair to those. The rest are genuine
   ambiguities (blanco vs anejo) with truth in top-5 and the swap chip one
   tap away.
3. **The real bug class (drove the fix): typo'd/unknown brand → generic-word
   cross-brand match at a confident badge.** "smrnoff citrus" → PINNACLE
   CITRUS, "copercraft citrus" → PINNACLE, "oplent vodka" → 360, "elington
   canadian" → CANADIAN LEAF. The 2 HIGH-WRONG cases were the single-row
   variant of this (old rule: one exact-size row = high, even wrong-brand).

## The fix (same day): evidence-based confidence

`resolve-order-lines.js` — new `termCoverage()` + rebuilt ladder:
- **review** — size mismatch, OR the lead (brand) word appears nowhere in
  the best match (substring / 5-char-prefix / stripped-punctuation / lead
  initial, mirroring scoring semantics). Cross-brand guesses can never wear
  a confident badge → kills the HIGH-WRONG class structurally.
- **high** — exact size + every distinctive word covered + margin ≥
  VARIANT_PENALTY over the nearest different-name rival (or no rival).
  Fixes the OTHER direction: 27 amber "CHECK"s on Tony's near-perfect live
  order (alarm fatigue) — evidenced winners now wear green.
- **medium** — brand present but contested/partially covered. Amber means
  something again.

Pins: 5 new tests in `resolve-order-lines.unit.test.js` (PINNACLE→review,
Casamigos→high, Limoncello→medium, Stoli vanilla→high via synonym+VANIL
prefix, TITO'S apostrophe coverage). Harness now prints EVERY HIGH-WRONG
(first run's 2 fell off a shared cap).

## AFTER (fill in on re-run, same command/seed)

`node scripts/stress-catalog-2026-07-24.mjs 200` — paste new table here.
Expect: HIGH-WRONG → 0.0% everywhere; med-wrong on typo drops (cross-brand
→ review, i.e. honest-miss rises); full stays ~97/0.

## What this does NOT solve (known, next)

Static lists can't learn a store's slang — that's the **per-store memory
build** (aliases/corrections that stick; FLAGSHIP_ALIASES graduates there).
Ambiguity ("Limoncello") is correctly amber, resolved by the store's own
usuals once memory exists.
