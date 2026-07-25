# Family-sibling audit — 2026-07-25 (the "100% correctly coded" check)

Tony: *"i want to do another bottle sibling run and make sure 100% of the
bottles are coded with the correct siblings, and we need to make sure we are
sticking to our own rules in the database."*

Tool: `services/api/scripts/audit-family-siblings-2026-07-25.mjs` (read-only,
prints host, pages full catalog by design — see amended DB rule, RULEBOOK).

## BEFORE (first run)

NULL 0 · STALE 0 · container drift 0 · pack drift 0 — **the DB was already
100% consistent with the canonical function.** But: **13 SPLIT groups**
(one product line under two keys) — every single one MLCC's own punctuation
typed two ways across sizes: apostrophes (DRAGON'S/DRAGONS, D'USSE/DUSSE),
periods (NO. 8/NO 8), hyphens (OLD-FASHIONED), spaced letters (X O, V S,
(P R)), age spacing (-4 YR/-4YR). 16 merge-smells = MLCC relists (old code
vs 100xxx code, same bottle) — legit, no action. Chip reach 41.33%
(catalog truth: most SKUs are single-size).

## FIX (same night)

`canonicalizeFamilyKey()` added to `src/mlcc/family-key.js` (final-key-only —
tail-strip/container/pack detection untouched): apostrophes stripped,
periods dropped with a decimal guard (1.75L survives), hyphens→spaces,
single-letter pairs fused (X O→XO; "MR B" untouched), age tokens fused
(4 YR→4YR), paren spacing normalized ((P R)→(PR)). 5 new pinned tests
(family suite 16→21); every prior grouping guarantee pinned as unchanged.

Backfill: dry-run showed **2,611 rows** (not ~30 — the canonicalization
reformats every punctuated name's key, not just the 13 split families;
families move as units, so no new splits). Tony ran --apply (2,611/2,611,
0 failures) → --verify PASS.

## AFTER

**NULL 0 · STALE 0 · SPLIT 0 · container 0 · pack 0.** Merge-smell still
exactly 16 (the known relists) → the 2,611-row rewrite introduced ZERO false
merges. Chip reach 41.33% → 41.47% (+19 bottles gained their siblings).
Families: 9,819 → 9,806 (the healed merges).

**Verdict: every active bottle's family coding now provably matches the
canonical law, and the law is pinned so it can't drift.** Re-run the audit
script after any future price-book ingest or family-fn change.
