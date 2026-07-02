# Catalog Quality Plan — Family Tree 100% + Grouped Search

**Origin (2026-07-01):** Tony found competitor app "minimum." (state
minimum-price lookup; MI/IA/OH). Their catalog UX bar: search "tito" →
ONE card, all 7 sizes with prices. LK's family tree exists but breaks on
real bottles (plastic pint of Jack Daniel's shows NO family; glass shows
full tree). Tony's mandate: family tree must work for EVERY bottle in the
MLCC catalog, search must group like theirs, and we must be better than
them in every way. Decisions below were made WITH Tony (2026-07-01).

**What "minimum." is / isn't:** price-reference tool. No ordering, no
cart, no MILO automation, no scanning. Not a threat to LK's core; a UX
bar for LK's catalog. (Bonus: we already hold minimum-shelf-price data —
`mlcc_items` price book + MILO's `minimumShelfPrice` — so their entire
feature is one ProductCard row for us, post-freeze.)

---

## Root cause (found 2026-07-01, read from code — `services/api/src/mlcc/mlcc-product-family.js` + `price-book.routes.js /items/:code/family`)

1. **Container tokens aren't stripped from the name base.**
   `normalizeMlccNameBaseForFamily` strips trailing size tokens
   (`PT|FTH|LTR|QTR|50ML|375ML|750ML|1000ML|1750ML`, raw `…ML`/`…L`) but
   NOT container/pack markers. MLCC marks plastic with `PL` (e.g.
   "SMIRNOFF 80 PL", "JACK DANIELS OLD 7 PL PT"). So the plastic pint
   normalizes to "…OLD 7 PL" ≠ glass base "…OLD 7" → **no family. This is
   Tony's exact bug.**
2. **The size token list is incomplete** — missing 100ML, 200ML, 250ML,
   HALF GAL/GAL forms, etc. — and stripping is single-pass, so stacked
   suffixes ("… PL PT", "… PT PL") never fully reduce.
3. **Families are split by distributor.** Both the pool query
   (`.eq("ada_name", …)`) and `rowInSameFamilyAsAnchor` require the SAME
   ADA. Sizes of one product line routed through different ADAs (common
   for minis) silently vanish from the tree.
4. **Duplicate size rows possible.** The same code exists under multiple
   ADAs (unique index is (code, ada_number)); the route dedupes by row id
   only → one size can render twice.
5. **Per-tap fuzzy ILIKE pool + JS filter** instead of a precomputed key:
   slower (instant-feel violation), capped at 500 rows, and every surface
   that wants grouping must re-implement it.

## The design

### A. Family identity: materialized `family_key`
- New normalization (versioned, pure, unit-tested):
  `family_key = normalize(name)` where normalize (iteratively, until
  stable) removes trailing **size tokens** (complete list incl. 100ML,
  200ML, 250ML, HALF GAL…), **container tokens** (`PL`, `PET`, `PLASTIC`,
  `GLS`, `GLASS`, `TRAV`, `TRAVELER`…), and combo segments (existing
  `W/…` logic), then collapses whitespace. Category stays part of family
  identity. **ADA does NOT.**
- **Container becomes data, not noise:** extraction also emits
  `container` (`glass` default | `plastic` | …) stored per row. MLCC's
  `PL` is authoritative for plastic; absence = glass (verify assumption
  in the audit — sample real codes Tony knows, e.g. Mohawk PL 60728).
- Schema: `mlcc_items.family_key text` + `container text` — computed by
  the ingestor on every price-book row + one backfill migration.
  Indexed; `/items/:code/family` becomes one equality query (fast,
  consistent, no 500-row cap). `brand_family` (when present) still wins,
  as today.
- Dedupe rule: one entry per (code); ADA variants collapse into that
  entry (ordering still uses code+ADA downstream, unchanged).

### B. The Tony rule: group for discovery, distinguish for ordering
(Decided 2026-07-01 — his fear: "I don't want someone ordering glass and
getting a plastic pint.")
- ONE family tree per product line: scanning ANY variant (plastic,
  combo, mini) shows the complete tree.
- A size available in both materials renders as TWO chips, each labeled:
  `750 mL · Glass  $19.99` / `750 mL · Plastic  $17.99` — own code, own
  price. Container label is NEVER hidden when a family has mixed
  containers.
- The label travels the whole order path: size chip → cart line (extend
  the existing `750 ML · #1505` display with `· Plastic`) → pre-submit
  confirm modal → order history. You never order an ambiguous size.

### C. Grouped search (decided: like the competitor, better)
- Search results collapse to family cards: name + N sizes + price range;
  tap → full ProductCard tree. Server groups by `family_key` (one
  query), so scan-page search, Browse, and the AI resolver read the SAME
  truth.
- Matching runs on `name_searchable` (punctuation/space-proof: "titos" →
  TITO'S) + the resolver's term-relaxation learnings. Flat fallback kept
  behind a flag for rollback.

### D. The audit loop (doctrine — prove it, then ship it)
`services/api/scripts/audit-family-grouping.mjs` vs prod (read-only):
- **Split-family rate:** rows whose stripped base matches another row's
  but land in different families (target ~0).
- **False-merge check:** families containing >1 distinct brand anchor or
  mixed flavor/proof/age tokens (target 0 — JD vs JD Honey, Smirnoff 80
  vs 100 must stay separate; sampled + eyeballed).
- **Container extraction coverage** + duplicate (size, container)
  collisions inside a family.
- Known-case regression set: JD glass/plastic pints, Tito's full run,
  Smirnoff 80 PL, Mohawk half-gal PL, Fireball, Casamigos combo, 1800
  Lions edition (edition stays excluded from base families), E&J.
- Loop: run → fix normalization → re-run → Tony spot-checks on device →
  only then wire the UI.

## Sequencing (decided: speed first)
1. **Tomorrow (Thu 7/2):** Colony order + submit-endpoint capture. No
   catalog changes ship before that.
2. **Next build thread:** engine submit wiring (scan→submitted in
   seconds — the moat).
3. **Then this plan**, in order: normalization + tests → migration +
   backfill + audit loop to green → family endpoint on `family_key` →
   size-chip container labels + cart/modal labels → grouped search UI.
   Each step deployable alone; catalog work never touches the order
   pipeline (disjoint files; safe to parallelize if Tony wants pace).

## Audit results — engine VALIDATED on the full prod catalog (2026-07-01 night)

Two audit rounds against all 13,828 active rows (`scripts/audit-family-grouping.mjs`,
engine `src/mlcc/family-key.js`, 16 unit tests):

- **644 orphaned rows healed** (old logic stranded them; new key reunites) —
  Tony's plastic-pint class, catalog-wide.
- **1,426 plastic SKUs** extracted as container data; **527 families mix
  glass+plastic** → the always-label-the-chip rule is load-bearing.
- **0 aggressive strips**, **0 over-merges** found in the big-family eyeball
  (biggest real families: Fireball Cinnamon 12, Early Times 11, Tito's 11 —
  all legit lines).
- **474 gift-combo SKUs** map to their base key (scan a combo → real family)
  and are excluded from family membership (anchor-only policy, as live).
- **Proof cards:** J DANIELS TENNESSEE FIRE = 7 sizes glass+plastic in ONE
  family; Honey/Apple/Fire correctly separate; MOHAWK's six lines each
  reunify glass+plastic; SMIRNOFF 80 one family, 100 separate; FIREBALL
  CINNAMON 11 sizes with editions quarantined.
- `brand_family` column is **0% populated in prod** → the name-derived key is
  the sole grouping truth; the live route's brand_family branch never fires.

**Known follow-ups for the wiring phase (documented, non-blocking):**
1. MLCC-truncated combo names ("TITO'S HANDMADE VODK/50ML …") orphan their
   key → scan-time prefix fallback when an isCombo row's family is a
   singleton (match the longest family key sharing a ≥10-char prefix).
2. ADA-healed rows were only 14 — the ADA constraint matters less than
   feared, but dropping it is still correct.
3. ~20 family keys span 2 categories (9,826 raw keys vs 9,846
   key+category families) — the endpoint MUST keep filtering by category
   alongside family_key, same as today's route.
4. The price-book ingestor must compute the four columns on every upsert
   (today only the backfill writes them; a brand-new SKU lands with NULL
   family_key until then — falls back to the old name-pool path).

**BACKFILL APPLIED TO PROD 2026-07-01 night:** migration
`20260702011500` + `scripts/backfill-family-key.mjs --apply` = 13,828/13,828
rows written, 0 failures, --verify PASS. The columns are LIVE DATA, still
read by nothing — the endpoint/UI flip is the next deploy after the
2026-07-02 Colony order.

## Safety rails
- No RPA/order-path files are touched by any step.
- Migration is additive (new columns); old name-pool path stays as
  fallback until the audit is green.
- Grouped search ships behind a flag; flat search is one flip away.
- The false-merge audit gates the UI: a wrong merge (two different
  products in one tree) is the one failure mode worse than a split —
  it can put the wrong bottle in a cart. Zero tolerance, verified
  against the full catalog before rollout.
