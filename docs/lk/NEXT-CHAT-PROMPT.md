# Liquor Kings — System Review & New-Chat Bootstrap

> **Tony:** paste the COPY-PASTE BLOCK below as your first message in a new
> chat. Everything after it is the system review — the new Claude can read
> this whole file to know what LK is. Bootstrap block last rewritten
> **2026-07-14** (by Fable, mid-session, two days before the 7/16 order day).

---

## COPY-PASTE THIS BLOCK 👇

```
We're picking up Liquor Kings — a multi-tenant B2B SaaS for Michigan liquor
stores that places MLCC spirits orders automatically via Playwright RPA. I'm
Tony, the 19-year-old solo founder. You are Fable 5 — my coworker, not a
chatbot. Connect the repo folder FIRST if it isn't already:
~/dev/liquor-kings.

BEFORE responding to anything, read these in order (all under docs/lk/):
1. RULEBOOK.md — the unbreakable rules; the session ritual is §4
2. journal.md — NEWEST entry first: current state + next list
3. STATE-OF-LIQUOR-KINGS.md — the census (✅/🟡/💀/❓ per system)
4. TONY-WANTS.md — Quality Mandate at top, then every want
5. INTEGRITY-DOCTRINE.md — the bar (12 disciplines + hardening mandate)
6. architecture/ordering-speed-strategy.md — the R3 engine plan
7. If an order day is near: runbooks/order-day-<date>.md

Then VERIFY the repo yourself — never trust memory over the tree:
- git --no-optional-locks log --oneline -8   (ALWAYS --no-optional-locks:
  plain git reads from your sandbox leave a stale index.lock that blocks
  my commits; if I ever hit index.lock with no git running, that's it —
  rm ~/dev/liquor-kings/.git/index.lock)
- git --no-optional-locks status             (tree should be clean)

THE OPERATING DEAL (full text in RULEBOOK — these are the load-bearing ones):
- PROD Supabase is eamoozfhqolshdztbrez — verify by ID, never name. DB
  reads go through one-liners I run: node --input-type=module from
  services/api, dotenv, LK_PROD_SUPABASE_URL/_SERVICE_ROLE_KEY, print the
  target host first, COUNT queries only (PostgREST caps un-paginated
  selects at 1,000 silently — we have the scars).
- I do ALL git and ALL deploys. You make direct edits + audit yourself
  (node --check + scanner tsc/vitest/build run in your sandbox; API vitest
  runs on MY Mac only). Batch deploys — never per change.
- Exact commands only, NO placeholders, each with one plain line of what
  it does. Include the cd IN the command — I run them from anywhere.
- ONE writer in the repo at a time. No emoji in the UI. Prove before
  trust: only me seeing it work on device = fixed.
- When I'm overwhelmed: ONE small thing at a time. Deciding what's next
  is your job, not mine.

Read the room, tell me you're caught up in plain English, and give me ONE
next step (the journal's NEXT list has the queue).
```

---

# FULL SYSTEM REVIEW

> **Freshness note (2026-07-14):** this review is a **2026-06-10 snapshot**.
> The bones — what LK is, the pillars, repo layout, the two-Fly-app split —
> are still true. Counts and feature states have moved on (family-first
> catalog, premium cards, photo truth pipeline, two-step ordering, new-item
> ingest, 295 extra SKUs…). For CURRENT state trust the living docs:
> RULEBOOK → journal → STATE-OF-LIQUOR-KINGS → TONY-WANTS. They are
> maintained every session; this review is not.

## What Liquor Kings is

A multi-tenant SaaS that lets a Michigan liquor-store owner **scan bottles to
reorder**, then **automatically places the order through MLCC's MILO website**
(Michigan is a control state — all spirits go through MLCC; there is no other
wholesaler). The owner reviews/approves the cart; LK logs into MILO via browser
automation, builds the cart, validates MLCC's rules, submits, and returns the
confirmation number. Public-launch target: **Nov 21, 2026**. The near-term play:
modernize the family store ("Colony Party Store", MLCC license 430342), sell it
summer 2026, scale the SaaS.

## The four V1 pillars
1. **Ordering automation (RPA)** — the moat's hard part. DONE + hardened.
2. **Scanner** — the customer-facing PWA (scan → cart → submit).
3. **Shelf-tag printing** — Brother QL-810W MLCC price tags.
4. **AI assistant** — data-grounded liquor + store expert. The differentiator.

## Repo layout (monorepo, npm workspaces)
```
liquor-kings/
├─ apps/scanner/      → customer PWA (React 19 + Vite + react-router v7, base /scanner/)
├─ apps/admin/        → operator "Command Deck" (base /operator-review/app/)
├─ services/api/      → Express API + serves both SPAs + RPA code
├─ supabase/migrations/ → 42 SQL migrations (the DB schema)
├─ docs/lk/           → all the docs (this file, BLUEPRINT, doctrine, specs, runbooks)
├─ scripts/           → audit/verify/seed/doctor tooling (see `npm run audit:lk*`, `verify:lk*`)
├─ Dockerfile         → slim web/API image (node:22-bookworm-slim, ~117 MB)
├─ Dockerfile.worker  → Playwright/Chromium image for the RPA worker
├─ fly.toml           → app `liquor-kings` (web/API)
└─ fly.worker.toml    → app `liquor-kings-worker` (RPA)
```

## Architecture — TWO Fly apps (worker split, shipped 2026-06-08)
- **`liquor-kings`** — web + API. Slim image (~117 MB), `node:22-bookworm-slim`,
  no Chromium. Serves the API, the scanner SPA (`/scanner/*`), and the admin SPA
  (`/operator-review/app/*`). Fly machine: shared CPU, 1 vCPU, **1024 MB**, region
  **ord**, `auto_stop_machines = "off"`, `min_machines_running = 1`. Deploy: `npm run deploy`.
- **`liquor-kings-worker`** — the RPA worker. Playwright image. Polls the API for
  queued execution runs over HTTP, claims them atomically, drives MILO with a warm
  Playwright session. Scale with `fly scale count N -a liquor-kings-worker` (atomic
  claim makes concurrency double-order-safe). Deploy: `npm run deploy:worker`.
  Worker entry: `services/api/src/workers/run-rpa-worker.js`.

## The RPA pipeline (Pillar 1 — DONE + hardened)
Worker claims a queued `execution_runs` row → `services/api/src/workers/execution-worker.js`
runs 5 stages against MILO (`services/api/src/rpa/stages/`):
1. **login.js** — sign into MILO (retries transient network errors, never bad creds).
2. **navigate-to-products.js** — reach the products page.
3. **add-items-to-cart.js** — add each line; v2 cart verification (active/OOS split,
   quantity match); auto-clears a stale cart pre-flight.
4. **validate-cart.js** — MLCC rule validation; typed errors (BELOW_9L_MINIMUM,
   INVALID_SPLIT_QUANTITIES) + banner extraction.
5. **checkout.js** — real submission. **Triple-gated** before any real order:
   `payload.metadata.mode === 'submit'` AND `LK_ALLOW_ORDER_SUBMISSION === 'yes'` (Fly
   env kill-switch) AND `stores.allow_order_submission === true` (per-store arming).
   Any gate off → dry_run.
- **Warm session reuse** (`rpa-session-manager.js`, `LK_RPA_PERSIST_SESSION=yes`):
  same-store re-runs skip re-login.
- **Orphaned-run reaper**: `reapStaleExecutionRuns` marks `running` rows with a
  >15-min-stale heartbeat as `failed` (never auto-requeued — a crashed worker may
  have partially submitted; double-order risk). Self-heals on every `/claim-next` poll.
- MLCC ordering rules: ≥9 L **per ADA** (distributor) per order; split-case quantities
  vary by bottle size; one bad line blocks the whole cart. ADA 221 = General Wine &
  Liquor, ADA 321 = NWS Michigan. Rules live in `mlcc_rules` (29 rows) + the runtime
  engine `services/api/src/mlcc/milo-ordering-rules.js` / `lib/mlcc-rules.js`.

## Database (Supabase — prod project `eamoozfhqolshdztbrez`)
⚠️ A second project `vgilembychlcldhzqqeq` exists and is NOT prod — always confirm
against Fly's `SUPABASE_URL` before any DB work. The API connects with the
service-role key (bypasses RLS). 42 migrations.

Key tables: `stores`, `store_users` (multi-tenant membership, role+is_active),
`mlcc_items` (the ~13K-SKU catalog), `bottles`, `carts`, `cart_items`,
`execution_runs` (+ `_attempts`, `_operator_actions`), `order_templates`,
`inventory`, `milo_order_confirmations`, `mlcc_rules`, `mlcc_brand_aliases`,
`mlcc_price_book_runs`, `upc_lookups`, `pilot_ops_*` (operator workflow).

Notable schema details:
- `mlcc_items` unique key is **(code, ada_number)** — `code` ALONE is NOT unique
  (a SKU can have multiple distributor rows). Querying by `code` with `.single()`/
  `.maybeSingle()` 500s on multi-ADA SKUs — the "Smirnoff bug" class. Always
  `.order("ada_number").limit(1).maybeSingle()`.
- Generated columns on `mlcc_items`: `name_normalized` (punctuation-stripped, keeps
  spaces) and **`name_searchable`** (fully space/punctuation-free — added 2026-06-09
  so "RumChata" ⇄ "Rum Chata" match). Both have btree + trigram (pg_trgm) indexes.
- `cart_items` now has **UNIQUE (cart_id, bottle_id)** + an atomic
  **`add_cart_item(...)` RPC** (INSERT…ON CONFLICT DO UPDATE += qty). Add-to-cart
  goes through that RPC — race-safe, no dup rows.
- Price book: `mlcc-price-book-ingestor.js` ingests MLCC's xlsx, detects price
  changes, stamps `price_changed_at`. Auto-update via `POST /price-book/check-updates`
  (gated by `LK_CRON_SECRET`; needs a cron-job.org daily ping).

## API (Express — `services/api/src`)
- Entry: `index.js` → `app.js`. Auth middleware: `middleware/resolve-store.middleware.js`
  (`resolveAuthenticatedStore`) — reads the Supabase JWT or a service-role bearer,
  resolves `store_id` via `store_users`, attaches `req.store_id`. As of 2026-06-09 it
  **verifies the JWT locally** (`lib/access-token.js`, HS256, dependency-free) when
  `SUPABASE_JWT_SECRET` is set, falling back to `supabase.auth.getUser()`. **The
  secret is NOT set yet** — set it to remove a per-request network hop (instant-feel).
- Route files (`routes/`): admin, assistant, auth, bottles, browse, cart, cart-lifecycle,
  cart-summary, catalog-vision, execution-runs, home, inventory, nrs-import, nrs-review,
  operator-review, order-templates, orders, price-book, store-mlcc-credentials, tags.
- AI assistant: `lib/assistant.js` (Claude tool-use, 7 tools: query_catalog, query_rules,
  price_quote, query_order_history, query_inventory, check_order_quantity, validate_cart)
  + `routes/assistant.routes.js` (`POST /assistant/ask`). System prompt retuned 2026-06-09
  to be SHORT, table-free, premium (see feedback_ai_tone_premium). Vision bottle-ID:
  `routes/catalog-vision.routes.js` (`POST /catalog/identify-from-image`, Claude vision →
  ranked `mlcc_items` candidates; returns `extracted{brand,product_name,size_label,size_ml}`).
- Credential encryption: `lib/credential-encryption.js` (MLCC passwords; key in
  `LK_CREDENTIAL_ENCRYPTION_KEY` env — **KMS is the last named scale gap**, still TODO).

## Scanner frontend (`apps/scanner/src`)
- 10 pages: Scanner (home), Browse (catalog), Cart, Orders, OrderDetail, Templates,
  Inventory, Settings, Assistant, More. Routed in `App.tsx` — all lazy-loaded +
  idle-prefetched (Scanner eager).
- Key components: BottomTabBar (🏠 Scan · 📚 Catalog · 🛒 Cart · ✨ AI · ☷ More — shape
  is LOCKED), CartDrawer, ProductCard, BarcodeScanner (native BarcodeDetector + ZXing
  fallback, any-angle + scan-from-photo), VisionCandidatePicker, AssistantChat,
  AnalyticsDashboard, OnboardingActivation, MlccCredentialsForm, BottleArt (premium
  SVG bottle placeholder), Icons (all inline SVG — NO emoji UI, ever).
- API clients in `api/`, hooks in `hooks/` (useCart, useSubmission, useCatalogSearch,
  useBackgroundPreValidate, useMlccVerifyProbe, useLockBodyScroll, useHideTabBar,
  useOnlineStatus), lib in `lib/` (supabase, currentStore, **swr.ts** = the
  stale-while-revalidate cache that makes tab switches instant, downscaleImage,
  mlcc-ordering-rules, product-freshness).
- Auth: real Supabase Auth (`lib/supabase.ts` + `AuthGate.tsx`). Multi-tenant via
  `store_users`; the active store id lives in `lib/currentStore.ts` + `X-Store-Id`.

## Admin app (`apps/admin`)
Operator "Command Deck" at `/operator-review/app/` — for reviewing UPC→MLCC mappings,
ambiguous matches, pilot-ops. Not customer-facing.

## Deploy & ops
- **Deploy:** `npm run deploy` (web/API) = `fly deploy -a liquor-kings --strategy rolling
  --wait-timeout 900`. `npm run deploy:worker` for the RPA app. ALWAYS use these (the
  default 120s timeout fails on this image — see feedback_fly_deploy_flags).
- **Migrations BEFORE code:** if a change references a new column/RPC, run the migration
  in the prod Supabase SQL editor FIRST, then deploy. (Claude's Supabase MCP can't write
  prod — permission-denied — so Tony runs migrations by hand.)
- The deploy CLI often prints scary `health check timeout` / `not listening on 8080`
  warnings that are just mid-rollout snapshots — ALWAYS verify with
  `fly status -a liquor-kings` (look for the new version + checks passing) and a curl.
- **Build from the working tree** — `fly deploy` doesn't need a git commit, but commit
  for hygiene. Committing from Claude's sandbox can leave a stale `.git/index.lock`;
  Tony runs `rm -f .git/index.lock` before committing.
- Secrets (Fly, names only — never commit values): `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `LK_CREDENTIAL_ENCRYPTION_KEY`,
  `ANTHROPIC_API_KEY`, `LK_ALLOW_ORDER_SUBMISSION`, `LK_RPA_PERSIST_SESSION`,
  `LK_CRON_SECRET`, and (to set) `SUPABASE_JWT_SECRET`. Scanner build-time:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SCANNER_STORE_ID`.

## Current prod state (2026-06-10)
App version **142**, image `…JJ3Y3E`, 1/1 healthy. The 2026-06-09 batch is LIVE:
premium AI tone, vision size-extraction, spacing-proof search + photo-ID
(name_searchable), atomic cart-dup fix (add_cart_item RPC), MorePage cleanup, and
premium Orders / Order Detail / Inventory / Settings / Assistant pages, plus the
smart vision picker and any-angle barcode. Two migrations were applied first.

## What's pending / next (read project_journal + project_next_session for the live list)
- **CartDrawer premium overhaul — BUILT 2026-06-10, in the undeployed batch.**
  Sticky checkout footer, drawer-tools row, SVG-only icons, scoped `.drawer--cart`
  CSS. Behavior preserved + verified.
- **Set `SUPABASE_JWT_SECRET`** — lights up the dormant local-JWT auth speedup.
- **AI-generated catalog photos** — 13K SKUs still have no real images; Google Custom
  Search image API was a DEAD END (persistent 403). Open problem.
- **Multi-page tag PDF** — do WITH Tony at the Brother printer (tag code is finicky).
- **KMS** for credential encryption — last named scale gap (key currently in env).
- **Phone smoke-tests** of the latest batch when convenient.

## Doctrines & how Tony works
- **Integrity Doctrine:** "No leaks, no breaks, no nothing. Bugs can't survive." 12
  disciplines (INTEGRITY-DOCTRINE.md). Verify everything (tsc/build/node --check/logic
  proofs) before claiming done.
- **Scan for similar bugs:** one bug found = grep the whole codebase for that class and
  fix every instance in the same pass.
- **Premium feel:** NO emoji UI — inline SVG only. Stripe/Linear/Notion bar. AI replies
  short + table-free.
- **Instant feel:** perceived latency is a bug. SWR cache + code-split shipped; auth
  round-trip fix dormant pending the secret.
- **Batch deploys:** build + verify all day; deploy ONCE when Tony wants to ship. Don't
  end every turn with a deploy command.
- **Build immediately + parallelize:** when Tony states a want, build it that turn; run
  me + a Cursor agent on DISJOINT files with strong briefs. (NOTE 2026-06-10:
  "Kais" was a voice-to-text mishearing of "Cursor" — there is no agent named
  Kais.) Cursor has a
  Keep/Undo gate — tell Tony Keep or Undo, and verify the combined tree before Keep.
- **External memory:** Tony's working memory is unreliable by his own account — capture
  every want into TONY-WANTS.md immediately, surface the next ⏳ proactively, never ask
  him to recall. Write a full EOD journal entry at the TOP of project_journal.md at
  every closeout (no reminder needed).
- **Be the advisor:** keep him in check, flag good stopping points, take the L on
  mistakes without deflecting. Family motivation (retire his parents this summer) is real.

## Note on the model switch (2026-06-09/10)
Tony moved from Opus 4.8 → **Claude Fable 5** (Anthropic's public "Mythos-class" model,
released 2026-06-09). Fable 5 is materially stronger on long, complex, autonomous coding
(SWE-Bench Pro ~80% vs Opus 4.8 ~69%) at ~2× the API price. For LK's large-codebase,
reliability-critical work that's a good trade. The in-PRODUCT assistant model (the
`/assistant` endpoint) is a SEPARATE, cost-sensitive decision — keep it cheap there.
```
