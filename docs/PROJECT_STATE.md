# Liquor Kings — Project State

**Living document. Update at end of every work session. Read at start of every work session.**

**Last updated:** May 7, 2026
**Last session:** May 7, 2026 — Phase B Priority #1 COMPLETE — encrypted MLCC credential storage end-to-end with worker DB integration
**Founder / Primary Builder:** Tony Kado (19, Michigan)
**Stage:** Pre-launch. Architecture mostly built. Wiring + customer-facing flows + business operations remaining.
**Repo:** github.com/antkado30/liquor-kings
**Local path:** /Users/tonecapone/dev/liquor-kings

---

## What Liquor Kings IS

A Michigan-first B2B SaaS platform that automates spirits ordering for MLCC licensees. Replaces the 2-hour manual MILO ordering workflow (walk store → look up codes → type into MILO portal → validate → checkout) with a 10-minute scanner-driven flow.

**Customer:** Anyone with an MLCC liquor license — liquor stores, restaurants, bars, hotels, casinos, country clubs, gas stations. ~23,000 retailers in Michigan.

**Value prop:** Save customers 8 hours/month at $49/mo = saving $2,000-4,000/year of owner time for $588/year. 80x value-to-price ratio.

**Tech stack:**
- Frontend: Vite + React (admin) + Vite + React PWA (scanner) — TypeScript
- Backend: Express.js API on port 4000 (JavaScript, ESM)
- Database: Supabase (Postgres + Auth + Storage + Realtime + RLS)
- RPA: Playwright headless against MILO portal at lara.michigan.gov
- Job queue: execution-runs table + worker that claims jobs
- AI: OpenAI for catalog/UPC matching helpers; Anthropic for chat AI features (Phase 2)
- Monitoring: Sentry
- Payments: Stripe (planned, not yet integrated)

---

## Architecture (verified May 5, 2026)

### What's BUILT and CONFIRMED working

**Database (27 migrations applied locally, full schema present):**
- Foundational tables: stores, store_users, bottles, mlcc_items
- Carts and cart_items (with mlcc_item_id formalized)
- Execution runs system: execution_runs, execution_run_attempts, execution_run_operator_actions, evidence, heartbeat
- Pilot ops workflow: pilot_ops_workflow_states + history + notifications
- Price book ingestion: mlcc_price_book_runs and related tables
- UPC system: upc_mappings (authoritative), upc_lookup_cache, upc_match_audit, brand_aliases
- Trigram search enabled
- Order submitted CHECK constraint (DB-level SAFE MODE guard)
- RLS policies on stores, store_users, bottles, mlcc_items, pilot ops tables, plus more

**API (Express, port 4000, all routes mounted in services/api/src/app.js):**
- /health (works)
- /admin (admin token auth) — including /admin/upc-mappings, others
- /price-book/upc/:upc + flagging
- /cart (auth-resolved, store-scoped)
- /cart-summary, /cart-lifecycle
- /inventory (auth-resolved, store-scoped)
- /bottles (auth-resolved, store-scoped)
- /execution-runs (auth-resolved, store-scoped)
  - /execution-runs/claim-next (worker endpoint)
  - /from-cart/:storeId/:cartId (creates a run)
  - /cart/:storeId/:cartId (lists runs for cart)
  - /review/:storeId/runs (operator review queue)
- /operator-review (operator workflow)
- /operator-review/app (serves admin SPA)

**Middleware (auth + multi-tenancy):**
- resolveAuthenticatedStore — extracts store from auth context
- enforceParamStoreMatches — verifies URL store ID matches auth
- enforceCartItemStoreScope — per-item access control
- requireServiceRole — restricts worker endpoints

**Services (business logic, all in services/api/src/services/):**
- cart.service
- cart-execution-payload.service
- cart-availability.service
- cart-submitted-mlcc-feed.service
- bottle-identity.service
- inventory-state.service
- execution-run.service
- execution-failure.service
- execution-attempt-aggregate.service
- operator-diagnostics.service
- mlcc-operator-context.service
- pilot-ops-workflow-state.service
- pilot-ops-quality-metrics.service
- pilot-ops-notifications.service

**Workers (services/api/src/workers/):**
- execution-worker (claims runs, builds preflight, runs dry-run plan)
- mlcc-adapter, mlcc-dry-run, mlcc-dry-run-readiness, mlcc-guards
- mlcc-browser-worker, mlcc-browser-evidence, mlcc-browser-add-by-code-probe
- mlcc-browser-safe-flow-screenshots
- mlcc-phase-2i, 2k, 2m, 2p, 2s, 2u, 2v-2w policy engines
- mlcc-phase-runner

**MLCC modules (services/api/src/mlcc/):**
- mlcc-brand-aliases, mlcc-category-ontology
- mlcc-blocking-hints.service, mlcc-blocking-hint-proposed-fix
- mlcc-price-book-parser, mlcc-price-book-ingestor, mlcc-price-book-scheduler
- mlcc-upc-audit, mlcc-upc-scoring
- mlcc-mapping-backlog.service
- mlcc-product-family
- mlcc-catalog-by-code.repository
- mlcc-execution-readiness-summary, -serialize, assert-mlcc-execution-readiness-for-cart
- milo-ordering-rules (split-case rules, 9L minimum, KNOWN_ADAS, validateCart)
- mlcc-operator-overview.service

**RPA stages (verified end-to-end against live MILO on April 24, 2026):**
- Stage 1: login.js — 6.6s, lands on /milo/home
- Stage 2: navigate-to-products.js — selects license, captures delivery dates (best-effort)
- Stage 3: add-items-to-cart.js — types codes via Add By Code, navigates to /milo/cart
- Stage 4: validate-cart.js — clicks Validate, parses structured cart state
  - Verified output: 2 ADAs, $1,058.16 net total, canCheckout: true
- Test scripts (_test_*.js) for each stage
- Safety: BLOCKLIST_RE in milo-discovery.js, clickValidateButtonSafely guard, no_submit_attestation evidence
- ALL FOUR STAGES PASS individually but are NOT YET wired into execution-worker

**Frontend — Admin SPA (apps/admin/, built and served by API at /operator-review/app):**
- App shell + nav layout (AppShell, AppNavLayout)
- Sign-in flow (SignInView)
- Operator session context
- Operator review:
  - Run queue panel
  - Run detail panel
  - Run lifecycle timeline
  - Attempt history section
  - Evidence blocks
  - Recommendations
  - Bulk triage eligibility
  - Queue prioritization
  - Failure guidance
- Pages: PilotOpsPage, OperatorOverviewPage, DiagnosticsPage
- Sentry integration

**Frontend — Scanner PWA (apps/scanner/, exists but not yet booted today):**
- App shell + main entry
- BarcodeScanner component
- ProductCard, ProductSizeSelector, UpcCandidatePicker, SearchBar
- CartDrawer + CartPage
- useCart hook + cart API
- useCatalogSearch hook + catalog API
- PWA manifest
- Sentry integration

### What's NOT BUILT (gaps from spec)

1. **Stage 5 RPA (checkout submission)** — last stage missing
2. **RPA stages → execution-worker integration** — stages run from terminal tests but worker doesn't call them yet
3. **Customer-facing signup/onboarding flow** — only operator/admin auth exists
4. ~~**Encrypted MILO credential storage**~~ ✅ SHIPPED May 7 — AES-256-GCM via `services/api/src/lib/credential-encryption.js`, service at `store-mlcc-credentials.service.js`, routes under `/stores/:storeId/mlcc-credentials`, worker reads from DB
5. **Stripe billing integration** — not present
6. **Customer-facing landing page** — liquorkings.com not purchased, no marketing site
7. **Customer-facing cart UI** — scanner has cart but the "review and submit to MLCC" customer journey hasn't been built
8. **Email notifications** — no sending infrastructure (SES, Resend, Postmark, etc.)
9. **Push notifications** — not configured
10. **Status page** — status.liquorkings.com not set up
11. **MLCC password change auto-detection** — Stage 1 INVALID_CREDENTIALS handling not yet wired to customer notification flow
12. **Label/tag printing (PDF generation)** — not built; this is the moat against Saxon
13. **Thermal printer integration (Zebra ZD421)** — not built
14. **Order confirmation screens** for customers — not built
15. **Order history with re-order button** for customers — not built
16. **API endpoint that triggers a full RPA run** — execution-runs endpoints exist but the worker doesn't actually run RPA stages 1-5 yet
17. **Bulk UPC import tool** for Deja Vu POS exports — admin import not built
18. **AI assistant (V2 feature)** — conversational catalog/order-history chat — deferred per spec

### What's UNVERIFIED (need to test next session)

- Whether scanner PWA boots cleanly and connects to API
- Whether admin SPA login flow works against fresh local DB (no users seeded)
- Whether RPA stages can be invoked from worker code path
- Whether mlcc_items table has any data locally (probably empty after `db reset`)

---

## Decisions Locked In (from April 25 strategy session)

### Pricing
- $49/mo per license (first license)
- $29/mo per additional license
- Annual: $490/year (2 months free)
- **Founders' tier**: First 25 customers grandfathered at $25/mo for life
- 14-day free trial, full access, card required at signup, charged on day 15
- Stripe credit/debit only at MVP launch — no ACH, no invoicing
- No prorated refunds at cancellation, lose access next billing cycle
- One tier at MVP launch, expand to Pro tier (~$99/mo) in V2 with AI features

### Service Guarantee (goes in ToS)
- If RPA fails due to OUR error → refund that month's subscription
- Customer notified within 5 minutes of any RPA failure (email + push)
- Manual workaround instructions provided so customer can place order before delivery cutoff
- Customer-side errors (out of stock, MLCC fees overdue, expired credentials, 9L minimum) shown transparently — NOT refunded

### Equity (May 5 decision — finalized version)
- **Tony retains 50%** as founder/CEO
- Remaining **50% offered to Jacob, Adol, Julian, Ildit collectively** — they allocate among themselves
- All cofounder shares vest over 4 years with 1-year cliff
- Vesting contingent on actual ongoing contribution
- LLC + operating agreement to be drafted by Michigan startup lawyer ($5-8K legal budget)
- **Action item: Tony to have the conversation with Jacob first, then Adol, then group with Julian/Ildit**

### Tech / Product
- **PWA only** — never native iOS app (avoids Apple's 30% fee)
- "Mimic MILO" workflow — match the validate → review → checkout pattern customers know
- Two error categories: OUR errors must NEVER happen (engineering bar) — THEIR errors shown transparently like MLCC does
- Multi-license support: one account, store-switcher UI, $49 first + $29 each additional
- Sub-users allowed but require legal waiver/agreement
- Scanner is core feature, NOT separate
- MILO connection required before scanner usable
- AES-256-GCM encryption for MILO credentials with versioned format `v1:<iv>:<authTag>:<ciphertext>` — SHIPPED May 7
- Key currently in `LK_CREDENTIAL_ENCRYPTION_KEY` env var (Tier 1 dev posture) — MUST migrate to managed KMS before first paying customer (Phase B Priority #1.5)
- Plaintext password never logged, never returned from any endpoint — exists only in Stage 1 browser session memory at use time
- Hard-fail on decrypt error never silently falls back to env (operator visibility preserved)

### Security posture (current tier + roadmap)

**Tier 1 — SHIPPED May 7 (acceptable for dev / pre-launch / dad's store as test customer):**
- AES-256-GCM at rest with random IV per encryption + auth tag verification
- Versioned ciphertext format for future algorithm migration
- Encryption key in env var on server
- HTTPS everywhere
- Supabase RLS for data isolation
- Service-role bearer + X-Store-Id required for credential routes

**Tier 2 — REQUIRED BEFORE FIRST PAYING CUSTOMER (Phase B Priority #1.5 + #1.6):**
- Encryption key in managed KMS (Supabase Vault / AWS KMS / GCP KMS) — never in env file or app memory
- Per-store Data Encryption Keys wrapped by master KEK (envelope encryption)
- Credential access audit log (immutable, anomaly-detected, customer-visible)
- Cyber liability insurance ($1.5-3K/year)
- Lawyer review of security disclosures in ToS

**Tier 3 — REQUIRED AT 25-100 CUSTOMERS:**
- Third-party penetration test ($3-5K)
- Dependency scanning in CI (Snyk / GitHub Dependabot enforced)
- Network isolation: prod DB only reachable from worker IP
- Customer-facing "last accessed" surface

**Tier 4 — REQUIRED AT 100+ CUSTOMERS:**
- SOC 2 Type II audit
- Bug bounty program
- Quarterly internal security review

**Honest threat assessment:**
- Right now (pre-launch, dev only): vanishingly small attack surface
- At Tier 2 with paying customers: same security tier as well-run SaaS
- At Tier 4: same tier as banks and password managers
- 0% breach probability is not achievable for any system. The bar is "build the strongest way possible, detect breaches in minutes not months, limit blast radius, recover fast, document promises and limitations clearly."

### Operations
- AI chatbot for ~60-70% of routine customer support tickets
- Human support 9am-6pm ET, Mon-Fri
- Status page from launch (Better Stack, ~$30/mo)
- Goal: self-healing RPA detects breaks within 60s, auto-fixes 80%, founder fixes 20% within 1 hr SLA

### Marketing / Go-to-market
- First 25 customers from Tony's warm network (family, cousins, friends, Austin Frieda's referrals, dad's connections)
- Conservative est: 100-200 warm leads in Michigan
- No paid ads year 1
- Referral bonus program (~$50 credit per new customer brought in)

### Long-term
- Year 1: Michigan only, 50-100 customers
- Year 2: 250-400 customers, expand to second state
- Year 3-5: Multi-state (PA, OH, UT, etc.), AI Pro tier, $300K-1M annual personal income
- Year 5-7: Optional sale ($10-25M personal payout) or keep growing
- Possible vendor-side product (Liquor Kings Vendor) for alcohol brands managing MLCC registrations — Year 4

---

## Competitive Landscape

### Saxon Liquor Orderer (Saxon Inc, Ferndale MI)
- Tablet bundle + Bluetooth scanner + 8,000 pre-printed shelf tags
- Annual subscription + hardware bundle (~$700-1,300 year 1, $400-800/year recurring estimated)
- Weakness: hardware-locked, dated UX, pre-printed tags require shipping/quarterly updates
- **OUR ADVANTAGE:** mobile-first PWA (any device), software-only, AI features in roadmap, lower price, broader licensee target

### CoreVue (LARA Order Management)
- Software-only, targets Michigan gas stations and c-stores
- 30-day free trial
- Weakness: limited target market, modest feature set
- **OUR ADVANTAGE:** broader licensee target, more modern UX, AI features, label printing options

### NO competitor has integrated with SIPS+ (MLCC's new backend, launched November 2025)
- SIPS+ replaced the legacy MLCC backend (was COBOL, 50 years old)
- Suppliers/vendors use SIPS+ for product registration, MLCC uses it for inventory/finance
- Retailers STILL use MILO at lara.michigan.gov
- **Strategic bet:** SIPS+ will eventually absorb retailer ordering. First mover wins.

---

## Current Dev Environment Setup

**Boot sequence to start working:**
1. Open Docker Desktop (or set to launch on login)
2. `cd /Users/tonecapone/dev/liquor-kings && npx supabase start` (starts Postgres + Auth + Storage + Realtime locally)
3. `cd services/api && npm run dev` (starts API on :4000)
4. (Optional) `cd apps/scanner && npm run dev` (scanner PWA)
5. (Optional) `cd apps/admin && npm run dev` (admin SPA in dev mode, otherwise served from /operator-review/app)

**Verify health:**
- `curl http://localhost:4000/health` → `{"status":"ok"}`
- `curl -H "X-Admin-Token: liquorkings-dev" http://localhost:4000/admin/upc-mappings` → real JSON (not `fetch failed`)

**Local connection details (DEV ONLY — same defaults every Supabase developer has):**
- Postgres: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- API: http://127.0.0.1:54321
- Studio: http://127.0.0.1:54323

---

## Top Priorities (next 90 days)

### Phase A: Wire the engine (target: 2-3 sessions)
1. Wire RPA Stages 1-4 into execution-worker so a worker run actually invokes the stages
2. Build Stage 5 (checkout submission) in dry_run mode
3. Add API endpoint that triggers a full RPA run from a cart
4. Verify end-to-end: scanner cart → submit → execution-run created → worker claims → stages run → result back to cart

### Phase B: Customer-facing surface (target: 4-6 sessions)
5. Customer signup flow (vs operator/admin auth)
6. MILO credentials onboarding with AES-256 encryption + Stage 1 verify
7. Customer-facing cart review + submit UI
8. Order confirmation screen + history UI + re-order button
9. Email notifications (Resend or Postmark)
10. Multi-license support with store switcher

### Phase C: Business operations (parallel — admin work, not coding)
11. Form Michigan LLC (~$200, Northwest Registered Agent)
12. Have Jacob conversation about equity
13. Hire Michigan startup lawyer ($5-8K total budget)
14. Buy domain liquorkings.com + variants ($60)
15. Buy ToS + Privacy Policy via Termly ($30/mo)
16. Get business insurance ($1,500-3,000/year)
17. Call Deja Vu POS support to ask about CSV export for bulk UPC seeding

### Phase D: Differentiation (Saxon-killer features)
18. Label printing PDF generation
19. Thermal printer (Zebra ZD421) integration as Pro add-on
20. Status page (status.liquorkings.com)
21. Begin Phase 2 RPA observability — selector telemetry, self-healing infrastructure

### Phase E: Launch + first customers
22. Marketing landing page on liquorkings.com
23. Onboard dad's store as customer #1 (free, ambassador)
24. Onboard founders' tier customers 2-25 ($25/mo grandfathered)
25. Public launch announcement to warm network

---

## Known Risks (per spec)

1. **MLCC portal changes break RPA** — mitigated by Phase 2 selector telemetry + 1hr SLA
2. **MLCC issues cease-and-desist** — low likelihood (Saxon and CoreVue operate without issue), but lawyer review before launch
3. **Customer credentials breach** — mitigated by AES-256, secrets manager, cyber liability insurance
4. **Tony burns out** — ramp plan: drop life insurance active sales at $2K MRR, drop store hours at $5K MRR
5. **Cofounder dispute** — mitigated by Jacob conversation + lawyer-drafted operating agreement + vesting
6. **Saxon/CoreVue copies features** — moat is speed + Tony's Michigan network + future AI features
7. **PWA limitations on iOS** — acceptable tradeoff for avoiding 30% Apple fee

---

## Action Items (active, ordered)

### This week
- [ ] Have Jacob conversation about equity
- [ ] Buy liquorkings.com (Namecheap, ~$15) + 2-3 variants
- [ ] Wire RPA Stages 1-4 into execution-worker (next session goal)

### Next 2 weeks
- [ ] File Michigan LLC (Northwest Registered Agent)
- [ ] Set up business bank account (Mercury or Bluevine, free)
- [ ] Get business EIN from IRS (free)
- [ ] Build Stage 5 in dry_run mode
- [ ] Have Adol conversation, then group with Julian + Ildit
- [ ] Hire Michigan startup lawyer (interview 3, pick one)

### Next 4 weeks
- [ ] Lawyer drafts operating agreement
- [ ] Lawyer reviews MLCC compliance + credential storage
- [ ] Customer signup + onboarding flow built
- [ ] Encrypted MILO credential storage built
- [ ] First customer (dad's store) using MVP

---

## Files of importance

- `services/api/src/app.js` — Express app entry point with all route mounts
- `services/api/src/index.js` — boot script, dotenv + Sentry init
- `services/api/src/rpa/stages/` — RPA Stages 1-4 (verified)
- `services/api/src/rpa/milo-discovery.js` — BLOCKLIST_RE + safety helpers
- `services/api/src/workers/execution-worker.js` — job queue worker
- `services/api/src/services/execution-run.service.js` — run lifecycle CRUD
- `services/api/src/mlcc/milo-ordering-rules.js` — MLCC compliance rules
- `apps/admin/` — admin SPA (operator review)
- `apps/scanner/` — scanner PWA (customer-facing)
- `supabase/migrations/` — 27 migrations, full schema
- `docs/PRODUCT_SPEC.md` — external product spec
- `docs/PRODUCT_SPEC_INTERNAL.md` — internal spec with equity, financials, risks
- `docs/SESSIONLOG.md` — session-by-session log
- `docs/WHATSNEXT.md` — current priorities (review at start of each session)
- `docs/PROJECT_STATE.md` — THIS FILE (master state)

---

## Session Continuity Protocol

**At start of every session:**
1. Open this file (`docs/PROJECT_STATE.md`)
2. Read "Top Priorities" + "Action Items"
3. Open `docs/SESSIONLOG.md`, read last 1-2 entries
4. Open `docs/WHATSNEXT.md` for current focus
5. Tell Claude: "Read PROJECT_STATE.md and SESSIONLOG.md and tell me where to start"

**At end of every session:**
1. Update PROJECT_STATE.md if architecture/decisions changed
2. Add a SESSIONLOG.md entry (template in that file)
3. Update WHATSNEXT.md if priorities shifted
4. Commit: `git add docs/ && git commit -m "session: <date> - <focus>"`
5. Push

This protocol eliminates context decay and lets every session start at full speed.