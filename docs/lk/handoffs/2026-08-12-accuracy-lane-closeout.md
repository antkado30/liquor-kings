# 2026-08-12 — Accuracy Lane Closeout (the Captain Morgan day)

Tony closing Colony ~9pm. Everything below is saved so nothing is lost.

## WHERE PROD IS RIGHT NOW

Live at **643b4d0** (API + worker both deployed and truth-probed tonight):

- **Order-placed sheet fixed** — submit runs write `submit_validate_summary` evidence; the sheet shows full ADA breakdown / order summary / OOS lines instead of "No detailed result". (Worker + API.)
- **Catalog scroll restore** — Browse survives a Cart round-trip completely now: query + filters + sort + exact scroll spot.
- **Recently viewed** — strip on scanner home; every ProductCard open recorded (one wire covers scan/search/browse/cart-tap), one card per family, Clear button. localStorage `lk-recently-viewed-v1`, cap 12.
- **Recent-search chips** on scanner home + clear × on orders search.
- **Pack-aware add toast** ("6 × 50 mL (20-pack)").
- Scanner test bar at deploy: 214. API bar at deploy: 812.

**Deploy lesson (now law): deploys run from the REPO ROOT** (`cd ~/dev/liquor-kings`). Running from services/api broke the fly builder ("failed to parse daemon host") and uploaded a 361MB context (services/api has no .dockerignore; the root one has everything). Root deploy = 2MB context, all cached. Worker deploy ~10 min Chromium build, never ctrl-C.

## PENDING BATCH — built, green, NOT yet shipped (ships on "batch me", API-only deploy, no worker)

Sandbox commits since 643b4d0, in order:

1. **9c85507 — "You order this size" card line.** New route `GET /orders/history-for-codes` (registered BEFORE /:id), pure lib `order-history-for-codes.js` (orders-count + last qty/date per code, synced-truth preferred, leading-zero normalize), 7 pins. Card fetches once per family (all size chips), 5-min client cache, green line under details: "You order this size — 4 orders · last 6 on Jul 12".
2. **6d43668 — empty cart offers paths**: "Browse catalog" + "Reorder a past order" buttons.
3. **7c1fe44 — RTD flavor compounds + ordered-before tie-breaker.** FLAVOR_WORDS += iced tea, margarita, daiquiri, colada, mojito, sangria, mai tai ("sweet tea" deliberately absent — Firefly's flagship). `ORDERED_BEFORE_BONUS = 35` (< every real penalty: variant 40, missing 60, flavor 100, lead 150) — store history breaks ties, NEVER overrides typed words. Wired on all three AI surfaces: assistant resolve tool, bulk paste (`resolveOrderList` now takes storeId), photo-scan route. `collectOrderedCodes`/`fetchOrderedCodeSet` in order-history lib (fail-soft empty Set).
4. **a497052 — flavor truncation tolerance.** Consonant-skeleton match for flavor words (PNCH↔punch, VANIL↔vanilla) with ≤-length token guard (PANACHE never accused). A plain-prefix rule was tried and REVERTED same commit: "OLD 7 BLACK" read as truncated BLACKberry.
5. **3e4ced4 — the Morgan block.**
   - **Truncation bridge**: a name token ≥4 chars that the typed word starts with = that word truncated (capt→captain, morg→morgans). Whole-catalog fix for abbreviated flagships.
   - **Captain flagship alias with catalog truth**: bare captain/captain morgan(s)/capt morg(ans) → `["capt","morgan","spiced","rum"]`. Two-token alias keys now supported + depluralized lookup.
   - **Product truth beats size truth**: when the best candidate ignoring size beats the best size-exact one by ≥ a full missing word, the size filter was about to swap PRODUCTS — surface the named product, sizeMismatch=true, review badge, exactHit=false.
   - **Maximal flavor dedupe**: PINEAPPLE no longer fires apple+pineapple double penalties (margins were buying false-green badges).
   - 8 fixture pins using the REAL Morgan rows from Tony's prod SQL.
6. **0bd63d0 — brand-flagships knowledge layer (the EVERY-bottle system).**
   - `src/lib/brand-flagships.js`: `clusterBrands` (truncation-aware lead merge, second-token guard keeps JACKSON MORGAN separate), `chooseFlagship` (SIZE-LADDER LAW: flagship has the deepest size ladder; demote flavors/proof-lines/aged/variety; combos disqualified; close race → confident:false), `brandKeysOf` (keys people type), `loadFlagshipMap` (5-min cache, stampede-proof in-flight sharing, fail-soft empty map).
   - `scripts/build-brand-flagships.mjs`: pages catalog → clusters → picks → upserts CONFIDENT picks only (source='heuristic'); ambiguous go to `brand-flagships-review.csv` only. `source='curated'` rows are NEVER touched. Dry-run default; `--write` to commit. Needs LK_PROD_* or SUPABASE_* env in services/api/.env.
   - `sql/2026-08-12-brand-flagships.sql`: table + RLS-on-no-policies. Fix-with-a-row: `update brand_flagships set alias_terms=..., source='curated' where brand_key=...` — no deploy.
   - Resolver consults static (curated in-code) map FIRST, then the dynamic table.

**Bars right now: API 855 / scanner 214 / tsc clean.** (Sandbox note: full API suite needs `SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=dummy` env — no .env in sandbox.)

### Tony's runbook when this batch ships
1. Batch ritual as usual (commit → bars → API deploy from repo root → truth probe).
2. Supabase SQL editor: run `sql/2026-08-12-brand-flagships.sql`.
3. `cd ~/dev/liquor-kings/services/api && node scripts/build-brand-flagships.mjs` — read the CSV (ambiguous rows sort to top).
4. Same command with `--write` when satisfied.
(Deploy/migration order doesn't matter — resolver is fail-soft until the table has rows.)

## THE CAPTAIN MORGAN STORY (root causes, all fixed + pinned)

Tony: "captain morgans fifth x 3" → resolved to an RTD variant. Catalog truth from his two SQL dumps:
- The flagship is stored ABBREVIATED: **CAPT MORGAN SPICED RUM (P R)** — 41307 is the 750 (glass), 41297 the PL. Fully-spelled "CAPTAIN MORGAN …" names are all flavors/variants.
- **CAPT MORG LONG ISL ICED TEA is real** (375/1750 only — no fifth exists, so the original match was wrong on product AND size).
- Failure chain: "captain"/"morgans" couldn't match CAPT/MORG (invisible flagship) + "spiced" ate a flavor penalty on the flagship's own name + iced tea carried no flavor words = scoring inverted.

Laws now pinned in tests (91 resolver pins total):
- Typed words ALWAYS beat history; history (35) only breaks ties.
- Product truth beats size truth — never silently swap products to satisfy a size.
- Abbreviated flagships must be visible (truncation bridge).
- Margins must be honest (flavor dedupe) — badges measure the real race.
- A knowledge row must never guess (ambiguous → review CSV, not the table).

## PHOTO AUDIT — SIZED (Tony ran the SQL)

14,437 active · **2,446 no photo** · **11,991 serper** (auto-scraped, unverified — where the wrong pictures live) · 0 in-store · 0 curated · 6 reported_wrong.

Next build (awaiting green light): overnight AI verify pass in the worker — vision model checks each scraped photo against its product name, mismatches flagged + re-sourced, stubborn ones fall to the "Wrong photo?" button and the in-store camera (precedence already live: in_store > curated > serper).

## OPEN ASKS / NEXT SESSION

- Tony says **batch me** → ship the accuracy lane, then the 4-step runbook above.
- Nice-to-have for the corpus: the exact captain line he pasted + what badge it wore.
- Standing (no pressure): Colony MILO sub-user invite + role screenshot; Michigan Liquor Orderer recon screenshots (5); printer photo for #38; 10-second incognito Start-free test.
- Watch MLCC inbox for the recognition letter reply (sent 8/9 from Antonios; ~1 week then call 800-701-0513).
- Build lanes queued: photo verify pipeline; SUBMIT-WITH-OOS (worker gate ~line 1653 MILO_STAGE5_CART_NOT_CHECKOUTABLE — need one real OOS Check's evidence to decide the relaxation); flagship LLM pass for ambiguous CSV rows (optional); #37 store-local timezone grouping; #38 print tier-1; #40 NRS POS lane.
- Docs: bible §2 bars line stale (says 805/189; real 855/214) — fix next bible touch.
