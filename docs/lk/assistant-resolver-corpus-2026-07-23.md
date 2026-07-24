# Resolver corpus — Tony's REAL weekly list, 2026-07-23

Transcribed verbatim from the Notes screenshots Tony sent the assistant the
night the promise-and-ghost bug was caught. This is the canonical accuracy
corpus: every resolver/parse improvement gets measured against THIS list,
and every confirmed miss becomes a pinned regression test. Do not "clean up"
the lines — the messiness IS the test.

Companion tooling: `services/api/scripts/audit-resolver.mjs`,
`scripts/resolve-order-codes.mjs` (run on Tony's Mac against prod,
read-only). Next step: run every line through resolveOrderLine, compare
against Tony's card screenshots + his corrections, and pin the misses.

## The list (as written by the operator)

```
Half pint Tito's x 12
Half pint Smirnoff x 12
Half pint red stag x 12
Half pint jack Daniel's honey x 12
Skyy vodka fifth x 3
Jack Daniel's fire fifth x 3
Jack Daniel's fire liter x 3
Fireball pint x case
Double shot fireball x case
Glenfidich 18 year x 1
Fifth Jameson x 1
Evan Williams honey fifth x 3
Carolans fifth x 3
Limoncello fifth x 6
Limoncello pint x 6
Dewars white label pint x 3
Johny walker red label fifth x 3
Skrewball fifth x 3
Casamigos reposado fifth x 3
Ocho tequila anejo and reposado fifth x 6 each
Casamigos reposado liter x 3
Tito's double shot x case
Bacardi rum plastic fifth x 12
Bacardi rum half gallon plastic x 6
Bacardi rum liter x 3
Blue chair rum whatever cream flavors they have give me 3 of each
Olive cherry vodka fifth x 3
Smirnoff red white berry fifth x 3
Smirnoff pink lemonade fifth x 3
Platinum 7x 1/2 gallon plastic x 3
```

Transcription notes: a couple of quantities were hard to read at screenshot
resolution (Jameson x1 vs x3) — confirm against Tony's Notes when pinning.
"Olive cherry vodka" is as-written; likely a brand phone-typo — the resolver
must handle operator typos, so it stays.

## Trap taxonomy (what makes each line hard)

| Trap | Example lines | Layer that must handle it |
|---|---|---|
| Size-first word order | "Half pint Tito's", "Fifth Jameson" | parse (name/size split) |
| "x case" quantity | "Fireball pint x case" | parse → needs case_size from catalog to become a number; today qty=null and the CARD has no "fill a case" handling — GAP |
| "double shot" size term | "Double shot fireball", "Tito's double shot" | sizeFromText — NOT MAPPED today (returns null). Likely 100ml sleeves; 100ml also missing from sizeFromText entirely — confirm against catalog before mapping |
| Two products in one line | "Ocho tequila anejo and reposado fifth x 6 each" | parse — must emit TWO items, qty 6 each |
| Open-ended catalog exploration | "Blue chair rum whatever cream flavors they have, 3 of each" | model + query_catalog — resolve ALL matching variants, one line each |
| Plastic/glass qualifier | "Bacardi rum plastic fifth", "Platinum 7x 1/2 gallon plastic" | preferFromText (exists — verify it wins in scoring) |
| Slang sizes | "1/2 gallon", "liter", "pint", "half pint" | sizeFromText (mapped — verify each) |
| Operator typos | "Glenfidich" (Glenfiddich), "Johny walker" (Johnnie Walker), "Olive cherry vodka" | resolver fuzziness |
| Flavor variants | "Smirnoff red white berry", "Smirnoff pink lemonade", "Jack Daniel's fire/honey" | flavor-KEEPING (these must NOT get flavor-penalized down to plain Smirnoff/JD) |
| Brand + generic noun | "Limoncello fifth" (which brand? store context matters) | resolver + maybe order-history signal — decide policy |

## Status

- 2026-07-23 night: ghost bug fixed (see TONY-WANTS assistant section) —
  the list now RESOLVES end to end; accuracy pass not yet run.
- **2026-07-23 ~11:30pm — LIVE RETEST (3 photos, 61 lines, "don't double
  add"): GHOST DEAD.** All photos rendered + read, overlaps deduped, card
  produced "24 need your eye · 37 ready", honest asks on case quantities.
  Third photo added lines: Svedka half gallon plastic x3, Ketel One half
  gallon x3, Stoli vanilla fifth x6 / liter x6 / half gallon x3.

### CONFIRMED MISSES (from the live card — the fix list)

| Asked | Card gave | Class |
|---|---|---|
| Jameson 750 | NATTERJACK IRISH WHISKEY 28885, marked MATCH | wrong brand, false confidence |
| Skrewball 750 | PORTER'S PEANUT BUTTER 23292 | wrong brand |
| Stoli Vanilla 750 | BURNETT'S VANILLA 85740 | wrong brand |
| Stoli Vanilla 1000 | GRAINGER'S ORG VANILLA 28710, marked MATCH | wrong brand, false confidence |
| Ketel One 1750 | LONE LIGHT VODKA 30850 | wrong brand |
| Smirnoff 200 | TITO'S 7128 | wrong brand (bizarre — investigate) |
| Fireball pint / double shot | CATCH FIRE 27082 / 100014, marked MATCH | wrong brand, false confidence |
| Bacardi rum (plain) ×3 sizes | BACARDI SPICED 7938/7939/7940 | flavor beat plain (inverted penalty) |
| Platinum 7X 1750 plastic | 100 ML code 6937 as best | SIZE LIE — worst class (7/11 mandate) |
| "x case" lines | qty defaulted to 1, marked MATCH | quantity gap — underorder risk |

Pattern hypothesis (verify with scores, don't assume): generic/category
token overlap ("IRISH WHISKEY", "PEANUT BUTTER", "VANILLA", "FIRE") is
outweighing BRAND-token identity, and a missing size falls back to a
wrong-size candidate instead of flagging. Also: model TEXT flagged doubts
the CARD didn't reflect (resolver confidence drove MATCH badges) — text
and card must never disagree.

### UX verdicts from Tony (same test)

1. Reply is a WALL — headers, emoji, bullets duplicating the card. The
   card carries detail; the text should be ~2 sentences.
2. Card lines hide the truth — must tap each dropdown to see what
   matched. Name + size + price must be glanceable; size mismatches loud.
3. Residual future-tense ("Let me search that directly") — prompt law
   needs tightening: flag it or fix it in-turn, never "let me".
4. WANT: quick-chip prompts when photos are attached ("Add all to cart —
   no duplicates", etc.) + research other occasions worth a chip.

- Next: run `scripts/audit-corpus-2026-07-23.mjs` (Tony's Mac, read-only)
  → paste output → scoring surgery with each miss pinned as a regression
  test.

### SURGERY ROUND 1 (deployed b81f0f8) — audit verdict

Ran the audit against the fixed resolver. **10 lines flipped correct:**
Fireball (→ FIREBALL CINNAMON), Glenfidich (→ GLENFIDDICH-18 YR, typo
tolerance), Carolans (→ IRISH CREAM), Bacardi ×3 (→ SUPERIOR), Platinum 7X
1750 (→ real 1750, high conf — size-lie dead), Olive cherry (→ THREE OLIVES
CHERRY — the exact bottle Tony meant), Jameson + Ketel One held correct.

### SURGERY ROUND 2 (the deep bug — same audit exposed it)

Two remaining misses shared ONE root cause: the brand-initial shortcut
(built for "jack"→"J DANIELS") was matching the possessive **'s** in
"RAM**'S**" and "BURNETT**'S**", so a wrong brand scored as if it contained
the queried brand. Fixed 2026-07-23 (uncommitted at time of writing):
- **Possessive-'s false match** — the initial heuristic now (a) applies ONLY
  to the brand-lead term and (b) excludes a possessive 's via negative
  lookbehind. Kills Skrewball→Ram's and Stoli→Burnett's.
- **"peanut" removed from FLAVOR_WORDS** — it's Skrewball's flagship, not a
  flavor; Carolans Peanut Butter stays demoted via the alias's missing-term
  penalty instead.
- **BRAND_SYNONYMS** — `stoli → stolichnaya` (Tony's store fact), applied
  per-token so "Stoli vanilla" expands.
- **VANIL truncation** — a 5-char prefix of a long distinctive term now
  counts as present (MLCC truncates "VANILLA"→"VANIL", "REPOSADO"→"REPOS").
- Pins added for all four.

### KNOWN / DEFERRED after round 2

- **Smirnoff half-pint → SMIRNOFF 100** (high conf): improved from the live
  card's TITO'S (fully wrong brand) to the right brand. Whether 80-proof vs
  100-proof is correct at 200ml is a **Tony-confirm** — the plain 80 may
  simply not be stocked at half-pint. Not forced.
- **"double shot" lines in the AUDIT SCRIPT look wrong** (cognac) — an
  artifact: the audit passes the whole "Fireball double shot" as the name,
  while the real assistant tool splits name="Fireball" + raw="…double shot"
  and derives size=100ml from the raw. Production resolves these far better
  than the audit shows. Verify on the phone, not the audit.
- **Limoncello / Ocho / Casamigos** ambiguity (multiple real brands or
  aged expressions) is FAIR "needs your eye" — not a bug.
