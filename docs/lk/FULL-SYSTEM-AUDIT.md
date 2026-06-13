# LIQUOR KINGS — FULL SYSTEM AUDIT

**Ordered by Tony, 2026-06-12:** "Go from start to finish of the whole
database — every single file, every single code. Check for defects, check
what could break down the line. V1 should feel like the complete product."

**The bar this audit certifies against** (per the Quality Mandate +
Integrity Doctrine): nothing ever breaks from OUR side; where LK depends
on the outside world (MILO's DOM, MLCC's file formats, Supabase, iOS),
change is DETECTED and reported in plain English — never a silent lie,
never a mystery spinner, never a wedge.

**Method:** subsystem-by-subsystem in blast-radius order. Every defect
gets a severity. Safe fixes are made immediately and individually
verified; risky fixes (worker/RPA surgery, schema changes) are written up
for Tony's call first. Known bug CLASSES are swept globally, not spot-fixed.

**Severities:**
- **P0** — can lose/corrupt an order, lie to the user, or take the system down
- **P1** — breaks a feature or wedges a flow; user sees failure without explanation
- **P2** — degrades quality/perf/maintainability; will bite within a year
- **NOTE** — accepted risk or external dependency tripwire, documented

**Status legend:** 🔴 found, unfixed · 🟡 fixed, awaiting deploy · 🟢 fixed + deployed · ⚪ needs Tony's call

---

## Ledger (running tally)

| # | Sev | Subsystem | Finding | Status |
|---|-----|-----------|---------|--------|
| 1 | P0 | Worker | Zombie Chromium leak via withOverallTimeout race → machine starvation (the 06-09→06-11 wedge) | 🟢 fixed (abandon token) + deployed 06-12 |
| 2 | P0 | Worker | No self-healing on consecutive login failures — wedge persisted 2 days | 🟢 dead-man switch deployed 06-12 |
| 3 | P0 | Infra | LK_ALLOW_ORDER_SUBMISSION absent on worker app — every real submit silently dry-ran since 06-08 split | 🟢 secret set + toml hardcode removed 06-12 |
| 4 | P1 | Server | Typed failure codes flattened to UNKNOWN at recording boundary; explicit UNKNOWN killed message sniffing | 🟢 classifier pass-through deployed 06-12 |
| 5 | P1 | Client | validateDone/submitDone dropped failure_type/failure_message (submitDone hardcoded null) — "finished as failed" with no reason | 🟢 contract + humanizer + failure card deployed 06-12 |
| 6 | P0 | Client | AuthGate boot: no catch/finally + unbounded store_users await + auth-lock deadlock pattern → infinite "Loading your account" on flaky network | 🟢 hardened (timeouts/retry screen) — deployed 06-13 |
| 7 | P1 | Client | Camera/ZXing decode loop hardcoded-active behind overlays; fresh 1MP canvas per tick + ×4 rotations every tick → overheating, laggy taps | 🟢 sleep + reuse + throttle deployed 06-12 |
| 8 | P1 | Data | Catalog photos stored at original retailer size (1–3MB) into a phone grid | 🟢 thumbs+capped fulls in prod; right-size at birth deployed 06-12 |
| 9 | P1 | Data | UPC tier-2 scoring: editions could outrank base (Lions class); unknown-size let nips tie fifths (Maker's class) | 🟢 penalty + retail prior deployed 06-12 |
| 10 | P1 | Data | Photo verify: sub-brand collisions passed both gates (Parrot Bay class) | 🟢 text Rule 3 + vision rule deployed 06-12 |
| 11 | P2 | Deps | npm reports 13 advisories total across root/services/api/apps/admin/apps/scanner (incl. a HIGH-severity react-router RCE shipped in the scanner SPA) | 🟢 10/13 fixed via `npm audit fix` (no major bumps) — incl. the HIGH react-router RCE. Remaining 3 (uuid/exceljs — not exploitable via this app's single `uuid.v4()` call; esbuild/vite — dev-server-only, deferred past the feature-freeze). See §5 |
| 12 | NOTE | Data | nrs_import EMPTY in prod → all 4,179 UPC mappings unverifiable | ⚪ needs Tony's NRS export → load-nrs-import.mjs → audit --apply |
| 13 | P1 | Infra | Zero error reporting (SENTRY_DSN + VITE_SENTRY_DSN unset; code is Sentry-ready both sides) | 🟢 resolved via #29 — 3 Sentry projects created, DSNs wired, deployed 06-13 |
| 14 | P0 | Server | **UPC catalog-truth WRITES wide open** — /upc/:upc/confirm (writes user_confirmed mappings, exempt from safety swaps), /flag, /report-no-match had NO auth. Anyone could remap any barcode for every store | 🟢 sealed + deployed v149 |
| 15 | P0 | E2E | **Submit could lie: "Order submitted to MILO" on a dry-run downgrade.** Stage-5 triple gate silently downgrades submit→dry_run; run finalizes "succeeded"; truth lived only in workerNotes/evidence; green banner showed AND cleared the user's cart. Any not-yet-armed store's first submit = phantom order | 🟢 sealed: submit_result lifted into run summary (validate_result pattern) → client requires submitted===true for the green banner; amber "Nothing was ordered" + cart PRESERVED otherwise. 5/5 proofs. Deployed 06-13 |
| 15b | NOTE | UX | Tony decision 2026-06-13: don't reject submit upfront (still run the preview RPA — verifies cart/pricing), but tell the user UP FRONT in the pre-submit modal, before the ~2-min run, that this store isn't approved for live orders yet and Submit will run as a preview only. "Be completely transparent... build trust with customers and avoid legality issues." | 🟢 SubmitConfirmationModal shows an informational "Preview only — no order will be placed" notice + button reads "Run preview (no order placed)" when not armed (allow_order_submission plumbed home.routes.js → home.ts → ScannerPage → CartDrawer → modal). Post-result "Nothing was ordered" banner adjusted to reference the earlier notice. Deployed 06-13 |
| 16 | P1 | Worker | cart_reset_only success path missing `runSucceeded = true` → every successful cart reset / activation probe tore down the healthy warm session → next validate paid the 2-min cold path | 🟢 fixed + deployed 06-13 |
| 17 | P0 | Worker | **No boundary comparison before live submit (doctrine #11)** — a partial Stage-3 outcome (e.g. 81 of 84 verified) flowed into Stage 5 and silently submitted a short order. Pre-submit modal shows the LOCAL cart, so no layer caught it | 🟢 sealed: hard gate refuses live submit on ANY requested-vs-verified mismatch (missing, qty, unexpected item), typed MLCC_CART_MISMATCH_BEFORE_SUBMIT, full mismatch list in evidence. 10/10 proofs. Deployed 06-13 |
| 18 | P1 | Worker | Stage-3 budget flat 240s regardless of cart size — 84 sequential adds ≈ at/over budget = the 2026-06-10 "4-minute validate death" class | 🟢 budget scales (120s + 4s/item, 240s floor, 600s cap; 84 items → 456s). Reaper-safe (per-item heartbeats). Deployed 06-13 |
| 19 | P1 | Worker/UX | Stage 3 emitted ONE heartbeat then went silent for minutes on big carts — blind wait (mandate violation) | 🟢 per-item onProgress → throttled heartbeats ("Adding items — 37 of 84"); guarded so progress can never sink a run. Deployed 06-13 |
| 20 | P0 | Worker | **No duplicate-submit protection across the crash window** — a run reaper-killed or timing-out mid-checkout reads as plain "failed"; a retry would place a second MILO order | 🟢 tripwire: refuses live submit when a same-store submit died AT CHECKOUT ambiguously within 30 min (error-toast/safety/boundary refusals exempt — those provably didn't submit); fails SAFE if the check itself errors. 7/7 proofs. Deployed 06-13 |
| 21 | P0 | Server | **Nothing serialized runs per store across 2 worker machines** — claim is atomic per RUN only; two queued runs for one store could run concurrently, two browsers fighting one account-scoped MILO cart (live risk since the worker app has 2 machines) | 🟢 sealed: partial unique index `one_running_run_per_store` (migration 20260613013000) + claim prefilters busy stores + treats 23505 as lost-claim. Migration applied to prod + deployed 06-13 |
| 22 | P1 | Server | Reaper destroyed forensics (overwrote progress_stage with "reaped") and stamped UNKNOWN — hiding exactly the died-at-checkout signal #20 needs | 🟢 stage preserved, typed LK_RUN_REAPED, humanized. Deployed 06-13 |
| 23 | P2 | Worker | Hardcoded UNKNOWN failure types where precise codes existed (decrypt/no-creds/invalid-items/no-license) — actionable guidance hidden | 🟢 precise codes + humanizer entries. Deployed 06-13 |
| 24 | P0 | Worker | **Stage 5 checkout called with `timeoutMs: 60_000` — far below checkout.js's own documented real-submit worst case (POST_SUBMIT_WAIT_MS 75s + HISTORY_FETCH_BUDGET_MS 90s backstop + setup ≈ 185s).** Every large-cart real submit could time out AFTER the Checkout click already fired (order placed on MILO), get finalized "failed: MILO_STAGE5_TIMEOUT" with a FALSE no-submit attestation, lose the confirmation numbers, while checkout.js's orphaned `run()` kept executing against `session.page` racing the orchestrator's session release | 🟢 fixed: 240_000ms (covers 185s w/ margin, matches checkout.js's own 180s default intent). Residual risk (>240s) still caught by #20's duplicate-submit tripwire. Deployed 06-13 |
| 25 | P1 | Client | **3x bare `fetch()` with no AbortController/timeout — same unbounded-await spinner-deadlock class as #6's original AuthGate hang.** `api/tags.ts` (`fetchTagsHtml` → `/tags/render`), `AuthGate.tsx` (`/auth/signup` — new-store onboarding), `TagPrintPreview.tsx` (`/tags/render.pdf` share). A stalled response left "Print Tags" / "Creating account…" / "Preparing PDF…" spinning forever — the `finally` that resets the spinner state never runs because the `await` itself never settles. Also: `OrderDetailPage.printAllTags` set `printingTags` outside try/finally (same dead-end if `fetchTagsHtml` ever threw) | 🟢 all 3 routed through `fetchWithRetry` (AbortController-based): tags.ts/TagPrintPreview 15s+2 retries (idempotent), AuthGate signup 20s+0 retries (non-idempotent — no retry to avoid double-signup on a lost response). OrderDetailPage wrapped in try/finally. tsc --noEmit clean. Deployed 06-13 |
| 26 | P1 | Schema | **mlcc_code_map and mlcc_item_codes — read on every add-to-cart/checkout identity-verify (bottle-identity.service.js) — have NO migration anywhere.** They exist in prod only via a hand-created table captured once in the stale March 2026 `supabase/schema.sql` dump (itself missing ~15 current tables — not trustworthy as "the schema"). A prod restore from migrations alone, or any fresh dev/staging DB, would be missing both tables; the mlcc_item_codes code-rotation fallback would then error CODE_MISMATCH("mlcc_resolve_failed") on every add-to-cart that misses a direct mlcc_items.code hit. Also: `nrs_import` (finding #12) has the same gap — no migration, schema only ever inferred ad-hoc by the audit script's column-sniffing | 🟢 migration 20260613020000 adds both tables `IF NOT EXISTS` (no-op on prod) + enables RLS + permissive authenticated-SELECT (matches global-catalog pattern; service-role bypasses RLS regardless). Dropped dead `source_snapshot_id`→`mlcc_pricebook_snapshots` FK (that target table is itself unmigrated prototype cruft, zero current code refs). nrs_import schema NOT guessed — left to #12's resolution (Tony's NRS export reload), where the table should get a real migration once its real columns are known. Migration applied to prod + deployed 06-13 |
| 27 | P0 | Server | **`GET /test-db` and `GET /test-bottles` were live, unauthenticated, public debug routes in `app.js`** — `SELECT * FROM stores LIMIT 1` and `SELECT * FROM bottles LIMIT 5` via the service-role client (bypasses RLS), reachable by anyone at `liquor-kings.fly.dev/test-db` with zero auth. `stores.*` includes `mlcc_username`, `mlcc_password_encrypted`, `liquor_license`, full address, store name — i.e. the first store's MLCC portal username + encrypted password + business license, world-readable. A prior audit (`docs/lk/auth-endpoint-audit.md`) flagged both as unauthenticated back when written and they were never removed. | 🟢 both routes deleted from `app.js` (unused `supabase` import removed too). `node --check` clean. **In tree — this closes a live prod credential-exposure hole once deployed; should be in the next deploy batch, not held for convenience** |
| 28 | P1 | Client (admin) | **Every fetch in `apps/admin/src/api/*.ts` (the Command Deck) was a bare `fetch()` with no timeout — same unbounded-await spinner-deadlock class as #6/#25.** Worst instance: `OperatorSessionContext.loadSession()`'s `getSession()` call on EVERY app boot — a stalled `/operator-review/session` response left `AppShell` showing "Checking session…" forever (the `finally { setBootstrap("ready") }` never ran), locking Tony out of the entire Command Deck (founder console, operator review, NRS review, diagnostics, pilot ops, catalog images) with no error and no recovery short of reload (which hits the same hang again on a genuinely bad connection). Secondary gap found during the sweep: `nrsReview.ts`'s `fetchPendingReviews`/`resolveReview`/`skipReview` had no try/catch around their fetch calls, so a thrown network error would leave `NrsReviewPage`'s `loading`/`acting`/`refillingRef` state stuck (no try/finally on the caller side). Also: `lib/supabaseAuth.ts`'s sign-in POST had no timeout — a stalled Supabase auth call would leave `SignInView`'s "Signing in…" button stuck. | 🟢 new shared `apps/admin/src/api/fetchWithRetry.ts` (AbortController timeout + bounded retry, mirrors scanner's helper). All 12 `operatorReview.ts` fns, both `founderConsole.ts` fns, all 4 `nrsReview.ts` fns, and all 3 `catalogImages.ts` fns converted (GET/idempotent → 2 retries, mutations → 1, 10–15s timeouts). `nrsReview.ts`'s 3 functions now wrap `fetchWithRetry` in try/catch and return `{ok:false, error}` instead of throwing (matches `founderConsole.ts`'s existing never-throw contract) — closes the stuck-loading/acting/refilling gap without touching every page. `PilotOpsPage.loadDetail`/`saveWorkflowState` wrapped in try/catch (now surface "Network error..." instead of an unhandled rejection). `supabaseAuth.ts` sign-in POST now has a 15s AbortController timeout. `cd apps/admin && npx tsc --noEmit` clean; `vite build` succeeds (303 modules). Deployed 06-13 |
| 29 | P1 | Infra/Sentry | **#13's "code Sentry-ready, no DSNs" framing was incomplete — two more gaps meant DSNs alone wouldn't have fixed it.** (1) `run-rpa-worker.js` (the RPA daemon, `liquor-kings-worker`'s actual CMD) never called `initSentry()` — only `services/api/src/index.js` (the API process) did. The worker is the surface that matters most given the 2026-06-09 wedge incident, and it was invisible to Sentry no matter what `SENTRY_DSN` was set to. (2) `apps/admin`/`apps/scanner`'s `VITE_SENTRY_DSN` is read by Vite at BUILD time (`import.meta.env`), but `fly secrets set VITE_SENTRY_DSN=...` only sets a RUNTIME env var on the deployed machine — it never reaches the Docker build, so the old docs' Step 3 silently did nothing for both SPAs in prod. Tony has 3 Sentry projects ready (`liquor-kings-api`, `-scanner`, `-admin`). | 🟢 `run-rpa-worker.js` now calls `initSentry()` on boot. `Dockerfile` web-builder stage takes `ARG VITE_SENTRY_DSN_ADMIN`/`VITE_SENTRY_DSN_SCANNER`, sets `VITE_SENTRY_DSN` per-build before each `vite build` so each SPA reports to its own Sentry project. `fly.toml`'s `[build.args]` filled with the 3 real DSNs (public-by-design, committed). `SENTRY_DSN` set as a runtime secret on both `liquor-kings` and `liquor-kings-worker`. `docs/lk/sentry-and-cron-setup.md` rewritten with the corrected 3-project / build-arg flow. Both apps redeployed 06-13 — `liquor-kings` health check green post-deploy. |

---

## §1 Money path (cart → validate → submit → confirmation)
*Status: ✅ COMPLETE 2026-06-13*

Read end-to-end: login.js, navigate-to-products.js, add-items-to-cart.js,
validate-cart.js, checkout.js, execution-worker.js (orchestrator),
execution-run.service.js, execution-runs.routes.js (trigger/claim routes),
resolve-store.middleware.js, store-param.middleware.js,
require-service-role.middleware.js.

**FINDING #24 (P0) — Stage 5 called with a 60s timeout against a ~185s
documented worst case.** The single most important finding of this pass —
see ledger. Fixed in execution-worker.js, 🟡 in tree.

**Cleared as sound:**
- Stage 2 (navigate-to-products.js): typed errors throughout, host-pinned
  to michigan.gov, BLOCKLIST_RE + action-text checks before every click,
  graceful degradation when delivery dates don't parse (warns, doesn't
  fail). No hardcoded timeout overrides from the orchestrator — uses its
  own scaled 150s default. ✓
- Stage 3 (add-items-to-cart.js), dedicated pass 2026-06-13: 18 typed error
  codes, every `page.evaluate()` bounded via `raceStage3Timeout`, overall
  budget scaled per-item (#18). "Cart-state verification v2" cross-checks
  reported `itemsAdded` against the real `/milo/cart` DOM (active vs OOS
  tables) and produces typed errors for clamping/OOS-demotion/missing
  items rather than trusting MILO's UI response. Pre-flight
  `clearCartIfPopulated()` is best-effort with a hard failure only if
  Clear was clicked but didn't empty (`MILO_STAGE3_CART_CLEAR_FAILED`); the
  v2 verification is an independent backstop if clear silently no-ops. ✓
- Stage 4 (validate-cart.js): thorough DOM parsing with PARSE_FAILED
  fallback when totals+orders+OOS are all empty; "validate-time demotion"
  cross-check (Stage 3 verified vs Stage 4 seen) feeds `outOfStockItems`
  and gates `canCheckout` — an independent safety net on top of #17's
  Stage 5 boundary gate. ✓
- Stage 5 (checkout.js) safety gates: `clickCheckoutButtonSafely` re-checks
  URL, `session.canCheckout`, exact button text "Checkout", visible+enabled
  immediately before clicking — defense in depth even if an upstream gate
  were ever bypassed. Confirmation parsing has a real (not theoretical)
  backstop: thank-you page → /milo/account/orders scrape, with date+ADA-count
  matching. ✓
- Trigger/claim routes (execution-runs.routes.js): `/claim-next` is
  service-role-only (`requireServiceRole`); all store-scoped routes go
  through `resolveAuthenticatedStore` (timing-safe service-role check, ES256
  JWT fast path + getUser fallback, multi-store X-Store-Id enforcement) +
  `enforceParamStoreMatches` (URL :storeId must equal req.store_id, 403 +
  diagnostic log on mismatch). No gaps found. ✓

**Residual/NOTE:** Stages 2/3/4/5 all use the same "withTimeout doesn't cancel
the in-flight `run()`" pattern as login.js's pre-fix bug — only Stage 3 and
Stage 5 (real clicks vs. discarded results) make this dangerous, and #24's
budget fix removes the realistic Stage 5 trigger. Stage 3 has its own
backstop even without an abandon token: every Stage 3 attempt opens with
`clearCartIfPopulated()` (pre-flight cart clear), so any items a zombie/
abandoned prior run() managed to click "Add" on after the orchestrator gave
up get wiped before the next real attempt adds anything — same shape as
#20's duplicate-submit tripwire for Stage 5. If MILO ever gets *structurally*
slower (Stage 3 budget already scales per-item per #18; Stage 5 >240s),
the same class of issue could resurface. Not fixing preemptively — would
mean threading an abandon-token through 4 more stage files for a residual
case the existing tripwires already cover safely.

## §2 Env/secret inventory (every process.env read vs both Fly apps)
*Status: ✅ COMPLETE 2026-06-12*

Swept all 41 distinct `process.env.*` reads (API + worker + scripts) and all
`import.meta.env.*` reads (scanner client) against: liquor-kings secrets,
liquor-kings-worker secrets, fly.toml [env], fly.worker.toml [env], and
baked client env (.env.production).

**FINDING #13 (P1) — Zero error reporting in production, client AND server.**
`SENTRY_DSN` (server, 2 read sites) and `VITE_SENTRY_DSN` (client) are unset
everywhere; the code on both sides is already Sentry-ready and no-ops without
a DSN. Consequence: when LK breaks in the field, nobody is told — tonight's
AuthGate hang would have produced a visible stack trace + alert. For
"set-and-forget," the system MUST phone home. **Needs Tony (~10 min):**
sentry.io account (free tier fine) → two DSNs (one browser project, one node)
→ `fly secrets set SENTRY_DSN=… -a liquor-kings` (+ same on worker) and
`VITE_SENTRY_DSN` into apps/scanner/.env.production → redeploy. Status: ⚪

**Cleared as sound:**
- `WORKER_ID` — daemon defaults to `rpa-worker-${FLY_MACHINE_ID}`; the two
  worker machines ARE distinguishable in runs/attempts. ✓
- `UPCITEMDB_API_KEY` absent → graceful trial-endpoint fallback (degrades,
  never crashes; UPC flow has other tiers). ✓
- `SUPABASE_JWT_SECRET` — legacy HS256 read; ES256 JWKS path is active and
  zero-config, fallback covers. Harmless unset. ✓
- `ANTHROPIC_API_KEY` — confirmed NOT needed by worker/stages (assistant +
  vision live in the API app, where it's set). ✓
- `LK_ALLOW_ORDER_SUBMISSION` — fixed earlier today (Ledger #3). ✓
- All `MILO_TEST_*`, `*_HEADFUL`, `DEBUG_UPC_FILTER`, discovery flags — dev/
  test-runner only, never read on prod paths. ✓
- Tunables (`LK_PICKER_*`, `LK_CONFIDENT_*`, `ANTHROPIC_MODEL`, etc.) — all
  have sane in-code defaults. ✓

**Parked for §1:** `VITE_UPC_CONFIRM_TOKEN` (optional bearer for
POST /price-book/upc/:upc/confirm) — verify the in-app UPC mapping-confirm
flow doesn't silently no-op without it.

## §3 Client silent-failure sweep (unbounded awaits, swallowed catches, spinner dead-ends, leak-prone listeners)
*Status: ✅ COMPLETE 2026-06-13*

Swept all `apps/scanner/src/api/*.ts` (14 files) for missing
timeout/retry; all `setLoading`-style spinner-state files (SettingsPage,
TemplatesPage, ScheduledTemplateBanner, MlccCredentialsForm,
useCatalogSearch, useMlccVerifyProbe, swr.ts, OrderDetailPage,
ProductCard, plus the already-fixed AuthGate boot path #6); and every
`addEventListener`/`setInterval` for leak-prone listeners.

**FINDING #25 (P1) — 3x bare `fetch()` with no AbortController/timeout,**
the same class as #6's original AuthGate boot hang. See ledger. All fixed
via `fetchWithRetry`, verified `tsc --noEmit` clean.

**Cleared as sound:**
- `lib/swr.ts` (the shared cache powering "instant tabs"): every fetcher
  path wrapped in try/catch/finally, `promise` always cleared, subscribers
  always unsubscribed on unmount. ✓
- `api/*.ts` (13 of 14 files, all but tags.ts pre-fix): all go through
  `fetchWithRetry` (catalog.ts) — AbortController-based timeout (8-30s
  depending on endpoint), exponential backoff on 5xx/network errors, 4xx
  returned immediately without retry. ✓
- `hooks/useMlccVerifyProbe.ts`: polling loop is hard-bounded by
  `MAX_POLL_MS = 180_000`; each poll itself goes through `getRunSummary`'s
  own timeout. Can't hang forever. ✓
- `hooks/useCatalogSearch.ts`: try/catch/finally + request-counter
  staleness guard (stale responses can't clobber a newer search) +
  debounce cleanup on unmount. ✓
- `TemplatesPage.tsx` EditTemplateModal: already has the
  "never leave Save spinning" try/finally from the 2026-06-09 stuck-spinner
  sweep. ✓
- `SettingsPage.tsx`, `MlccCredentialsForm.tsx`,
  `ScheduledTemplateBanner.tsx`: all loading-state setters paired
  correctly; banner's fetch-on-mount has a `cancelled` flag for the
  unmount race. ✓
- Leak-prone listeners: `BrowsePage` scroll listener, `useOnlineStatus`
  online/offline listeners, `OnboardingActivation`/`CartDrawer` elapsed-time
  intervals, `TagPrintPreview` iframe load listener, `BarcodeScanner`
  visibilitychange/intervals (fixed earlier, #7) — all have correct
  `removeEventListener`/`clearInterval` cleanup in their effect's return. ✓

## §4 Auth / tenancy / RLS / schema-vs-code
*Status: ✅ COMPLETE 2026-06-13*

**FINDING #27 (P0) — two live, unauthenticated debug routes leaking prod
credentials.** `GET /test-db` and `GET /test-bottles` in `app.js` ran
`SELECT * FROM stores LIMIT 1` / `SELECT * FROM bottles LIMIT 5` via the
service-role client with NO middleware — reachable by anyone, no token, no
session. `stores.*` includes `mlcc_username`, `mlcc_password_encrypted`,
`liquor_license`, and full address. A prior audit
(`docs/lk/auth-endpoint-audit.md`) had already flagged both as
unauthenticated and they were never removed. **Both routes deleted**
(unused `supabase` import in `app.js` removed too), `node --check` clean.
This is a live prod data-exposure hole until the next deploy ships it.

**FINDING #26 (P1) — schema-vs-code drift on two tables read every
add-to-cart/checkout.** See ledger — `mlcc_code_map` / `mlcc_item_codes`
have no migration anywhere (only existed via a hand-created table, captured
once in the stale March 2026 `supabase/schema.sql`). New migration
`20260613020000` adds both `IF NOT EXISTS` (no-op on prod) and closes the
RLS gap on prod's existing tables (global-catalog pattern: enabled +
permissive `authenticated` SELECT, service-role bypasses anyway). `nrs_import`
(finding #12) has the identical gap but its schema is genuinely unknown
(only ever column-sniffed by the audit script) — left to #12's resolution
rather than guessed.

**RLS recursion fix (2026-06-06) verified sound.** `store_users` policies
were rewritten own-row-only (`user_id = auth.uid()`) after an infinite-
recursion bug. Confirmed the downstream `stores`/`bottles` EXISTS-based
store-membership policies (from `20260410180000`) still work correctly —
the EXISTS subquery's own RLS doesn't conflict with the
`su.user_id = auth.uid()` filter already present in those policies.

**"Global catalog" RLS pattern confirmed correct across the board.**
`mlcc_items`, `mlcc_brand_aliases`, `upc_lookups`, `mlcc_rules`,
`mlcc_price_book_runs` — all RLS enabled, permissive SELECT for
`authenticated` (or `mlcc_rules`: anyone, intentional for public reference
data), writes service-role-only. `nrs_ambiguous_review`, `upc_match_audit`,
`upc_mappings`, `lk_system_diagnostics` — all RLS enabled, service-role-only
(no policy for `authenticated` at all — correctly locked down, these carry
audit/PII-adjacent data).

**Route-mount auth audit (`app.js`).** Every store-scoped router
(`/cart`, `/inventory`, `/bottles`, `/execution-runs`, `/stores`, `/catalog`,
`/orders`, `/tags`, `/home`, `/order-templates`) is mounted behind
`resolveAuthenticatedStore`. `/admin`, `/admin` (nrs-import, nrs-review) use
`X-Admin-Token`. `/order-templates/run-scheduler` and
`/price-book/upc/:upc` are deliberately app-level + unauthenticated/
cron-token by design (documented, global-catalog data) — both sound.
`priceBookUpcFlagHandler` (the #14 write-path fix) still requires
`requireUserOrServiceRole`. ✓

**Known, already-tracked gap (not new) — `/assistant/ask` trusts a
client-supplied `storeId`** with no `resolveAuthenticatedStore` check
(comment in `assistant.routes.js`: "V1 auth posture... V1.5 hardening item —
tracked, not forgotten"). Exploitability requires knowing another store's
UUID (122 bits, not enumerable, not exposed cross-tenant anywhere found in
this audit) — noted here for completeness, not re-litigated as a new
finding since it's already an explicit, written-down decision.

## §5 Infra, dependencies, external-change tripwires
*Status: ✅ COMPLETE 2026-06-13*

**Resolves finding #11.** npm audit across all 4 package.json's (root,
`services/api`, `apps/admin`, `apps/scanner`) found 13 advisories total
(services/api: 6 — 5 moderate/1 high; root+admin+scanner: 7/6/7,
overlapping shared deps). Triaged and fixed 10 of 13 via `npm audit fix`
(no `--force`, no major bumps to anything shipped):

- **services/api (6→2):** fixed `brace-expansion`, `qs`, `tmp` (the HIGH
  one — path traversal, transitive via `exceljs`), `ws` (transitive via
  `@supabase/realtime-js`, 8.20.0→8.21.0). Verified: `node --check` clean,
  app module loads (`init` boots, all routers mount).
- **root + apps/scanner + apps/admin (7/7/6 → 3/3/3):** fixed
  `react-router`/`react-router-dom` **7.13.2→7.17.0 — this is shipped
  runtime code in the scanner SPA**, and the HIGH-severity advisory it
  fixed (`GHSA-49rj-9fvp-4h2h`, vendored turbo-stream "Unauth RCE") was the
  most consequential finding in this whole sub-audit. Also fixed `postcss`
  (XSS in CSS stringify) and `ws` (same as above, deduped). Verified:
  `tsc --noEmit` clean, `vite build` succeeds (591 modules, built to a
  scratch outDir — the real `dist/` couldn't be emptied due to a sandbox
  file-permission quirk unrelated to the dependency bump).

**Remaining 2 (services/api) + 3 (root/scanner/admin) — deliberately NOT
forced:**
- `uuid <11.1.1` / `exceljs` (moderate): the only fix is downgrading
  `exceljs` 4.4.0→3.4.0 (major regression to the price-book parser). Checked
  exceljs's actual usage — it only calls `uuid.v4()` (one call site,
  `cf-rule-ext-xform.js`). The advisory (`GHSA-w5hq-g745-h8pq`) is a buffer
  bounds check on `v3/v5/v6` **when a `buf` argument is supplied** — `v4()`
  with no args never hits that code path. **Not exploitable via this app.
  Accepted, documented.**
- `esbuild`/`vite`/`@vitejs/plugin-react` (high, dev-tooling only): fix
  requires `vite` 6.4.2→8.0.16, a 2-major bump to the build tool (not
  shipped to users — the esbuild advisory is about the *dev server*
  accepting cross-origin requests). Given the active feature-freeze/quality
  mandate (no new instability while the core loop is being hardened), a
  2-major Vite bump is **deferred** rather than forced mid-mandate. Tracked
  here for the next dependency-maintenance pass.

**Playwright version pin verified still in sync**: `services/api`'s
installed `playwright@1.59.1` matches `Dockerfile.worker`'s
`mcr.microsoft.com/playwright:v1.59.1-jammy` base image (the exact mismatch
class called out in `project_prod_deployment` memory as a past incident).
Untouched by this pass — confirmed still aligned.

**Only `package-lock.json` changed** (root + services/api) — no
`package.json` edits, all bumps within existing semver ranges.

**External-change tripwires** (MILO DOM selectors, MLCC pricebook CSV
format, the various "if the outside world changes shape, fail loudly not
silently" guarantees) were the subject of §1 and findings #1/#16-24 already
— not re-covered here to avoid duplication.

## §6 Admin (Command Deck) + assistant + tag printing + remaining surfaces
*Status: ✅ COMPLETE 2026-06-13*

**AI assistant + tag printing — cleared as sound, no findings:**
- `services/api/src/routes/assistant.routes.js` (`POST /assistant/ask`):
  proper input validation (400 on no question/image), try/catch with 503 for
  config errors (missing `ANTHROPIC_API_KEY`) vs 500 for runtime errors.
- `services/api/src/lib/assistant.js` (710 lines): AI tool-use orchestration
  — 7 tools (catalog/rules/price/orders/inventory/quantity/cart validation),
  every tool implementation returns `{error}` rather than throwing (caught
  centrally in `runTool`), `MAX_TOOL_ITERATIONS = 8` hard cap on the loop.
- `services/api/src/routes/tags.routes.js` (580 lines): shelf-tag HTML/PDF
  rendering, `MAX_CODES_PER_REQUEST = 50`, graceful fallback to monospace
  text if barcode rendering fails, proper 500+JSON on PDF generation errors.
- Scanner's assistant client (`apps/scanner/src/api/assistant.ts`) +
  `AssistantChat.tsx`: `askAssistant()` already uses `fetchWithRetry`
  (1 retry, 30s timeout) and never throws — `isAsking` state always resets.

**FINDING #28 (P1) — the entire `apps/admin` (Command Deck) API layer used
bare `fetch()` with no timeout.** Same class as #6 (scanner AuthGate boot
hang) and #25 (scanner's 3 bare fetches). See ledger for the full writeup.
Fixed via a new shared `apps/admin/src/api/fetchWithRetry.ts` (mirrors the
scanner's helper — a separate copy because admin and scanner are independent
Vite apps with no shared workspace lib). Converted:
- `operatorReview.ts` — all 12 functions, including `getSession()` (the
  app-boot call whose hang produced the permanent "Checking session…"
  symptom in `AppShell`).
- `founderConsole.ts` — `fetchFounderConsole()` / `fetchSystemHealth()`
  (already had try/catch returning `{ok:false,error}` — preserved).
- `nrsReview.ts` — all 4 functions (`fetchPendingReviews`, `resolveReview`,
  `searchMlccCatalog`, `skipReview`). The first three additionally got NEW
  try/catch wrappers (they didn't have any before) so they never throw —
  matching `founderConsole.ts`'s contract. Without this, `NrsReviewPage`'s
  `loadInitial`/background-refill/`handleResolve`/`handleResolveCode`/
  `handleSkip` (none of which use try/finally) would have left `loading`,
  `refillingRef`, or `acting` stuck on a persistent network failure.
- `catalogImages.ts` — all 3 functions (`fetchUncovered`, `setImageUrl`,
  `clearImageUrl`), same never-throw contract — `CatalogImagesPage`'s
  `load()`/`onSave()` don't use try/finally either.

**Sweep of remaining admin pages/components** (mirroring §3's scanner
sweep) for the same silent-failure/spinner-deadlock class:
- `OperatorSessionContext.tsx` / `AppShell.tsx` / `SignInView.tsx` — proper
  try/catch/finally; `AppShell`'s "Checking session…" (`bootstrap ===
  "loading"`) is the user-visible symptom #28 fixes by bounding
  `getSession()`.
- `ReviewRunsContext.tsx` (powers `/review` — run queue, run detail, bulk
  triage, single actions): every `getRuns`/`getReviewBundle`/
  `postRunAction` call already wrapped in try/catch/finally
  (`setLoadingRuns`/`setLoadingDetail`/`setActionInFlight` all reset
  correctly even on throw). No changes needed.
- `DiagnosticsPage.tsx`, `OperatorOverviewPage.tsx`, `FounderConsolePage.tsx`
  — all sound (try/catch/finally or never-throw API contracts already in
  place).
- `PilotOpsPage.tsx` — `loadStores`/`saveWorkflowState` already had
  try/finally, but `loadDetail` (called from a `useEffect`, no wrapper at
  all) and `saveWorkflowState`'s `patchPilotOpsStoreWorkflowState` call
  (try without catch) had no error surfacing for a thrown network error.
  Both now wrapped in try/catch with a "Network error..." message.
- `lib/supabaseAuth.ts` (`signInWithPassword`, used by `SignInView`) — bare
  `fetch()` to Supabase's GoTrue endpoint with no timeout. A stalled
  response would leave the "Signing in…" button stuck (try/finally on
  `busy` exists in `SignInView` but never fires while the fetch hangs). Now
  wrapped in an AbortController with a 15s timeout (no retry — login POST,
  retry isn't appropriate).
- `CatalogImagesPage.tsx` — `load()`/`onSave()` rely on `fetchUncovered`/
  `setImageUrl` never throwing (now guaranteed by #28's fix); both set
  `loading`/`saving` correctly in all branches. No changes needed beyond the
  API-layer fix.

**Verification:** final grep for bare `fetch(` across `apps/admin/src`
returns only the now-hardened `supabaseAuth.ts` call. `cd apps/admin && npx
tsc --noEmit` clean. `npx vite build` succeeds (303 modules transformed, no
errors — chunk-size warning only, pre-existing).
