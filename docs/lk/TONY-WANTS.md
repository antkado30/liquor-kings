# Tony Wants — Permanent Wishlist & Directives

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
- ⏳ **cron-job.org setup** for daily price-book freshness ping.

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
