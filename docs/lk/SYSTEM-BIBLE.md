# LIQUOR KINGS — SYSTEM BIBLE

**A living master reference. Any bot or human booting into this project
reads this and knows the whole system: what it is, how it's wired,
every database table, every feature, every law.**

Written 2026-08-05 (order-day-eve) from the source of truth: the
migrations, routes, and code at commit `7564175`. Update this file when
the system materially changes; the dated handoffs in `docs/lk/handoffs/`
carry session-by-session state on top of it. Boot ritual:
`2026-07-19-BOOT-PROMPT.md` → newest closeout in `handoffs/` → THIS
FILE → `RULEBOOK.md` (Rule 28, the Operator Split, governs how to work
with Tony).

---

## 1. WHAT THIS IS

**Liquor Kings** is B2B SaaS that automates liquor ordering for
Michigan liquor stores against **MLCC/MILO** (the Michigan Liquor
Control Commission's ordering system — the state is the ONLY liquor
wholesaler in Michigan; every store must order through MILO). The
product: scan bottles / speak an order / browse a live catalog → build
a cart → **Check** it against MILO (live stock + real pricing, never
submits) → **Place** it (a real order, real money).

First customer: **Colony Party Store** — Tony's family's store
(store id `e594fc3a-17b7-45d0-9dde-943ebbfa5391`, license in DB).
Real money flows through this system. Competitor landscape: one real
competitor (Saxon); the AI/memory layer is the moat.

**Tony** (Antonios Kado, 19, founder, non-engineer operator) runs ALL git, deploys,
and prod SQL with his own hands ("one-writer law"). The AI partner
("Fable") writes code onto his Mac via the device bridge and hands him
labeled commands — ONE action per message, proofs designed as
30-second phone checks. `samkado@gmail.com` is a MILO credential, NOT
an app login.

## 2. TOPOLOGY

| Piece | Where | Notes |
|---|---|---|
| **API + web** | Fly app `liquor-kings` (2 machines, ord) | Express ESM, Node 22. Serves everything below. |
| — Landing page | `https://liquor-kings.fly.dev/` | Static marketing HTML (`lib/landing-page.js`). **NOT the app.** |
| — **Scanner PWA** | `/scanner/` | THE product. React 18 + TS + Vite, served same-origin. index.html no-store; hashed assets cached 1y. Tony runs it as an iOS home-screen PWA. |
| — Admin (operator review) | `/operator-review/app` | Second Vite app (`apps/admin`). |
| **Worker** | Fly app `liquor-kings-worker` (1 machine) | Playwright/Chromium daemon. Claims `execution_runs` from the API over **Fly private 6PN**: `API_BASE_URL=http://liquor-kings.internal:8080` (2026-07-31 — killed the public-edge 20s claim timeouts). Loop watchdog: 20 min without a completed loop iteration → exit(1) → Fly restarts. Deploys take ~10 min BY DESIGN (Chromium image) — never ctrl-C. |
| **Database** | Supabase project **`eamoozfhqolshdztbrez`** (PROD — verify by ID, never name) | Postgres + RLS + auth. THE connected Supabase MCP in Claude sessions is Tony's OTHER account (Kado HQ) and does NOT contain prod — all prod SQL goes through Tony in the dashboard SQL editor. |
| **Monitoring** | Sentry org `liquor-kings` | API + scanner DSNs baked at build. |
| **Cron** | cron-job.org → `POST /price-book/check-updates` daily (LK_CRON_SECRET) | Catalog auto-update; also `POST /order-templates/run-scheduler`. |
| **Repo** | github.com/antkado30/liquor-kings (private, main) | Monorepo: `apps/scanner`, `apps/admin`, `services/api`, `supabase/migrations`, `docs/lk`. |

**Deploys** (Tony only): `npm run deploy` = API app (serves scanner+admin
too); `npm run deploy:worker` = worker. Post-2026-08-04 fly-CLI war:
brew has flyctl 0.4.78 (Depot path OK; its classic builder is broken);
a pinned **0.4.74 lives at `~/.fly/bin/flyctl`** — the known-honest
fallback is `~/.fly/bin/flyctl deploy -a liquor-kings --strategy
rolling --wait-timeout 900 --depot=false --build-arg GIT_SHA=$(git
rev-parse --short HEAD)`. **LAW (2026-08-12): deploys run from the REPO
ROOT (`cd ~/dev/liquor-kings`)** — running from services/api broke the
remote builder ("failed to parse daemon host") and uploaded a 361MB
context (no .dockerignore there; the root one excludes node_modules/
rpa-output). Root context is ~2MB. **Deploy verification (#30 DONE, live 8/10): `curl -s
https://liquor-kings.fly.dev/health` returns `git_sha` — must match
`git rev-parse --short HEAD`. One line, zero phantom doubt.** The
mid-rolling "app is not listening" fly WARNING is a benign timing
artifact seen on every deploy. (Fly CLI sessions expire — a deploy
may open a browser re-login first; normal.)

**Bars**: vitest on Tony's Mac is the only test run that counts.
Current (2026-08-12 close, pending batch): API 855/855 (72 files),
scanner 214/214 (28 files), tsc clean. Prod (643b4d0) was cut at
812/214. Sandbox full-suite runs need dummy `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` exported (no .env there).

## 3. THE DATABASE — every table (source: `supabase/migrations/`, 64 migrations)

Live row-level data is inspected via Tony in the prod SQL editor (or
the app's own surfaces); the schema below is the always-true map.

### Identity & stores
- **`stores`** — the tenant. `id`, `name`/`store_name`, `liquor_license`,
  `mlcc_store_number`, `mlcc_username`, `mlcc_password_encrypted`
  (AES via LK_CREDENTIAL_ENCRYPTION_KEY), address fields, `timezone`,
  `is_active`, `mlcc_credentials_last_verified_at`, and
  **`allow_order_submission`** — the per-store real-money gate
  (Colony = TRUE since 2026-08-04; Tony holds the keys).
- **`store_users`** — membership: `store_id`, `user_id` (Supabase auth),
  `role`, `is_active`. RLS everywhere keys off this.

### The MLCC catalog
- **`mlcc_items`** — THE catalog (~13.8k rows, upserted from price
  books). Composite identity `(code, ada_number)` — the same liquor
  code can exist under multiple ADAs. Columns: `code`, `name`,
  `mlcc_item_no`, `size_ml`, `category`, `subcategory`, `abv`,
  `state_min_price`, `upc`, `proof`, `bottle_size_ml`,
  `bottle_size_label`, `case_size`, `base_price`, `licensee_price`,
  `min_shelf_price`, **`previous_licensee_price`** (price memory,
  2026-08-01: what it cost last book — drives the "was $X" chip),
  `ada_number`, `ada_name`, `brand_family`, `is_active`,
  `last_price_book_date`, `price_changed_at`, `is_new_item`,
  `image_url`, `image_thumb_url` (~360px WebP grid thumbs),
  `name_normalized`, `name_searchable` (trigram search),
  `featured_sort` (popularity), family-engine columns `family_key`,
  `container`, `pack_count`, `is_combo` (one card per product line),
  scan-tracking counters.
- **`mlcc_price_book_runs`** — ingest ledger: `price_book_date`,
  `source_url` (change detection compares this), `total_items`,
  `new_items`, `updated_items`, `status`
  (`complete`/`complete_with_errors`/`failed`), **`kind`**:
  `full` | `new_item_list` | `retail_price_changes` | `ada_changes`
  (the last two auto-ingest since 2026-08-04 — Tony's "always current
  in all aspects" mandate; each kind compares against its own ledger).
- **`mlcc_rules`** — MLCC's ordering rulebook as data: `rule_type`
  (order_minimum/size_quantity/workflow/account/stock/return/pricing),
  `code` slug, `parameters` jsonb (e.g. min 9L per ADA), source
  quotes/URLs for auditability. Drives cart validation + the AI.
- **`mlcc_brand_aliases`** — common name → MLCC name ("jack" → "JACK
  DANIELS...") feeding search + resolver.
- **`mlcc_code_map`** / **`mlcc_item_codes`** — code lineage over time
  (codes get reassigned across books; fingerprint + validity windows).

### Barcode / UPC intelligence
- **`upc_mappings`** — UPC → mlcc_code, THE scan truth. `confidence_source`
  (`user_confirmed`/`auto_high_score`/`bulk_seed`/`manual_admin`),
  `scan_count`, `flag_count`, timestamps. ~97% catalog coverage
  bootstrapped from MLCC's own price-book TXT (Entry #2).
- **`upc_lookups`** — external lookup cache (UPCitemdb etc.), raw API
  responses kept.
- **`upc_match_audit`** — every scan-match decision with scoring
  breakdown + user flags ("wrong bottle") for tuning.
- **`nrs_ambiguous_review`** — NRS-import UPCs whose match was
  ambiguous: top candidates jsonb, pending/resolved/skipped workflow
  (admin routes).

### Carts & ordering (the money path)
- **`carts`** — store cart lifecycle: `status`, validation/execution
  status + timestamps, `receipt_snapshot` jsonb, `external_order_ref`.
- **`cart_items`** — lines: `cart_id`, `bottle_id`, `mlcc_item_id`,
  `quantity` (dedupe unique + RPC).
- **`execution_runs`** — every Check/Place run. `cart_id` (nullable),
  `store_id`, `status` (queued→claimed→running→succeeded/failed/
  canceled/**submitted_unconfirmed**), `payload_snapshot` jsonb (the
  cart at fire time + `metadata.mode` = `dry_run`|`submit`),
  `worker_id`, `heartbeat_at`, `progress_stage`, `progress_message`,
  `queued_at`, `retry_count`/`max_retries`, `failure_type` (enum:
  CODE_MISMATCH/OUT_OF_STOCK/QUANTITY_RULE_VIOLATION/MLCC_UI_CHANGE/
  NETWORK_ERROR/UNKNOWN), `failure_details`, `evidence` jsonb (stage
  artifacts incl. validate_result: OOS list, MLCC totals, messages),
  **`order_submitted`** boolean (the truth bit — "succeeded" alone is
  NOT proof of submission). Partial unique index: one running run per
  store; validate-run dedupe index.
- **`execution_run_attempts`** — per-attempt audit (attempt_number,
  status, failure, stage, worker).
- **`execution_run_operator_actions`** — operator interventions
  (acknowledge/mark_for_manual_review/retry_now/cancel/resolve_without_retry).
- **`milo_order_confirmations`** — REAL order receipts: per-ADA
  `confirmation_number` (load-bearing), `order_number`, `net_total`/
  `gross_total`/`liquor_tax`/`discount`, `line_items` jsonb, raw
  distributor string, delivery date. Written from MILO's history feed
  post-submit; reconciled against MLCC's email (`originalNetTotalAmt`).
- **`store_item_order_stats`** — per-store (code) order_count /
  total_quantity / last_ordered_at → reorder smart cards + featured.
- **`order_templates`** — saved orders (items jsonb), scheduling
  columns, soft-archive; `POST /order-templates/run-scheduler` cron.

### THE MOAT — store memory & AI
- **`store_resolver_memory`** — the store's own language: `phrase`
  (normalized) + `size_ml` → `mlcc_code`, `source`
  (card_swap/chat/seed), `times_used`, `last_used_at`. Taught silently
  by resolve-card swaps and chat; surfaced as "★ remembered" pins and
  the Settings "Saved matches" section (list + two-tap forget only —
  the UI can never invent memory).
- **`brand_flagships`** (2026-08-12, pending-batch migration
  `sql/2026-08-12-brand-flagships.sql`) — bare-brand → flagship alias
  terms for EVERY brand, derived by the SIZE-LADDER LAW (the flagship
  has the deepest size ladder; flavors/proof-lines/aged/combos
  demoted). Built by `scripts/build-brand-flagships.mjs` (dry-run
  default; `--write`; ambiguous picks go to a review CSV only —
  a knowledge row must never guess). `source='curated'` rows are
  sacred (builder never touches them) — fixing a wrong flagship is
  ONE UPDATE, no deploy. Read by the resolver via `loadFlagshipMap`
  (5-min cache, fail-soft empty). Static in-code FLAGSHIP_ALIASES
  outrank it (curated > derived).

### Legacy / support tables
- **`bottles`** + **`inventory`** — pre-mlcc_items store-scoped bottle
  records + stock (early era; still referenced by cart_items.bottle_id
  and code-map lineage).
- **`push_subscriptions`** — web-push (VAPID) per store; "check
  finished / needs a decision" notifications.
- **`pilot_ops_workflow_states`** (+ `_history`,
  `pilot_ops_notifications`, `pilot_ops_notification_state`) — pilot
  operations review workflow (unreviewed/watching/escalated/resolved)
  + attention alerts for the operator console.
- **`lk_system_diagnostics`** — structured diagnostic events
  (`payload` jsonb), global or store-scoped.

## 4. THE MONEY PATH (Check / Place)

1. **Cart** lives client-side (localStorage `lk-scanner-cart-v1`,
   v1 payload `{version, lines, updatedAt}`) + server carts for runs.
   Rule-engine validation per line (mlcc_rules: case multiples, 9L/ADA
   minimums) before Check is allowed.
2. **Check ("validate_only")** — creates an execution_run stamped
   `metadata.mode="validate"`. The worker claims it, runs the **node
   engine** against MILO's own API (login → clear cart → BULK add →
   parallel stock/validate/delivery reads → taxes/pricing write) and
   stores `validate_result`: per-item stock, MLCC totals (subtotal/
   discount/liquor tax/net), MILO messages. **Check can NEVER submit —
   structural**: the only code that presses MILO's checkout
   (`engine-submit.js` / `submitCartViaApi`) refuses any run not
   stamped `mode="submit"`. Result surfaces in the RunResultSheet:
   OOS items by NAME (cart join — never a naked code) with
   **Remove / Remove-all buttons**, totals, messages, push notification.
3. **Place** — armed footer shows "Check with MLCC" + "Place Order";
   Place is LOCKED by the client **place-gate**: requires a green
   Check < 10 min old for the byte-identical cart (lines hash — any
   edit re-locks). Confirm modal (store name + license shown). Fires
   `mode:"submit"`.
4. **The triple gate** (defense in depth, re-checked at run creation,
   in the worker, and at checkout):
   1. `metadata.mode === "submit"` (deliberate client flow only)
   2. `stores.allow_order_submission === true` (Colony: TRUE)
   3. env `LK_ALLOW_ORDER_SUBMISSION` — **kill-only** since 2026-07-23:
      `"no"` kills, anything else (incl. absent) permits. Currently
      explicitly `yes` on BOTH Fly apps.
   **State since 2026-08-04: FULLY ARMED at Tony's request. He holds
   the keys. Never instruct a re-lock.**
5. **Truth rules**: `succeeded` + `order_submitted=true` = green
   "Order submitted" + cart clears. Submit-clicked-but-receipt-missed =
   `submitted_unconfirmed` → amber "do NOT place again", never
   auto-retried. A downgraded submit (gate closed) shows "Nothing was
   ordered" honestly. Confirmations land in milo_order_confirmations +
   Orders tab, verified against MLCC's email to the penny.

## 5. CATALOG & PRICING PIPELINE

- Daily cron → discover the LCC info page → **full price book** (xlsx)
  re-ingest when its `?rev=` URL changes (composite-key upsert, family
  identity computed every row, price memory captured, price_changed_at
  stamped) → UPC TXT enrichment after.
- **Between-book files auto-ingest** (2026-08-04): new-item lists,
  retail price changes, ADA changes — additive-only, ≤2000-row
  fail-closed fence, per-kind ledger. Mid-month price moves now land
  the day MLCC publishes and light the "was $X" chips.
- Href matchers are pinned against the LIVE page's link shapes; a file
  can never satisfy two matchers (a changes-list ingested as a full
  book would be catastrophic — fenced + tested).
- Freshness heuristic per item (`last_price_book_date` vs latest book):
  aging/likely-discontinued banners so nobody wastes a run on a dead SKU.
- Search: trigram + name_searchable + brand aliases + grouped
  family browse RPCs (one card per line, sizes inside) + featured/
  popularity ordering + browse facets.

## 6. SCANNER & RESOLUTION INTELLIGENCE

- **Barcode scanning**: measured-and-tuned live decode (4K ideal
  capture, guarded 220ms ticks, center-crop 60%×40%, 4-rotation
  downscaled sweep every 3rd tick, live hints = 6 formats without
  TRY_HARDER; photo-still path gets TRY_HARDER+INVERTED). Won the
  "5 of 10 bottles" floor war by arithmetic (px/module math), verified
  on-floor.
- **UPC path**: upc_mappings hit → instant card; miss → external
  lookup + scored match (audited) → candidate picker; user confirms
  teach the mapping.
- **ONE MATCHER LAW**: every text path (vision, chat, voice lines)
  resolves through `resolveOrderLine` — flavor-word penalties (a plain
  "Smirnoff" can never lose to SOURS GREEN APPLE), lead/missing-term
  penalties, flagship aliases, brand synonyms, proof-line demotion,
  size honesty (size_mismatch flagged loudly, never silently swapped),
  case-intent ("a case" → suggested_qty), brand_absent honesty,
  store memory pinning (★ remembered wins outright).
- **Vision**: photo of a bottle → extraction → THE resolver (same law)
  → card with alternates.
- **ProductCard**: per-size photos (photo-truth mandate), ordering
  rules callout, freshness banner, "was $X" price-memory chip, More
  from this brand, tag printing (`/tags`), in-store photo capture.

## 7. THE ASSISTANT (AI tab)

Anthropic-powered, streaming always, with progress labels paced ≥1.2s.
Tools over real data: resolve_bottles (multi-line orders → resolve
cards with add-to-cart, size flips, remembered pins), catalog search,
cart ops, order history, memory list/forget ("what have you learned").
Multi-image support. Store-scoped auth — a store can only ever see
itself (RLS + middleware). Teaching: every resolve-card swap writes
store_resolver_memory silently; chat can teach and forget explicitly.

## 8. API SURFACE (mounts in `app.js`)

`/auth`, `/home` (smart cards + store_meta incl. armed flag),
`/catalog` (browse/vision/photo), `/cart*`, `/execution-runs`,
`/orders`, `/order-templates` (+ cron scheduler), `/store-memory`,
`/stores` (MLCC credentials verify), `/inventory`, `/bottles`,
`/push`, `/tags`, `/assistant`, `/price-book` (incl. cron
check-updates + UPC lookup/flag), `/operator-review` (+ admin app),
`/admin` (+ NRS import/review), `/health`, `/` + `/signup` (landing).
Auth = Supabase JWT + X-Store-Id → `resolveAuthenticatedStore`.

## 9. ORDER CADENCE + SCHEDULED AUTOMATION

**STANDING LAW (Tony, 2026-08-05, decided with his mom): Colony places
its MLCC order EVERY WEDNESDAY. Cutoff 8:00 pm ET.** Tony is off
Thursdays, so Wednesday is his order day — permanently. All order-day
automation, freezes, and reminders key off Wednesday now (the old
Thursday plan is dead). Deploy freeze: nothing ships Wednesday
afternoon/evening until the order is confirmed.

Claude session triggers (fire into the persistent session):
- **Every Wednesday ~4pm ET** (`0 20 * * 3` UTC; drifts to 3pm ET in
  winter — fine, earlier is safer) — weekly ORDER DAY play: build/
  review the cart, fresh Check green, Tony taps Place, verify vs MLCC
  email `originalNetTotalAmt`, capture resolver misses. One action per
  message; never any lock/unlock steps (system permanently armed).
- One-offs for launch week 2026-08-05/06: today's 5pm ET play + a
  Thursday-morning post-order verification backstop.

**ORDER RE-SYNC LOOP (#36 Phase A, LIVE 2026-08-08):** the worker's
idle loop refreshes every placed order from MILO `GET /users/orders` —
READ-ONLY, kill switch `LK_ORDER_SYNC="no"` (absent = on). Owner Sync
taps are checked every idle tick (~2.5s; tap-to-fresh ~5s); standing
cadence 6h for stores with a confirmation in the last 21 days. Current
truth lands in `synced_*` columns (placement columns immutable);
MILO orders LK never saw are IMPORTED (`origin='milo_sync'` — hand-
placed orders appear on their own; proved night one with Imperial
Beverage). Scanner auto-syncs when Orders opens >10 min stale.
Spend/summary follow synced truth. FINDING (8/8): MILO's
`originalNetTotalAmt` remembers ADA edits only — an OWNER "Edit
order" rewrites MILO's baseline, so pre-edit truth exists only where
we captured it at submit (the worker does; only the 8/5 backfill rows
lack it). Files: `rpa/engine/engine-order-sync.js`,
`workers/order-sync-loop.js`, orders routes `/sync` + `/sync/status`.

## 10. LAWS (condensed — RULEBOOK.md + latest closeout are canonical)

1. **One-writer**: Tony runs all git/deploy/SQL. zsh: no `#`, no `!`,
   single-quoted commit messages with NO apostrophes.
2. **File-ship law**: fresh `/mnt/user-data/outputs/<dir>/` → send →
   device-commit → **shasum -a 256 verify both sides**; drift-check
   modified files against clone HEAD before overlaying.
3. **Rule 28 / Operator Split**: one purpose per message, ONE concrete
   action, tappable questions, 30-second phone proofs, the board is
   the anti-loss machine, Tony never reads docs — feed steps
   just-in-time.
4. Prod DB = `eamoozfhqolshdztbrez` by ID; connected Supabase MCP ≠
   prod; Colony id `e594fc3a-...`; migrations = timestamped SQL that
   Tony applies.
5. Check never submits; truth rule; submitted_unconfirmed never
   auto-retried; armed permanently (8/4) — never re-lock.
6. Tony's Mac vitest runs are the bars; sandbox runs are advisory
   (15 API files need env and only load on his Mac).
7. Sandbox clone commits are LOCAL-ONLY mirrors, never pushed (ignore
   the stop-hook nag).
8. The app is at `/scanner/`; the root is marketing. Probe accordingly.
9. **ACCURACY DOCTRINE (Tony, 2026-08-05, verbatim intent): "the
   actual bottles they are scanning has accurate information 100% of
   the time — it cannot be wrong; if it is wrong we have failed as a
   company."** Every surfaced fact (scan match, price, card, chip)
   must be traceable to MLCC's own published data or the store's own
   confirmed teaching. When accuracy is uncertain, say so on the
   surface (candidate pickers, honesty banners) — never guess
   silently. Every wrong-match report is a P1 trace
   (upc_match_audit → fix → pin).
10. **BARCODE/DATA AUTO-CURRENCY MANDATE (Tony, 2026-08-05): whenever
   MLCC publishes new bottles, barcodes, or any companion data, the
   system must pick it up automatically — 100%, no manual steps.**
   Known gap being closed (board #33): UPC enrichment runs from the
   price-book TXT only on full-book ingest day; if MLCC publishes the
   TXT later (August 2026: Excel published 8/2, TXT still the May
   one), new items stay unscannable until the next book. Fix = watch
   the TXT URL on the daily tick like the books, re-enrich on change.
11. **Order-night build safety**: prod changes ONLY when Tony deploys.
   On order days (Wednesdays), build in the sandbox freely but do not
   ship/deploy anything until the order is confirmed.

## 11. MILESTONES (journal `docs/lk/journal.md` is the narrative)

UPC foundation (May 13, 0→97% coverage) → AI brain + rules DB
(May 20) → first real orders era (June) → worker split + node engine
(July: validate in ~5-8s end-to-end) → family tree + browse (7/11-17)
→ store memory THE MOAT (7/24-28) → scanner war won + vision fixed
(7/26-27) → live pill + watchdog + saved matches (7/27-28) → private
networking (7/31) → **ARMED DAY + price memory + OOS-remove +
between-book ingest + the phantom-deploy war (8/4-05)**. Next: first
owner-fired engine order **Wednesday 8/5 by 8pm ET** — and every
Wednesday after (the standing cadence).

## 12. OPEN BOARD (as of 8/7)

**Ship the staged batch first** (built in sandbox after the 8/5
order: confirmations index migration + service comment, cart-clear on
submitted, penny fixes, layout-law fixes, add-guard lib, TXT-watch
enrichment) · #36 edit-in-app + MILO re-sync (HEADLINE) · #37
store-local timezone grouping · #32 Updates bell (design locked) ·
#29 guard UI wiring · #30 GIT_SHA truth-probe (first post-freeze
build) · #38 label printing (universal print doctrine) · #39
invoice-verify vs confirmations · #40 POS lane (NRS first) · #41
exports lane (later) · #42 quarterly competitor re-sweep + Saxon
dossier · scale plan doc + MLCC outreach letter (in flight) · #9
chat restore-at-bottom · #28 save-for-later · #8/#19 proof batches ·
#13 harness · Serper photos, model bump eval, Capacitor (later).

## 13. COMPETITIVE FIELD (2026-08-07 — full intel: `docs/lk/COMPETITORS.md`)

**ALWAYS-BETTER LAW** (Tony, verbatim): "we need to be strong where
they are weak and mediocre... and we have to especially beat every
competitor in each of their strongsuits." The dossier doc is the
canon; keep it living (quarterly re-sweep, board #42).

The field: hand-typed MILO (status quo) · Saxon (#1, dossier
pending) · **CoreVue** (#2, corevue.com, found 8/7): $249/site/mo or
$2,490/yr flat, Azure-hosted (leans on Azure's ISO 27001/SOC 2),
built-for-c-stores-and-gas-stations DNA (fuel tank monitoring is a
flagship), Verifone®/Gilbarco® Passport POS import, AI invoice OCR
<30s, EDI, QuickBooks export, shelf-label printing ("Zebra printer
compatibility"), multi-store price book, LARA pricebook automation +
claimed direct LOO submission, MI bottle-deposit reports, email
support, "few days" onboarding, 14-day trial, month-to-month.

**BUSINESS DECISIONS LOCKED (Tony, 2026-08-08, tap-confirmed):**
price **$149/store/month flat** (under CoreVue's $249 umbrella; ~$1,788
/store/yr; room to raise as modules stack; **multi-store 8/9-10:
$99/mo each store after the first — CONFIRMED 8/10;
published-pricing doctrine: hide how it works, show what it costs**) · **14-day free trial**
(covers two Wednesday orders) · **MLCC recognition letter: draft +
send this week** (Colony story, sub-user path, Ohio/Provi precedent) ·
**next build after the 8/8 batch: self-serve signup machine** (the
store-count lever — sign up, connect MILO, scan same day, no human).
Signup-machine design locked 8/8 (tap-confirmed): **sub-user-first**
MILO connect (owner creates an MLCC sub-user for LK; direct login as
fallback) · **no card until the trial ends** · **PUBLIC launch from
day one** (Tony overrode the quiet-launch recommendation) · support =
**in-app AI + support email + Tony's number for the first 10 stores**.
Blueprint: `docs/lk/SIGNUP-MACHINE.md`. MLCC outreach letter drafted
8/8 (`docs/lk/mlcc-outreach-letter.md` — to mlccinfo2@michigan.gov,
cc Licensing; Tony fills license #, city, phone).

**MILO SUB-USER MECHANICS (seen 8/8 — Tony's screenshots of
Administration → Group Management → "Manage 430342"):** sub-users are
**INVITE-based**, not created directly. The license page shows a
Members table (role OWNER, handle, email, last-login, "PR Roles" e.g.
Price Reduction, per-member "Details..."), an Inactive Members table,
an **Invite** button, and an Invitations ledger (Sent To / token /
~3-day expiry / Active / Claimed — the pilot owner account was itself
claimed from a system invite in Jan 2021). Onboarding walkthrough
teaches the real steps: Group Management → open your license →
Invite an email you control → claim via MILO's invitation email →
enter the new sign-in in LK. **UNKNOWN until the first real invite:
what role options an invitee gets and whether a plain member can
place orders — verify when Colony invites LK's sub-user (that invite
is also the eventual replacement for the pilot's main-login creds).**

**SIGNUP MACHINE BUILD (sandbox 8/8, shipped in the 8/9 batch):
M1 server** (trial_ends_at +14d Detroit-tz, creds optional at signup —
both-or-neither `mlcc_credentials_incomplete`, onboarding state) ·
**M2 wizard** (trial line "14 days free, no card", sub-user-first
Step 2 with the real invite walkthrough, "Connect MILO later — start
scanning now" credless path straight into the scanner) · **M3 nudge**
(connect-MILO banner on scanner home via `lib/mlccStatus.ts`
broadcast from AuthGate; Settings PUT `/mlcc-credentials` + POST
`/verify` closes the loop — PUT works for credless stores) · **M4
billing scaffold** (zero-dep Stripe: bare REST + node-crypto webhook
verify in `services/api/src/lib/billing.js`; SAFETY LAWS pinned in
`test/billing.test.js` (13): FAIL-OPEN until STRIPE_* env exists,
GRANDFATHER — trial_ends_at NULL (Colony) never gated, past_due
grace; only from-cart runs 403 `billing_required`; migration
`20260808220000_billing_columns.sql`; env when money turns on:
STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET +
optional LK_PUBLIC_ORIGIN). Remaining rungs: **Settings billing
panel** (trial days + add-card button) · **M5 landing-page CTA +
public switch**. Support roadmap note (Tony 8/8): voice AI phone
line later (post-first-strangers), honest-AI voice — never
fake-human; his Flint-guy vision (pic of bottle/barcode, "add it to
my cart" by chat) is already the shipped product surface.

LK moats they lack: AI partner · store/resolver/price memory ·
honesty rails (evidence receipts, accuracy + penny doctrines) ·
liquor-store-native identity · credential fortress story + MLCC
recognition pursuit. Their strongsuits to match+beat: POS-driven
suggested orders (#40 NRS-first), invoice OCR (→ #39 invoice-VERIFY
against confirmations), label printing (→ #38 universal print
doctrine: OS print dialog = every brand, no compatibility list),
retail pricing helpers, exports (#41). Nobody in the field claims
official MLCC recognition — first to get it wins.
