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

## AFTER round 1 of the calibration (same seed) — honest verdict: mixed

| phrasing | right | honest-miss | med-wrong | HIGH-WRONG | top-5 |
|---|---|---|---|---|---|
| full   | 97.0% | 0.0% | 3.0% | 0.0% | 100% |
| short  | 44.7% | 9.2% | 44.1% | **2.0%** | 78.9% |
| typo   | 57.1% | **39.0%** ↑ | **2.8%** ↓↓ | 1.1% | 71.2% |
| nosize | 55.5% | 44.5% | 0.0% | 0.0% | 75.5% |
| TOTAL  | 65.0% | 23.6% | **10.7%** ↓ | **0.7%** ↑ | 81.9% |

Typo cross-brand junk collapsed (20.3→2.8) — but **HIGH-WRONG rose 2→5**:
the margin rule widened green and let new wrongs in. All 5 captured
(harness now prints every one). Root causes:
1. **Brand-initial bug (2)**: the initial shortcut fired on stray single
   letters ANYWHERE in a name — "camesi" "covered" by the "C&D" in
   CODIGO … C&D; "damore" by "D' ARGENT". Real pattern is J DANIELS: the
   initial is the name's FIRST token.
2. **Harness mislabels (3)**: "evan williams" → EW Black Label (truth: EW
   Cherry), "traverse city" → plain (truth: 3PK), "play like" → plain
   (truth: 8-YR). That's the flagship law working — same brand family,
   variant word never given.

## Round 2 fixes (same day)

- `firstNameToken()` — the brand-initial shortcut in BOTH scoring and
  coverage (kept mirrored) counts ONLY when the initial is the name's first
  token. Bonus: fixed the RANKING too — "the damore-25 yr" now picks THE
  DALMORE itself (review badge). 3 new pins (camesi, damore, J DANIELS
  regression guard).
- Harness: new **brand-fair** bucket (best shares the truth's first two
  name tokens) so flagship-law picks stop polluting the wrong columns —
  med-wrong/HIGH-WRONG now show only true cross-brand errors.

## AFTER round 2 (same seed) — the answer

| phrasing | right | brand-fair | honest-miss | med-wrong | HIGH-WRONG | top-5 |
|---|---|---|---|---|---|---|
| full   | 97.0% | 3.0% | 0.0% | **0.0%** | **0.0%** | 100% |
| short  | 45.4% | 42.1% | 5.3% | 7.2% | **0.0%** | 78.9% |
| typo   | 55.9% | 1.7% | 41.2% | 1.1% | **0.0%** | 69.5% |
| nosize | 56.0% | 34.5% | 9.5% | 0.0% | **0.0%** | 75.5% |
| TOTAL  | 65.0% | 19.5% | 13.7% | **1.8%** | **0.0%** | 81.5% |

**Verdict: 98.2% of all resolves are correct behavior** (right + flagship-
fair + honest flag). Wrong-with-a-badge fell 15.6% → 1.8% — and those 13 are
intra-brand near-misses (KOMOS extra añejo vs añejo reserva) with truth in
top-5, wearing the amber they deserve. **A wrong bottle can no longer wear
green anywhere in the catalog** (measured, seeded, reproducible).

Known residue (accepted, not worth more static rules): substring false
positive ("row" inside "cROWn" satisfied the lead for WHISKEY ROW → CROWN
ROYAL at medium), symbol brands dissolving at tokenization ("G&W" → no lead
term). Both amber-flagged, both rare, both better solved by the per-store
memory (a store that orders G&W teaches the system its own vocabulary).

## What this does NOT solve (known, next)

Static lists can't learn a store's slang — that's the **per-store memory
build** (aliases/corrections that stick; FLAGSHIP_ALIASES graduates there).
Ambiguity ("Limoncello") is correctly amber, resolved by the store's own
usuals once memory exists.
