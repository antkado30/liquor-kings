# Liquor Kings — Launch-Readiness Audit

**Status:** Snapshot as of 2026-05-10. Based on direct code reads, not vibes. Use as a literal pre-launch punch list — cross items off as you decide.

**Legend:**
- 🟢 **GREEN** — works, tested, ship as-is
- 🟡 **YELLOW** — works but rough edges; defer-able post-launch but watch carefully
- 🔴 **RED** — half-done or unsafe; needs work before real customers depend on it
- ⚫ **BLACK** — not started; conscious gap or out-of-scope for pilot

---

## 1. RPA Pipeline (MILO automation) — 🟢🟡 mostly green

**Code:** `services/api/src/rpa/stages/` (5 stages, ~2,800 lines), `services/api/src/workers/` (18 files, ~28,000 lines). The single biggest engineering investment in the repo.

**What works:**
- 5 stages wired: login → navigate → add-items → validate → checkout
- Real production order placed 2026-05-07 (recent, real, tested)
- Submission gated by `LK_ALLOW_ORDER_SUBMISSION=yes` env var + `metadata.mode === "submit"` payload flag — dry_run is the default
- Phase-policy framework (2i/2k/2m/2p/2s/2u/2v-2w) for graduated behavior
- Heartbeat + progress reporting back to API during runs
- Evidence collection (DOM snapshots, screenshots, step logs) — meets your "internal truth" architecture goal
- Extensive test coverage (43 test files in `services/api/tests`, ~30 RPA-related)
- `npm run verify:lk:rpa-safety` invariant test in CI

**Rough edges:**
- The two giant workers (`mlcc-browser-worker.js` 6,243 lines, `mlcc-browser-add-by-code-probe.js` 18,210 lines) are nearly impossible to refactor safely. They work but they're load-bearing in a way that punishes future change.
- Selector resilience across MLCC UI redesigns is not proven at scale — only 1 prod order placed

**Launch impact:** Acceptable for pilot. First customer onboarded after you, with you watching the first 5 real submissions.

**What I'd do:** Ship as-is. After pilot, decompose the giant workers into smaller phase modules. Track every selector failure that happens in real customer use — those tell you which adapters need configuration vs hardcoding.

---

## 2. Scanner App (iOS Safari over HTTPS) — 🟢 green

**Code:** `apps/scanner/src/` (~3,000 lines TSX/TS).

**What works:**
- Barcode scanning via mkcert HTTPS + ZXing.js + iOS Safari camera (validated on Tony's iPhone)
- UPC → catalog match with three paths: direct UPC, UPCitemdb scoring, fallback to manual search
- Search engine: token-AND with alias + auto-prefix expansion (fixed Friday; further fix today for the `>= 3 head count` gate)
- Scanner search-pick auto-save: every customer pick writes a permanent `upc_mappings` row (`confidence_source = 'user_confirmed'`) — validated end-to-end on real hardware today
- UPC mapping poisoning fix shipped today: dismissable banner + auto-cancel when user clears the auto-filled search to empty
- Cart drawer with progress UI (idle → syncing → submitting → polling → done/error)
- Submission state machine + RPA run polling

**Rough edges:**
- `apps/scanner/src/pages/CartPage.tsx` is dead code — has a disabled placeholder button "Connect to your store to submit orders" with "Full submit flow is coming in a later release" text. Reachable via `/scanner/cart` route but no current code path navigates there.
- No frontend tests (0 tests in `apps/scanner/`)

**Launch impact:** Real customers can scan, find products, build carts, submit. The core experience is shipped.

**What I'd do:** Delete `CartPage.tsx` or replace its content with a redirect to the drawer flow — the "coming in a later release" text is exactly the kind of "good enough to continue" leftover you flagged. 30-min cleanup.

---

## 3. Cart & Submission Flow — 🟡 yellow

**Code:** `services/api/src/routes/cart.routes.js`, `cart-lifecycle.routes.js`, `cart-summary.routes.js`, `apps/scanner/src/hooks/useSubmission.ts`.

**What works:**
- POST /cart/:storeId/items accepts either `bottleId` OR `mlccCode` (per-store bottles auto-created)
- Cart → execution-run trigger → polling pipeline shipped Friday
- Cart state service tracks validation/execution lifecycle
- Cart-execution-payload service builds the payload sent to RPA worker

**Rough edges:**
- **Quantity rules barely populated.** `services/api/src/quantity-rules/index.js` has only 2 explicit SKU rules (MLCC code 7127 step-of-6) out of ~13,800 products. Unknown codes fall through to identity — no quantity snap.
- **Quantity rules not enforced at cart-add time.** `snapQuantityForMlccSku` is only called inside `mlcc-browser-worker.js` during RPA execution. Customer can add 7 of a 6-pack-only SKU; the issue only surfaces when MILO rejects deep in the RPA flow. Wastes a run.
- Cart drawer "Validate & Submit" button is on the right path, but the final success banner says "Order is in dry_run mode — no real order placed yet" — pilot stores will see this and wonder if their order actually went through. Real-vs-dry messaging needs a pass once `LK_ALLOW_ORDER_SUBMISSION=yes` is on for a store.

**Launch impact:** Cart submission works for normal SKUs. Edge-case SKUs (case-of-6, unusual pack sizes) will fail late instead of early. The dry_run text will confuse paying customers.

**What I'd do:** (a) Add a pre-submit validation call that runs `snapQuantityForMlccSku` against every cart item before the RPA fires, surfaces snaps to the user, asks them to confirm. (b) Branch the success banner text by `stage5Mode` so live-mode customers see "Order placed in MILO" not "dry_run." Both ~1 hour each.

---

## 4. MLCC Catalog & UPC Mapping Coverage — 🟡 yellow

**Code:** `services/api/src/mlcc/` (17 files, ~5,000 lines), `services/api/src/services/nrs-import.service.js`.

**What works:**
- MLCC price book auto-discovery + ingest from michigan.gov (13,828 items, ~60s end-to-end)
- NRS POS export → upc_mappings importer with tier-1 (direct UPC) + tier-2 (name+size+brand fuzzy) matching
- 4,170 confirmed mappings as of today (44% of NRS catalog)
- Brand alias map with truncation aliases (vanilla↔vanil, raspberry↔raspberri, etc.)
- UPC mapping audit table + flagging system (flag_count >= 2 deletes bad mappings)
- Three confidence sources tracked: `nrs_import_*`, `auto_high_score`, `user_confirmed`
- Per-row write fallback in NRS importer handles Kong socket drops gracefully

**Rough edges:**
- **1,329 ambiguous matches stuck waiting for review UI** (see Section 11). Worth 14% of catalog coverage if resolved.
- **3,879 NRS items have no MLCC match at all** — 41% of NRS catalog unmapped. Customers scanning these will fall through to manual search every time until someone hand-resolves them.
- Coverage will grow organically as customers scan + confirm — pilot phase fills this curve.

**Launch impact:** 44% pre-launch coverage means most popular bottles get instant scans; obscure tail falls through to search (which now works correctly post-Friday fix). Acceptable for pilot.

**What I'd do:** Ship the operator review UI (Section 11). Then optionally invest in UPCitemdb's paid tier ($49/mo) for bulk UPC enrichment.

---

## 5. Admin Dashboard (Operator Review) — 🟡 yellow

**Code:** `apps/admin/src/` (~7,600 lines TSX/TS), `services/api/src/routes/operator-review.routes.js` (732 lines).

**What works:**
- Sign-in via Supabase access token → HttpOnly session cookie
- Multi-store operator session with store switcher
- Operator overview page, pilot ops page (healthy/degraded/needs_attention store health), review queue, run detail, diagnostics page
- Run lifecycle timeline + attempt-level insights
- Workflow state tracking (unreviewed/watching/escalated/resolved) with history
- Bulk triage eligibility logic
- Failure guidance heuristics

**Rough edges:**
- **Sign-in is operator-grade, not customer-grade.** "Paste your Supabase access token" is fine for you and your team; not for store owners. Store owners shouldn't see this UI anyway.
- **Zero frontend tests** in apps/admin
- No customer-facing "I'm a store owner, here's my MILO credentials" UI — credential save is API-only via `PUT /stores/:storeId/mlcc-credentials`

**Launch impact:** The admin dashboard is YOUR cockpit, not the customer's. For pilot, you can use it to monitor each store's runs, flag issues, escalate. For self-serve onboarding, see Section 12.

**What I'd do:** Don't expose the admin app to customers. Use it internally for pilot oversight. Build a separate "store owner settings" minimal UI later (probably embedded in the scanner app once you have time).

---

## 6. Auth & Row-Level Security — 🟢 green

**Code:** `services/api/src/middleware/resolve-store.middleware.js`, multiple RLS migrations, dedicated tests.

**What works:**
- JWT + service-role bearer auth via `resolveAuthenticatedStore` middleware
- Timing-safe service role token comparison (resists timing attacks)
- Multi-tenant RLS isolation: every business table has `enable row level security` + store-membership policies
- `X-Store-Id` header for multi-store operators
- Dedicated test: `services/api/tests/unit/rls/red-tables-store-isolation.test.js`
- 401/403/400 error paths logged to `lk_system_diagnostics`

**Launch impact:** Multi-tenant safety looks solid. Stores cannot see each other's carts, runs, or credentials.

**What I'd do:** Nothing right now. Re-audit when you onboard the 3rd unrelated store — that's when RLS pressure spikes.

---

## 7. Credentials Encryption — 🔴 red (key management)

**Code:** `services/api/src/lib/credential-encryption.js` (94 lines).

**What works:**
- AES-256-GCM with versioned format (`v1:iv:authTag:ciphertext`)
- 12-byte random IV per encryption (never reused)
- 16-byte auth tag verifies ciphertext integrity
- Strict key validation: 32 bytes, hex-only
- No plaintext logging anywhere I could find

**Where it falls short:**
- **Single env var on a single host.** `LK_CREDENTIAL_ENCRYPTION_KEY` lives in `services/api/.env`. If that env var is wrong on a different deployment, every credential becomes unreadable.
- **No KMS integration.** Real production would use AWS KMS, GCP Cloud KMS, HashiCorp Vault, or Supabase Vault — anything that keeps the key off the application server.
- **No key rotation.** The `v1:` version prefix exists for forward compatibility but there's no rotation tooling.
- **No audit log.** Encrypt/decrypt operations aren't logged. If a credential is decrypted in an unexpected context, you'd never know.

**Launch impact:** Pilot with 2-3 stores you personally onboarded? Acceptable risk if you trust your laptop/server. **Paying customers under real liability?** This is your single largest legal/compliance exposure. If your server gets compromised, every customer's MLCC password is decryptable in one read of `.env`.

**What I'd do:** Before the first paying customer:
1. Move the key to Supabase Vault (simplest) or a managed KMS
2. Add an `encryption_key_audit` table + per-decrypt audit row
3. Build a rotation script (re-encrypt all rows under a new `v2:` prefix, keep `v1:` decrypt-compatible)

Plan for 2-3 days of focused work. Don't ship this gap to anyone paying.

---

## 8. Database Schema & Migrations — 🟢 green

**Code:** `supabase/migrations/` (28 migration files).

**What works:**
- 28 migrations apply cleanly on `supabase db reset` (validated today)
- Foundational tables, multi-tenant RLS, MLCC ingest schema, UPC mappings, audit tables, execution runs + attempts + operator actions, pilot ops workflow + history, credential metadata
- Each migration tagged with timestamp + descriptive name
- Some `IF NOT EXISTS` defensive idempotency in newer migrations

**Rough edges:**
- Local DB got wiped between Friday and today (root cause: probably `supabase stop --no-backup` or a Docker volume cleanup). Recovery was clean because all data is derivable from CSV + price-book ingest, but you should add a "what is preserved across `supabase stop`" note to your runbook.
- A handful of older migrations would fail if re-run on a non-fresh DB (CREATE TABLE without IF NOT EXISTS). Not a problem in practice — `db reset` runs them on a wiped DB.

**Launch impact:** Schema is production-quality. The reset issue was a local-dev gotcha, not a production risk.

**What I'd do:** Add a documented `db.runbook.md` describing reset, migration, and backup procedure. ~30 min.

---

## 9. Tests — 🟡 yellow (API solid, frontend zero)

**Code:** 43 test files in `services/api/tests/`, 1 in repo root (`tests/rpa/safe-mode-invariant.test.js`).

**What works:**
- Heavy unit coverage of MLCC scoring, RPA stages, phase policies, blocking hints, mapping backlog, operator review
- RLS isolation test (red-tables-store-isolation.test.js) — catches the worst class of multi-tenancy bug
- Anti-drift tests (anti-drift-execution-model, anti-drift-invariants) keep schema and code consistent
- Smoke tests against staging Supabase on `main` pushes
- SAFE-MODE invariants in CI prevent accidental MLCC network calls during tests
- `npm run test:ci` runs cleanly in CI

**Rough edges:**
- **Zero frontend tests** — 0 tests in `apps/scanner/`, 0 in `apps/admin/`. All frontend verification is manual.
- No end-to-end tests (no Playwright tests against the running scanner/admin)

**Launch impact:** API regressions are well-protected. Frontend regressions only get caught when you or a pilot store finds them.

**What I'd do:** Add Playwright tests for the 3 scanner critical flows: (1) scan → confident match → cart, (2) scan → fallback → search → pick → mapping save, (3) cart submission state machine happy path. ~1 day. Defer until post-pilot if time-constrained.

---

## 10. CI/CD & Production Deployment — 🟡⚫ split

**Code:** `.github/workflows/liquor-kings-ci.yml`.

**What works (CI):**
- Tests run on push + PR (SAFE-MODE only, no real MLCC calls)
- RPA safety verification job
- Staging smoke tests on `main` pushes
- All MLCC network calls are explicitly blocked in CI env

**Where it's missing (CD):**
- **No deploy pipeline.** No Dockerfile, no production hosting config visible.
- **No production environment** that I can see — the API is presumably running on your laptop or a dev VPS

**Launch impact:** You can't onboard real customers without somewhere production-grade for the API to live. This is launch-blocking.

**What I'd do:** Pick a host (Fly.io, Railway, Render — easiest for Node + Playwright). Build a Dockerfile that includes Chromium for RPA. Set up:
1. Production Supabase project (separate from local)
2. Production env vars (incl. KMS-managed `LK_CREDENTIAL_ENCRYPTION_KEY`)
3. Deploy workflow on `main` push
4. Health check + uptime monitoring

Plan: 1-2 days for the first deploy if you've done this before; longer if you haven't. Highest-leverage thing to spend a Saturday on.

---

## 11. Operator Review UI for Ambiguous UPC Matches — 🔴 red

**Mentioned everywhere; not built.**

**What exists:**
- `services/api/src/mlcc/mlcc-mapping-backlog.service.js` (385 lines) — API surface for retrieving + acting on the ambiguous bucket
- The 1,329 ambiguous matches are in DB right now with full top-3 candidate data per row (`tier2Ambiguous` items from NRS import)

**What's missing:**
- The actual admin UI screen. Spec from Friday: UPC | NRS name | top-3 MLCC candidates (name/code/price) | "✓" buttons to confirm one.
- Bulk-action ergonomics (keyboard shortcut to confirm top candidate, etc.)

**Launch impact:** Catalog coverage stalls at 44% until built. 14% lift available with this one screen.

**What I'd do:** Cursor brief, multi-file. Probably 3-4 hours. You sit down for one session, clear half of them in 90 minutes once the UI is right. The whole 1,329 cleared = catalog at ~58%.

---

## 12. Customer Onboarding & Billing — ⚫ black (intentionally?)

**What exists:**
- Internal: you can create a `stores` row, add a `store_users` row for an owner, save MLCC credentials via API (`PUT /stores/:storeId/mlcc-credentials`), and onboarding is done
- No self-serve signup flow
- No billing / payments / Stripe integration anywhere in the codebase
- No usage metering / invoicing

**Launch impact:** Pilot is fine without these (you onboard the first 3-5 stores by hand, free or barter). Real growth past 10+ stores will require a self-serve front door.

**What I'd do:** Defer until you have 3 happy pilot stores actually using it. The shape of self-serve becomes clear only after you've onboarded a few people manually and felt the friction. Don't build this in advance.

---

## 13. Monitoring & Observability — 🟢 green

**Code:** Sentry wired in API + both frontends. `services/api/src/services/diagnostics.service.js`. `lk_system_diagnostics` table.

**What works:**
- Sentry initialization in API (`services/api/src/lib/sentry.js`) + scanner + admin
- Express error handler integration
- System diagnostic events (UNAUTHORIZED, MISSING_STORE, STORE_MISMATCH) logged to DB
- Pilot ops health monitoring per-store with attention-overdue flags
- Operator review dashboard surfaces failed runs with full failure context
- RPA evidence collection (DOM, screenshots, step logs)

**Launch impact:** When something goes wrong in pilot, you'll know fast and have evidence to debug.

**What I'd do:** Make sure Sentry DSN is set in production env when you deploy. Configure Sentry alerts for the 5 most important error categories (RPA failures, auth failures, DB errors, MLCC selector breakage, credential decrypt failures). 1 hour.

---

## 14. Documentation — 🟢 green

**Code:** `docs/lk/architecture/` has 8 canonical docs.

**What works:**
- `strategic-architecture.md` — execution lanes, reconciliation model
- `api-contract-truth.md` — HTTP surfaces
- `auth-and-store-scoping-invariants.md` — isolation rules
- `execution-state-machine.md` — run lifecycle
- `rpa-rebuild-phases.md` + `rpa-safety-rules.md` — phase-gated automation
- `mlcc-dry-run-repeatability.md` — operator readiness
- `product-identity-system.md` — UPC mapping vision (added Friday)

**Launch impact:** A new engineer joining you in 6 months can orient themselves. This is rare and good.

**What I'd do:** Add this audit doc to the architecture index as a living document. Update it every 2-4 weeks while you're in pilot.

---

# Launch-Blocker Punch List (ranked)

In strict priority order — **highest impact / hardest to defer first**:

1. **🔴 KMS migration for credential encryption key.** Single largest legal/compliance exposure. ~2-3 days.
2. **⚫ Production deployment pipeline.** Can't onboard real customers without a hosted instance. ~1-2 days.
3. **🟡 Cart-time quantity rule enforcement.** Prevents wasted RPA runs on edge-case SKUs. ~1 hour.
4. **🟡 Real-vs-dry_run banner text in scanner cart drawer.** Paying customers will be confused by "Order is in dry_run mode" text. ~30 min.
5. **🔴 Operator review UI for the 1,329 ambiguous matches.** Lifts catalog coverage from 44% → ~58%. ~3-4 hours.
6. **🟡 Delete or fix scanner CartPage.tsx dead code.** Visible to anyone who URL-types `/scanner/cart`. ~30 min.
7. **🟡 Frontend Playwright tests for 3 critical flows.** Catches regressions before customers do. ~1 day. Defer-able.
8. **🟡 Database operations runbook.** Document reset/migration/backup procedure. ~30 min.

**Total focused work for must-do items (#1-4):** ~3-4 days.  
**Total to make pilot really solid (#1-6):** ~5-6 days.  
**Coverage curve from organic customer scans** then takes over and grows the catalog without further engineering.

---

# What's Actually Production-Ready Right Now

If you ignored every red and black item above and pointed a friendly pilot store at the system tomorrow, here's what would work:

- They scan bottles — the system finds them or asks them to search
- Their scan-then-pick teaches the system permanently (catalog grows with use)
- They build a cart from real prices off the MLCC catalog
- They submit, the RPA logs in to their MILO account, adds the cart, validates
- They see progress in the drawer; the dry_run protection stops short of submitting a real order until you flip the env flag
- You watch them from the admin dashboard, see if their runs go green/yellow/red
- All their data is RLS-isolated from other future stores

That's a real product. The reds and blacks above are about expanding from "one friendly pilot" to "I can take a stranger's money tomorrow." Different things.

---

*Generated 2026-05-10. Re-audit after each pilot cohort or major refactor.*
