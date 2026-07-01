# Tony Wants — Permanent Wishlist & Directives

---

# ⚡ THE QUALITY MANDATE — PERMANENT, ABOVE EVERYTHING (Tony, 2026-06-11)

> "The quality. Quality. THE QUALITY is the most important thing. I can't
> emphasize this anymore. Everything should be instant. Everything should
> work in an instant. This is what I meant from the start — reliability,
> quality — that's what 'no one can fathom this product' MEANS."

**The evidence that triggered this:** 2026-06-10, placing a REAL order —
phone OVERHEATING, every button tap taking 5-10 SECONDS, search missing
obvious bottles, validate hanging then dying with no explanation. The
app failed its founder on its core job, on a deadline, in his own store.

**The mandate, permanent and absolute:**

1. **FEATURE FREEZE until the core loop is unbreakable.** Not one new
   feature until search → cart → validate → submit survives THREE
   consecutive real weekly orders in-app, start to finish.
2. **Instant is the spec, not the goal.** Every tap responds
   immediately — perceived wait on any interaction is a P0 bug. If data
   isn't ready, the UI says so beautifully in <100ms; it never freezes,
   never spins blind, never heats the phone.
3. **A phone overheating means we are burning the user's hand with our
   waste.** Profile it, find it, kill it. (Suspects to start: image
   payload sizes in the photo-heavy catalog, render thrash, polling
   loops, the cross-region hop.)
4. **Nothing fails silently, ever.** Every failure states its reason in
   one human sentence and offers one-tap retry. "finished as failed" is
   itself a failure.
5. **Quality outranks everything** — features, photos, polish, deadlines,
   momentum, excitement. When in doubt between building and hardening:
   HARDEN. This is the doctrine's spine and the moat ("this never lies
   to me" is what $119/mo buys).
6. **Every session, before anything else:** would Tony's dad hit a wait,
   a freeze, a lie, or a mystery anywhere in the core loop today? If
   yes, that's the work. There is no other work.

This section sits ABOVE every list in this file on purpose. It expires
never.

**Status 2026-06-12:** The wedge that killed both real orders is root-caused
and DEAD (worker zombie-browser starvation — see journal + 06-12 commit).
Deployed in v147 + worker: camera sleeps under overlays (the overheat),
360px grid thumbs + capped fulls (the image burn), validate failures explain
themselves in one sentence + one-tap retry, dead-man auto-restart so the
worker can never silently wedge for days again, submit gate armed on the
worker (had been silently dry-run since the 06-08 split). Mandate clock:
3 consecutive real weekly orders in-app — first attempt next week.
**FULL SYSTEM AUDIT ordered 2026-06-12** ("every single file, every defect,
set-and-forget V1") — living doc: docs/lk/FULL-SYSTEM-AUDIT.md.

**FIXED 2026-06-13 — Scan page couldn't scroll to search/MLCC bar on real
device.** Root cause: `.scanhm-page` (added in the 06-10 multi-store commit)
set `padding-bottom: max(16px, env(safe-area-inset-bottom))`, same specificity
as `.page`'s `padding-bottom: 96px` but later in the file — silently dropping
the scan page's bottom clearance from 96px to ~16-34px. The fixed BottomTabBar
(~60-75px) then overlapped the last ~60-80px of scan-page content (the
search/MLCC bar), and because total height barely exceeded the viewport,
touch-scroll just rubber-banded and snapped back on release instead of
revealing it. Fixed in `apps/scanner/src/index.css` —
`.scanhm-page` padding-bottom restored to `calc(96px + env(safe-area-inset-bottom))`,
matching every other page. NOT YET deployed/verified on device — needs a
real-device check next deploy.

---

## 📱 Native app — App Store (stated 2026-06-12)

> "Our end goal is turning it into an app. Not something on Safari
> forever — Safari stays available, but this is gonna be an app."

💡 Post-V1 (after the 3-real-orders mandate clears). The architecture is
already right for it: wrap the existing scanner SPA with **Capacitor**
(~95% code reuse, same API) + a native barcode module (kills the
ZXing-JS CPU burn AND the Safari-only bug classes — auth-lock freezes,
PWA icon re-add dance, camera permission quirks). App Store review needs:
privacy policy (✅ live), support contact, screenshots. The audit's
hardening all carries over — nothing built now is throwaway.

---

## 🔥 Bulk paste-to-cart via the AI (stated 2026-06-16)

> "I want to send all that type of stuff to the AI and it has an option to
> add to cart — or verify before adding to cart, then add to cart. That shit
> would be amazing." Tony pasted his full weekly order (~25 lines) into the
> assistant and it failed badly.

**Two real bugs found 2026-06-16 (root-caused):**
1. **Assistant is STATELESS** — `POST /assistant/ask` takes only
   `{question, storeId, image}`; no conversation history. Follow-ups lose all
   context ("every one of *what*?"). FIX: thread message history from client →
   endpoint → `askAssistant`. Pure bug — freeze-compatible hardening.
2. **Can't bulk-resolve** — `MAX_TOOL_ITERATIONS = 8` + `query_catalog` is
   one-search-per-call, so a 25-line list can't be resolved in the loop. FIX:
   a `resolve_order_list` tool that takes an array of `{name, size, qty}` and
   returns the best-match code per line in ONE call.

**The feature (the want):** paste a free-text order list → AI resolves every
line to a code (best match + alternatives, flags the ambiguous) → shows a
VERIFY screen (line · matched bottle · size · code · qty) → one tap **"Add all
to cart."** This is THE killer workflow for every store owner (not just
Colony) — it's how real weekly orders actually get entered, and it's a huge
scale/onboarding lever.

**Interim shipped 2026-06-16:** `services/api/scripts/resolve-order-codes.mjs`
— a CLI that bulk-resolves an order list against prod (runs on Tony's Mac).
Proves the matching logic; becomes the core of the `resolve_order_list` tool.

Status: ⏳ bugs #1 + #2 are freeze-compatible hardening; the verify + add-to-cart
UI is a feature — sequencing vs the 3-order mandate is Tony's call.

- 💡 **Bulk/fast order entry as the core differentiator.** MILO only offers Add-By-Code (one code at a time) — painful. LK's edge is effortless cart-building: scan, photo of barcode/tag/bottle, search, paste-a-list — no manual codes. Keep expanding + polishing this; consider an explicit "import/upload an order" too. (Tony, 2026-06-27.)

---

## 🗄️ Permanent price-book archive + history (stated 2026-06-16)

> "Whenever I give you the whole MLCC price book file, create a file on the
> database with every single price book — keep everything FOREVER. So the AI
> can answer 'how did this price change in the past two months / quarter' by
> comparing the old one vs the new one. Good to have everything on deck."

**Plan (build when Tony sends a price-book file):**
- `mlcc_price_book_snapshots` — one row per price-book version (published_date,
  source_url/hash, ingested_at, row_count) + the RAW file kept in Supabase
  Storage, full fidelity, forever.
- `mlcc_price_history` — per item, per snapshot: code, name, size,
  licensee_price, shelf_price, state_min, ada, captured_at. Enables "price of
  code X over time."
- AI tool `query_price_history(code|name, period)` → assistant answers "how did
  this change last quarter," trends, biggest movers. Real moat + retention hook.
- The daily cron already DETECTS when MLCC republishes — wire it to
  snapshot + diff instead of just overwrite-ingest.
- Groundwork exists: `mlcc_price_book_runs` (ingest audit) +
  `mlcc_items.price_changed_at` (latest-change stamp only, no history). This adds
  the real time-series.

Status: 💡 designed, waiting on Tony's price-book file to build the ingestion +
migration.

---

> **What this is:** A permanent, living list of everything Tony has asked
> Liquor Kings to be, do, or become. Updated as things land. Checkmarks
> mean shipped to prod. Read this AT THE START of every session before
> proposing what to work on. Last updated: 2026-06-06.
>
> **Discipline:** When Tony says he wants something — a feature, a vibe,
> a rule — add it here. Never let a stated want fall out of context.

---

## The North Star (the why behind all of it)

- **Retire my parents this summer (summer 2026).** Family-first. The
  family liquor store gets modernized with LK tech, sold by end of
  summer 2026, parents step back. This is non-negotiable motivation.
- **Sell the family store, then scale the SaaS.** LK isn't just a tool
  for dad — it's the proof point + launchpad for a Michigan-wide,
  then national B2B SaaS. Public launch target: **Nov 21, 2026**.
- **Acquisition narrative.** Build LK with eventual acquirers in mind
  (POS companies, distributors, fintech, accounting platforms). The
  BLUEPRINT.md vision doc spells this out.
- **19-year-old founder energy.** Move fast. Don't ask for permission
  on small things. Ship real impactful features, not micro-iterations.

---

## The Integrity Doctrine (the bar)

**See [INTEGRITY-DOCTRINE.md](INTEGRITY-DOCTRINE.md) — the permanent
standard Tony set 2026-06-06:**

> **"No leaks, no breaks, no nothing. Bugs can't survive."**

This isn't a vibe — it's 12 named operational disciplines that govern
every code/product decision LK ships. "Perfect" = Predictable +
Trustworthy + Proud-of. The doctrine is the moat. Read the doc.

## Instant feel (the speed bar) — stated 2026-06-07

> **"Everything must feel INSTANT. Once you click a button, once you
> enter a new page / a new tab, everything is instant. Once you
> validate, once you submit, everything is instant. That's the goal."**

Perceived latency is a bug class under the Integrity Doctrine. Status:

- ✅ **Instant tab switches** (2026-06-07) — added a zero-dependency
  stale-while-revalidate cache (`apps/scanner/src/lib/swr.ts`). Catalog,
  Orders, Templates, Smart Cards, and price-book status now paint cached
  data instantly on reopen and refresh in the background. No more blank →
  spinner on every tab switch.
- ✅ **Sync auth token** (2026-06-07) — JWT read from an in-memory session
  mirror instead of awaiting `getSession()` before every API call.
- ✅ **Server-side local JWT verification — ZERO config (2026-06-10, in the
  undeployed batch).** The old plan needed SUPABASE_JWT_SECRET, but Tony's
  project rotated to asymmetric ES256 signing keys (no shared secret
  exists). New: `access-token.js` verifies ES256 tokens against the
  project's public JWKS (fetched once, cached 10 min, rate-limited refetch
  on key rotation) — kills the per-request GoTrue network hop with NOTHING
  to configure. 8/8 adversarial tests (tamper, kid-spoof, wrong issuer,
  expired, alg=none all rejected). getUser() fallback retained on any miss.
- ✅ **Code-split the bundle** (2026-06-07) — the 7 non-home pages + the
  Assistant/Analytics overlays are now lazy-loaded into their own small
  chunks (Browse 15KB, Templates 10KB, etc.), prefetched on idle so first
  taps stay instant. ZXing was already its own dynamic chunk. Home bundle
  shrank; other screens no longer block first paint.
- ✅ **Backend speed pass #1** (2026-06-07) — dropped the `count:"exact"`
  full-table scan from every `/browse` query (client never used the total);
  parallelized the price/proof range facet pairs and the home price-change
  card's order+bottles lookups. Code-only, no migration.
- ✅ **Browse payload trim** (2026-06-07) — `/browse` now selects only the
  ~13 columns the catalog card + cursor need instead of `select("*")`,
  shrinking each row over the cross-region hop.
- ❌ **Backend indexes — decided NOT needed** (2026-06-07). Probed prod
  `mlcc_items` indexes: at ~13.8k rows Postgres seq-scans/sorts in <10ms,
  so sort/filter indexes give negligible read gain for real write+migration
  cost. The `count:"exact"` removal + payload trim were the real DB wins.
  Revisit only if the catalog grows 10x or EXPLAIN shows a real hotspot.
- ✅ **Facet aggregation** (2026-06-10, in the undeployed batch) — the 3
  category/ada/size facets each scanned ~13.8k rows for JS counting +
  4 min/max queries. Now ONE `browse_facets()` RPC (migration
  `20260610234500`, pglast-validated inner+outer) returns the whole blob
  via Postgres GROUP BYs. JS path retained as automatic fallback, so
  deploy order doesn't matter — run the migration to switch it on.
- 💡 Co-locate API + DB region (bigger move, later).
- ✅ **Split the Chromium worker into its own Fly service (deploy-speed fix)**
  (2026-06-08). DONE + verified in prod. API/web (`liquor-kings`) is now a slim
  **117 MB** image (was 821 MB → ~7x smaller, much faster deploys); the RPA
  worker runs on the Playwright image in a separate app (`liquor-kings-worker`).
  Worker proven processing 3 live validates with warm-session reuse + DB-cred
  decrypt. Files: Dockerfile (slim), Dockerfile.worker, fly.toml (worker
  removed), fly.worker.toml, `npm run deploy:worker`, runbook
  docs/lk/runbooks/WORKER-SPLIT.md. Scale workers with `fly scale count N -a
  liquor-kings-worker` (claim is atomic — safe).

---

## 🔥🔥🔥 #1A — CATALOG/UPC TRUTH AUDIT (Tony, 2026-06-10 late night, during a REAL order with his mom)

> "Bottles wouldn't pop up on our end but on MLCC they popped up normally
> with every size. Scanned a fifth of 1800 Silver and the LIONS EDITION
> popped up. Check EVERY mapped UPC→code. I will not tolerate mismatches."

Two diseases witnessed: (1) Bushmills Red Bush 750 missing from our
catalog while live on MILO — PRIME SUSPECT: STALE PRICE BOOK (cron-job.org
daily sync was NEVER set up; MLCC also ROTATES CODES — their portal showed
"Product code changed from 2836 to 5703"!). (2) Special-edition UPC
collision (Lions = Casamigos-combo class, new face). SHIPPED IN TREE
(undeployed): isMlccSpecialEditionName — base product now beats editions
in UPC resolution + mapping swap. BUILT: scripts/audit-upc-mappings.mjs —
audits EVERY mapping vs independent NRS source name (containment/size/
variant/edition scoring), verdicts OK/DEAD_CODE/SUSPICIOUS/BAD/UNVERIFIED,
CSV + summary; --apply deletes only BAD+DEAD_CODE (recoverable). MUST DO:
refresh price book NOW + cron-job.org FOREVER (steps re-given), run audit,
review CSV, deploy edition fix. Ranks WITH validate-speed as next session's
twin missions.

## 🔥🔥 #1 ACTIVE FOCUS — VALIDATE SPEED + RELIABILITY (Tony, 2026-06-10 night)

> "We have to increase the speed and reliability of validating the whole
> cart in every single aspect. Validating takes longer than actually
> scanning the bottles. It should be 30 seconds max — it literally just
> took like 4 minutes and came back as FAILED."

Witnessed: ~84-item cart, ~4 min validate → "MLCC validate finished as
failed." THE next major build (fresh session, full focus). Investigation
plan: (1) pull that run's ID in Command Deck Review — stage timings +
failure type tell us where 4 minutes went (queue wait? cold login? Stage 3
adds? MILO flake?); (2) suspects: worker cold session (LK_RPA_PERSIST
warm path is ~25-45s but cold is ~2min), single worker busy = queue delay,
Stage 3 per-item add time scaling with 84 items, MILO server slowness;
(3) levers: always-warm session per active store, scale worker count,
parallel/bulk Stage 3 add strategies, smarter retry-on-flake instead of
failing the whole run, aggressive background pre-validate so the
foreground tap is usually a cache hit; (4) pairs with the OBSERVABILITY
CENTER build — same session. Target: warm validate ≤30-45s, NEVER a
4-minute silent grind, failures explain themselves in one sentence.

### STATUS UPDATE (2026-06-13/14) — warm session confirmed working

Built `services/api/scripts/inspect-execution-runs.mjs` (stage-timing
inspector). Findings from real prod runs:

- **Cold path** (no held session, e.g. first run for a store since worker
  restart): ~42s fixed cost before Stage 3 even starts — Stage 1 login
  ~31s + Stage 2 navigate ~11s, identical regardless of cart size. Stage 3
  (add items) scales ~1.3s/item + ~11.5s base. A 2-item cart = 60.4s, a
  35-item cart = 105.1s.
- **Warm path (`rpa_session_reused`) — CONFIRMED FIRING 2026-06-14.** Two
  back-to-back runs for the same store (Colony, e594fc3a-...): 2nd run
  skipped Stages 1+2 entirely, total dropped to **25.1s for a 3-item
  cart** — under the 30s target. This is task #46 Phase A, already
  shipped, just hadn't been observed reusing in the wild until now.
- ⏳ **Remaining gap for big carts — slope confirmed on warm session.**
  Two warm-session data points: 3 items → Stage 3 = 20.5s; 7 items →
  Stage 3 = 26.1s. Slope ≈ **1.4s/item**, intercept ≈ 16.3s. For 84 items:
  16.3 + 1.4×84 ≈ **135s (2.25min) for Stage 3 alone**, +Stage 4 (~6-8s)
  ≈ **~2.4min total even fully warm** — much better than the 4min/failed
  Tony saw, but still way over the 30s target for big carts.
  - Suspect per-item overhead in `add-items-to-cart.js`'s per-item loop:
    a fixed 300ms wait after the code-input Tab, plus `waitForRowCountIncrease`
    polling every 200ms until the row renders. At ~500ms artificial wait
    per item × 84 ≈ 42s of the 135s is just these two waits. Tightening
    them is a real lever BUT both were added to fix specific flakes
    (silent drops, false-OOS) — touch carefully, with a real-MILO test,
    not a blind edit.
  - Also noted: queue wait spiked to 76.9s on this run (vs 3-5s earlier)
    — separate issue, possibly worker queue contention from running
    several validates back-to-back. Worth a look if it recurs.

### History check on the two Stage 3 waits (2026-06-13) — holding off

Read the git history for both waits before touching anything, per Tony's
"don't re-introduce a fixed bug" instruction:

- **`waitForRowCountIncrease`'s 200ms poll interval + its 18s cap
  (`DEFAULT_PER_ITEM_TIMEOUT_MS`)**: the cap was bumped 8s → 18s on
  2026-06-02 (`6d75d89`) specifically to fix a REAL production incident —
  Tony's Tito's 750ml false-OOS report, where an 8s wait expired right as
  MILO was slow, and the item got wrongly reported as out-of-stock. The
  200ms poll granularity itself isn't the cost driver (it only adds up to
  200ms slop); the cap is load-bearing for that incident.
- **The fixed 300ms wait after the code-input Tab** (`page.waitForTimeout(300)`):
  traced to the ORIGINAL Stage 3 implementation (`9c9072c`, 2026-04-24) — no
  specific incident ties to this exact 300ms value. It exists to let MILO's
  focus move to the qty input before we check `document.activeElement`,
  with a `qtyInput.focus()` fallback if it hasn't.

**Decision: hold off on editing Stage 3 timing for now.** Warm-session reuse
already meets the ≤30s target for realistic cart sizes (3 items = 25.1s,
7 items = 32.6s — both real production runs). The 84-item worst case
(~2.4min) is far better than the 4min/FAILED Tony originally saw, and per
the quality mandate (feature freeze, harden > build) this is optimization,
not a P0 — touching timing-sensitive RPA code carries real risk of
reintroducing the false-OOS flake (#61) for marginal gain on rare huge
carts. Revisit only if a real order with a big cart actually blows past
30-45s in practice.

## Tony's 2026-06-07 batch (stated after speed passes)

1. ⏳ **MLCC validate feels SLOW — #1 irritation.** "If someone validated on
   MLCC directly it's instant; on LK it always takes long. It really
   irritates me a lot." Goal: validate must FEEL instant.
   - REALITY (told Tony 2026-06-07): real MLCC validate is an RPA robot that
     re-adds every item into MLCC's cart + clicks validate. For a 72-item
     cart that's ~30-60s even warm. Can't be truly instant — MLCC's own site
     is instant only because the cart's already in their live session.
   - ✅ Warm session confirmed ON (`LK_RPA_PERSIST_SESSION=yes` on Fly) — so
     it's the ~25-45s warm path, not the 2-min cold one.
   - ✅ Bulk cart sync (2026-06-07) — new `POST /cart/:storeId/items/bulk`
     replaces the cart in ONE request; killed the 72 phone→API round trips
     in both foreground validate + background pre-validate. Resolves all
     identities first (no partial writes), replace semantics (no qty doubling).
   - ⏳ NEXT for the "feels instant" tap: (a) show the instant local rule
     result immediately on tap + staged progress (no dead spinner) while MLCC
     confirms in bg; (b) make a foreground tap REUSE an in-flight background
     pre-validate instead of racing a duplicate run.
2. ⏳ **AI = its own full page, not an overlay.** When you tap AI, it should
   be a standalone page — the scanner must NOT be visible behind it. (Was
   already ⏳ "AI becomes a real page route".)
3. ⏳ **AI accepts images** — send a photo from camera roll OR take one live,
   to the assistant. (Was already ⏳ "AI accepts images".)
4. **Catalog photos — every single bottle (13k+).**
   - ✅ **Premium placeholder shipped 2026-06-08** — glass-bottle art with
     brand monogram (apps/scanner/src/components/BottleArt.tsx), used in Browse
     grid + ProductCard. Killed the "ugly silhouette" complaint. Real photos
     render on top whenever image_url is set.
   - ❌ **Google Custom Search JSON API = DEAD END (2026-06-08).** Spent ~15
     turns: created project, enabled the API, linked billing, fresh unrestricted
     keys, disable/re-enable, 1hr+ propagation. STILL returns 403 "This project
     does not have the access to Custom Search JSON API" — even though the
     dashboard shows it Enabled with requests arriving (100% errors). Tony's
     config is CORRECT; it's a stuck/broken state on Google's side. DO NOT
     re-chase Google CSE. Also: "search the entire web" is deprecated, so CSE
     only ever covered curated retailer sites = partial coverage anyway. Script
     exists (services/api/scripts/backfill-mlcc-item-images-google.mjs) but is
     shelved.
   - ❌ **AI-generated bottle images = DEAD END for accuracy (2026-06-10).**
     Built `backfill-mlcc-item-images-ai.mjs` (gpt-image-1 + Claude vision
     verify), spot-checked FRIS VODKA 100 (code 100009) for $0.05: the model
     produced a generic flask that looks NOTHING like the real frosted
     triangular FRIS bottle, plus gibberish small text. The vision gate can
     check label spelling but CANNOT know real trade dress — this failure
     mode applies to thousands of niche SKUs. Tony's bar: "every single
     bottle has to be spot-on accurate" → only REAL photos qualify.
     DO NOT re-chase AI generation for catalog photos. Script kept for
     reference only. (Tony cleared the bad FRIS image_url via SQL.)
   - ⏳ **CURRENT PATH = Serper.dev (Google Images as an API) — REAL photos.**
     **Script BUILT 2026-06-10:** `services/api/scripts/backfill-mlcc-item-images-serper.mjs`.
     This IS the "just search Google for every bottle" Tony wanted — Google's
     own CSE is broken/deprecated, Serper returns real Google Images results
     as JSON. Pin-point verify (name-token containment ≥0.6 + size tolerance
     ±50mL + min 300px) → trusted-retailer domain ranking (TotalWine, OHLQ,
     Drizly…) → re-host to Supabase Storage → `image_source='serper_google_images'`.
     Most-scanned-first, prod-targeted (LK_PROD_* env), fills NULL only,
     concurrency workers, quota-abort. **2,500 searches FREE on signup;
     full 13.8k ≈ $4-14.** NEEDS: SERPER_API_KEY in services/api/.env.
     Fallback for no-match tail: BottleArt placeholder + /admin/catalog-images
     curation. (Possible free secondary sources if coverage disappoints:
     other control states' catalogs — OHLQ Ohio, Iowa ABD data.iowa.gov
     gckp-fe7r, VA ABC — all sell ~the same SKUs with pro photos.)
     **VISION GATE added same day** after the FRIS 80-vs-100-proof miss:
     Claude inspects every downloaded photo and rejects wrong brand/variant/
     proof/multi-packs; walks 3 candidates; no survivor → placeholder.
     Proven live: rejected the wrong FRIS, accepted the real 100-proof.
   - ✅ **PHOTO TRUTH LAYER — BUILT 2026-06-10 (in the undeployed batch).**
     Backend `routes/catalog-photo.routes.js`: POST /catalog/items/:code/photo
     (in-store capture → Storage `instore/` path → image_source='in_store',
     overrides backfill, audit-logged) + /photo-report (clears lying image
     NOW, image_source='reported_wrong' quarantines from backfill re-fills,
     audit-logged). Frontend: ProductCard "Snap the real bottle" (camera
     capture → downscale → upload) + "Wrong photo?" affordances under the
     image. Serper backfill skips reported codes. All verified
     (tsc/build/node --check). Original want: Tony: "even if it's the right bottle, what if the bottle
     looks different when it comes in? I don't want that happening AT ALL."
     Internet photos can't guarantee current trade dress. Plan (layered,
     image_source is the precedence key: `in_store` > `curated` >
     `serper_google_images` > placeholder):
     (a) **In-store photo capture in the scanner** — after a scan resolves
     to a SKU, one-tap "snap the real bottle" → uploads → becomes the
     canonical image for that code, overriding any backfill. Dad's store
     alone fixes the SKUs that actually matter; at hundreds of stores this
     self-builds a real-shelf photo library of the MI catalog NO competitor
     can replicate (moat).
     (b) **"Wrong photo?" report affordance** on ProductCard — one tap
     flags a lying image: clears/queues it for review (doctrine: loud
     failures, the catalog never lies silently).
     (c) Serper backfill stays as instant wide coverage; in-store truth
     replaces it SKU by SKU over time.
5. ⏳ **V1 must be ready for hundreds of stores — lightning fast + reliable
   as fuck — BEFORE launch.** Every feature, lightning fast. Scale + reliability
   bar. (Ties to the integrity doctrine + the known scale gaps: RPA
   concurrency, monitoring, KMS.)

---

## Command Deck (admin) — next-session TODO

- ✅ Premium dark "Command Deck" redesign shipped 2026-06-07 (sign-in, shell,
  founder console + health strip). Tony loved the look.
- ⏳ **Replace the token-paste sign-in.** It requires extracting a short-lived
  (~1hr) Supabase access token via browser console — Tony hit "Invalid or
  expired token" and it's bad UX. Build a real sign-in: email+password
  (Supabase signInWithPassword in the admin app) OR a long-lived Command Deck
  key. Goal: sign in once on the phone, add to home screen, stay in. Also
  verify his account has operator access for /operator-review/session.

---

## How Tony wants me to work with him (permanent operating rules)

- ✅ **"Keep pushing" mode is default.** Don't ask permission for next
  steps. Ship the next obvious thing. He'll redirect if I'm off.
- ✅ **Real features, not micro-iterations.** "U can do a lot of things
  at one time I believe in u." Batch related work.
- ✅ **Bedrock-then-billing.** Billing is DEAD LAST. Security, RLS,
  reliability come first. He wants "unbreakable" status before charging.
- ✅ **Direct edits over Cursor briefs** when feasible. Briefs only for
  genuinely big multi-file UI work he wants to do himself.
- ✅ **Fastest path first under deadline.** Ship the usable output;
  deep fixes become follow-ups, not blockers.
- ✅ **Never give placeholder commands** he might run literally
  (`<placeholder>` text is a footgun).
- ✅ **Always use `npm run deploy`** or `fly deploy --strategy immediate
  --wait-timeout 600`. Default 120s timeout fails every deploy on this
  810 MB image.
- ✅ **Cron routes register at app level BEFORE the auth-gated mount.**
  Otherwise X-Cron-Token bypasses 401.

---

## Product & vision wants

### Shipped ✅

- ✅ **Pre-submit verification modal** (discipline #3 in action). Tap
  Submit → full line-by-line summary: store name, license #, every
  bottle with name + size + qty + unit price + line total, MLCC's
  authoritative subtotal/tax/total, "this can't be unsent" warning,
  Cancel / Confirm buttons. **No opt-out, ever.** Kills integrity
  surfaces #1 (UPC mapping), #4 (phantom cart), #5 (vision picker).
  (#89, 2026-06-07)
- ✅ **Phone-first SaaS for Michigan liquor stores** integrating MLCC's
  MILO ordering portal via RPA.
- ✅ **Multi-store sign-up flow.** Landing page → signup form →
  auto-sign-in → activation modal → scanner.
- ✅ **Public landing page** at liquor-kings.fly.dev.
- ✅ **Privacy-conscious placeholders.** No real Colony or other-store
  data in public-facing forms ("Your store name" / "1234567").
- ✅ ~~**$119/month pricing** on the landing page (not $49).~~ **REVERSED
  2026-06-10 (Tony):** public dollar amount REMOVED from the homepage —
  competitors shouldn't read our pricing off the landing page. Now says
  "One flat monthly rate… full pricing shown at signup." Self-serve stays
  fully automated (NO "call us" — Tony explicit); exact price appears
  inside the signup flow before commitment. $119 remains the internal
  number + in ToS (legal disclosure; lawyer pass will revisit). In the
  undeployed batch.
- ✅ **Order time copy: "1.5-to-2-hour MLCC order → 5-to-10 minutes."**
  Not "30 min → 5 min."
- ✅ **Founder Console / Owner view / Data center.** Admin dashboard at
  /admin/founder-console — total stores, signups, MRR, recent runs,
  recent failures, 60s auto-refresh.
- ✅ **RLS bedrock confirmed.** 11/11 attack vectors blocked, real
  recursion bug found and patched.
- ✅ **Onboarding activation flow.** New signups verify MLCC creds via
  real RPA probe before touching the scanner.
- ✅ **Runtime store-id resolution.** Scanner correctly identifies the
  signed-in user's store at runtime (no more "Not a member of
  specified store" for new signups).
- ✅ **AI Assistant.** Data-grounded answers using actual store data —
  the defensible moat.
- ✅ **Universal tag printing.** Web Share API bypasses Brother QL-810W
  / iOS AirPrint die-cut-only limitation.
- ✅ **Dad's analytics dashboard.** Spend, biggest movers, top SKUs.
- ✅ **Order Templates.** Save + recall recurring carts. Auto-prepare
  on schedule (e.g. dad's Thursday weekly order).
- ✅ **Scanner Validate → Submit two-step.** Real cart state from MILO
  before checkout, never silent failures.
- ✅ **Vision document at docs/lk/BLUEPRINT.md.** The canonical "what
  LK is, why, who built it, where it's going, acquisition narrative"
  professional behind-the-scenes doc.
- ✅ **Saxon Inc reclassified.** Label company, not a software
  competitor — potential partner.

### In progress / next up

## 🔥🔥 MILO-style two-step ordering — Check, SEE, then Place (Tony, 2026-07-01, said while ARMED for the first real order)

> "So is there no more validate button, just one button to submit? I don't
> really like that. I wanna work just how MLCC does."

The armed cart currently collapses to ONE button ("Check Order" becomes
"Place Order"). Tony wants the MILO rhythm: **check the cart → SEE MILO's
answer (OOS, totals, delivery dates) → then deliberately place.** Two
explicit buttons, both always available when armed:

- **"Check with MLCC"** — always runs a validate_only (fast engine, ~5-15s
  today; ~3s after productId pre-map). Result sheet shows the full truth.
- **"Place Order"** — the armed submit, keeps the line-by-line confirm
  modal. After the engine gains submit (post 2026-07-01 capture), this is
  seconds too — check + place both instant = BETTER than MILO.

Safety note (why tonight was still safe with one button): the submit run
internally re-validates on MILO and Stage 5 physically refuses checkout on
any OOS / rule failure / cart mismatch — it can't send a cart MILO didn't
bless. The want is about *seeing before committing*, not about safety.

Status: ⏳ NEXT UI BUILD after the submit-endpoint capture.
**Design DECIDED by Tony 2026-07-01 (asked, he answered):**
1. **Place trusts a fresh check** — if the last check is recent (<~10 min)
   and the cart is byte-identical since, Place sends immediately, no
   silent re-verify (instant-feel). Server-side Stage-5 gates still apply
   regardless — this is UX speed, not a safety trade.
2. **Any cart edit LOCKS Place until re-checked** — MILO-style strictness;
   you can never send a cart MILO hasn't blessed. Together: check is
   always fresh, so trusting it is safe. Implementation note: hash the
   cart lines at check time; Place enabled only while (hash unchanged &&
   check age < threshold && check came back green).

**🔥 Active queue (from 2026-06-07 design feedback after tab bar shipped):**

- ✅ **CartDrawer premium overhaul** — the LAST core screen, built
  2026-06-10 (pending deploy in the day's batch). Bottom-sheet grab
  handle, header with product-count + total meta, SVG-only icons
  (trash/check/alert/spinner — last emojis killed), compact side-by-side
  Save/Load template tools, quiet text-style Clear cart, sticky checkout
  footer (Total + Validate + Submit pinned, checkout-style), classed
  validate-result panel + template picker (inline-style soup removed).
  Behavior 100% preserved — every handler/disabled/render condition
  verified identical; tsc + vite build green. Scoped under
  `.drawer--cart` so AssistantPanel/AnalyticsDashboard untouched.

- ✅ **Premium-feel pass #1: emoji icons → inline SVG.** Tab bar,
  More page rows, Templates trash + empty state, Scan cart icon, Sign
  out all use stroke-based currentColor SVG. New `Icons.tsx` is the
  canonical source. (#91, 2026-06-07)
- ✅ **AI Assistant promoted — hero card on Scan + top of More.**
  Purple gradient hero card with Sparkles icon, eyebrow + headline,
  Tap = opens existing assistant overlay. Same hero treatment at the
  top of the More page. The moat is now front and center. (#92,
  2026-06-07)
- ✅ **Scan page camera resized.** Aspect ratio 5:6 (was 4:3),
  max-height 62vh (was 52vh). Camera fills the screen, dead zone
  below shrinks. (#93, 2026-06-07)
- ⏳ **Templates: edit items inside a template.** Currently edit only
  changes name + schedule. Need to add/remove bottles, adjust qty
  per-line. Effectively make the template editable like a cart.
- ⏳ **Search → continuous dropdown of bottles.** When user types in
  the scan-page search bar, show a scrollable result list with "Load
  more" at bottom. Amazon-style typeahead.
- ⏳ **AI Assistant broader scope.** Currently the prompt is store-
  centric. Tony wants it to answer ANY liquor question (general
  knowledge, pairing, history, regulations across states, brand
  trivia) AND anything store-specific (orders, inventory, MLCC).
  Backend prompt + tool-use update.
- ⏳ **AI Assistant accepts images.** Send the assistant a photo for
  deeper conversation about what's in the picture. Vision API wiring.
- ⏳ **AI Assistant becomes a real page route.** Currently overlay; long
  term should be its own destination, not a modal. Then the AI tab
  highlights properly when active.
- ⏳ **Real product photos for all 13,000+ bottles in catalog.** No
  more placeholder bottle silhouettes. Strategy options: Google
  Custom Search Image API (~$65 for full catalog), distributor
  website scraping, manual curation via /admin/images, or a
  combination. NEEDS STRATEGY DECISION before execution.

- ✅ **Photos-first catalog ordering** (Tony, 2026-06-10: "any bottle that
  has a photo, push it to the top of the catalog"). BUILT same day, in the
  undeployed batch: generated `featured_sort` column (migration
  `20260610233000`) — default "Featured" sort = photographed bottles A-Z,
  then placeholders A-Z. Self-reordering as photo coverage grows (in-store
  captures and backfill writes recompute the column automatically). Also
  fixed: comma-in-name cursor pagination bug (quoted PostgREST predicate).
  RUN MIGRATION BEFORE NEXT DEPLOY.

**Earlier items (still active):**

- ✅ **Edit MLCC credentials post-signup.** Settings page + inline
  "Update MLCC credentials" button inside the activation failure
  modal. PATCH /auth/me/mlcc-credentials re-encrypts with AES-256-GCM
  and stamps mlcc_credentials_updated_at. (#86, 2026-06-06)
- ✅ **ToS + Privacy policy pages.** Plain-English drafts tailored to
  LK + Michigan MLCC context. Served at /terms and /privacy with
  brand-matching styling. Footer links on landing page. **Get a
  lawyer to review before broad public launch.** (#87, 2026-06-06)
- ⏳ **Custom domain liquorkings.com** pointed at Fly. **Step-by-step
  runbook at [docs/lk/runbooks/CUSTOM-DOMAIN-LIQUORKINGS.md](runbooks/CUSTOM-DOMAIN-LIQUORKINGS.md).**
  Mostly DNS work — needs Tony to register/own the domain. ~5–15 min
  hands-on, then cert provisioning runs in background.
- ✅ **Persistent activation state.** Any successful RPA run now stamps
  `stores.mlcc_credentials_last_verified_at`. Backfilled for existing
  stores with prior orders (dad's, mine). Scanner home shows a soft
  amber "Verify your MLCC connection" banner when null — one-tap
  probe via `cart_reset_only` clears it. Survives refresh, device
  switch, account-skip-of-activation. (#88, 2026-06-06)
- ⏳ **Real Sentry DSN setup** (replace placeholder).
- ⏳ **Daily cron setup** for price-book freshness + template scheduler.
  Code-side DONE (2026-06-14): `.github/workflows/lk-daily-cron.yml`
  added — GitHub Actions hits `/order-templates/run-scheduler` (~5am ET)
  and `/price-book/check-updates` (~6am ET) daily, no cron-job.org
  signup needed. Tony's 2-min part: read back `LK_CRON_SECRET` from Fly
  (`fly ssh console -a liquor-kings -C "printenv LK_CRON_SECRET"`) and
  add it as a GitHub repo secret of the same name. See
  [docs/lk/sentry-and-cron-setup.md](sentry-and-cron-setup.md) §0.

- ⏳ **OBSERVABILITY CENTER — "capture every single little detail" (Tony,
  2026-06-10).** Dev-facing control center: every action in the system
  gets an event row with a pullable ID — customer says "something went
  wrong" → pull the run/event ID → see exactly what happened. Includes
  funnel/attribution telemetry: signup clicks, IPs, device, timestamps.
  ALREADY EXISTS (build on, don't duplicate): execution_runs (per-run ID +
  stage evidence + artifacts + heartbeats — already pullable in Command
  Deck Review), lk_system_diagnostics (auth failures, store mismatches,
  photo events), upc_match_audits + upc_lookup_logs (every scan),
  mlcc_price_book_runs, /admin/health, Sentry hooks (DSN pending).
  THE GAP: (a) one unified `lk_events` append-only table (event_id, ts,
  store_id, user_id, ip, user_agent, kind, payload jsonb) + tiny
  middleware emitter; (b) landing/signup funnel events incl. IP; (c)
  Command Deck "Events" explorer with search-by-any-ID; (d) privacy
  policy update to disclose IP/telemetry collection (required). BUILD IN
  A FRESH SESSION — first item alongside the MILO delta-check.
- 💡 **Enterprise / chain accounts (Tony, 2026-06-10):** sell to big names
  (he named Meijer/Kroger-class + local chains like Arden's/Jake's) at
  way above $119. Realistic ladder: independents → MI family-owned chains
  (3-20 stores; multi-store dashboard, chain pricing — STRONG near-term
  segment) → regional grocers (needs SOC2-type posture, procurement
  cycles, maybe EDI). Doctrine work doubles as the security story.

### Future / V2 / post-launch
- 💡 **Inventory management.** Par levels, on-hand quantity, reorder
  points, low-stock alerts. Tony confirmed 2026-06-07 this is the
  NEXT real feature after the tab bar redesign. Promotes to its own
  bottom tab once built.
- 💡 **Quantity anomaly detection.** Warn the user before submit if
  any SKU quantity exceeds 3x the store's historical average. Cheap
  to build, doctrine-compliant trust-builder. Surfaced inside the
  pre-submit verification modal.
- 💡 **First-order pre-flight checklist.** For brand-new signups,
  one-time guided walkthrough before their first real MLCC order:
  "verify creds connected ✓, verify product mapping ✓, dry-run
  validate ✓, confirm store name ✓, then submit." Onboarding polish.
- 💡 **Per-store reporting expansion.** Order velocity, ADA spending
  breakdown, seasonal patterns, biggest-mover trends. Founder Console
  has this for Tony's view; customer-facing per-store version is its
  own feature for the dashboard tab.
- 💡 **POS register integrations.** Tony explicitly called this out as
  a future direction.
- 💡 **Prepare the acquisition narrative.** Who could buy LK, why they
  would, what they'd want to see in due diligence. Already in
  BLUEPRINT.md but stays a live consideration.
- 💡 **Scale to other states** beyond Michigan after MI proves the
  model.
- 💡 **Multi-staff teammate visibility** (currently RLS is own-row only
  for V1 single-owner stores).
- ~~💡 **Store-chooser UI** for users belonging to multiple stores~~
  **PROMOTED TO V1 — Tony, 2026-06-10: "multi-store has to be a version
  one feature, that was always in my vision."** Requirements:
  (a) one OWNER account holds multiple stores — additional stores must be
  under the SAME person's account (not separate people);
  (b) pricing: first store at base price, each additional ~$80/mo
  (CONFIRM base number with Tony — voice note said "$190", locked price
  history says $119);
  (c) store switcher in the scanner (the middleware + store_users are
  ALREADY multi-store; client currentStore.ts just picks first — needs
  picker UI + X-Store-Id plumbing which already exists);
  (d) "Add another store" flow: new endpoint creating store + membership
  + MLCC creds + activation probe for the second license;
  (e) later: chain-level dashboard (cross-store analytics) — V1.5/V2.
  Build order: backend add-store endpoint → switcher UI → billing tiers
  when Stripe lands.
  **STATUS 2026-06-10 EOD: (c)+(d) BUILT same day, in the undeployed
  batch.** Backend: GET/POST /auth/me/stores (same-owner enforced via
  session user, duplicate-license 409, rollback-safe). Frontend (Cursor,
  verified KEEP): Settings "Your stores" switcher (setCurrentStoreId +
  clearAllCache + home redirect) + Add-store modal riding the existing
  VerifyMlccBanner activation. REMAINING: (b) billing tiers w/ Stripe;
  (e) chain dashboard. PRICING CONFIRMED 2026-06-10: $119 base store,
  ~$80 each additional ("$190" was a voice-to-text artifact).

---

## Hard preferences / never-forget vibes

- ✅ **Dark UI.** Premium feel. No bright/light themes by default.
- ✅ **Mobile-first.** Dad uses an iPhone in the store. iOS Safari
  is the primary target.
- ✅ **No real customer data in public spaces.** Generic placeholders
  always.
- ✅ **Billing comes AFTER unbreakable.** Stripe is the last thing,
  not the first.
- ✅ **Saxon is a partner candidate**, not a competitor. They make
  labels; we make ordering software.
- ✅ **The data-grounded AI assistant is the moat.** Don't make it
  generic ChatGPT — make it know YOUR store's data.

---

## How this file gets updated

- When Tony states a new "want" — feature, rule, vibe — add it to the
  appropriate section.
- When a wanted thing ships to prod, mark it ✅ and move to "Shipped."
- When a "want" is invalidated or changes, update it in place (don't
  silently delete; cross out and note why if it's a notable reversal).
- This file is permanent and version-controlled. The journal in memory
  references it. Both should stay in sync.
