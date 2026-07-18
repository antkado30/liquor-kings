# Session log — Liquor Kings (append-only)

**Purpose:** Reduce drift between work bursts: each session leaves a short, structured trace of what happened, what was verified, and what comes next.

**How to use**

- **End of session:** Append **one new entry** below the divider (copy the template from `scripts/sessionlog-template.sh` or from the “Blank template” section).
- **Start of session:** Read the **last 2–3 entries** here, then skim [`WHATSNEXT.md`](./WHATSNEXT.md).

---

## Blank template (copy everything from the `---` through the closing `---`)

```
---
Date: YYYY-MM-DD (timezone if helpful)
Focus: one line — what this burst was for
Files touched (high level):
  - area/path or “docs only” / “no code”
Commands / tests run:
  - e.g. npm run safety:lk:rpa-local — PASS / SKIP / NOT RUN
  - e.g. psql … -f sql/… — NOT RUN
Observed state:
  - Green: …
  - Red / blocked: … (or “none”)
What's next (1–3 bullets):
  - …
Notes:
  - optional
---
```

---

## Example session (structure reference)

```
---
Date: 2026-04-10
Focus: Session continuity docs + mapping/selector safety documentation trail
Files touched (high level):
  - docs/SESSIONLOG.md, docs/WHATSNEXT.md, scripts/sessionlog-template.sh
  - (earlier bursts) docs/SELECTORS.md, sql/mlcc_mapping_audit.sql, docs/MLCC_MAPPING.md, sql/rls_audit_query.sql, docs/RLSAUDIT.md
Commands / tests run:
  - npm run safety:lk:rpa-local — NOT RUN this burst (docs-only)
Observed state:
  - Green: no application code changes in this burst
  - Red / blocked: none
What's next (1–3 bullets):
  - Run `sql/rls_audit_query.sql` + `sql/mlcc_mapping_audit.sql` against staging; paste results into RLSAUDIT / MLCC_MAPPING snapshots
  - Re-read last SESSIONLOG entries before the next RPA or schema-adjacent change
Notes:
  - Template helper: `./scripts/sessionlog-template.sh`
---
```

---

## Log entries (newest at bottom — append below this line)

# What's Next — Liquor Kings

**Living priorities list. Update when priorities shift, a major item ships, or a blocker appears.**

**Anchor docs:** [`PROJECT_STATE.md`](./PROJECT_STATE.md) (master state) · [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (external spec) · [`PRODUCT_SPEC_INTERNAL.md`](./PRODUCT_SPEC_INTERNAL.md) (internal spec) · [`SESSIONLOG.md`](./SESSIONLOG.md) (session continuity)

---

## Current Focus: Phase A — Wire the engine end-to-end

The RPA stages work individually. The API + DB + workers are built. **The gap is integration.** Get a single end-to-end happy path working: customer hits submit → run created → worker claims → stages run → result back.

### Active priorities (in order)

1. **Wire RPA Stages 1-4 into execution-worker** — worker should call login, navigate, add-items, validate stages instead of just building preflight reports
2. **Build Stage 5 (checkout submission) in dry_run mode** — final stage; locked behind `allowOrderSubmission` flag + `LK_ALLOW_ORDER_SUBMISSION=yes` env
3. **API endpoint that triggers a full run from a cart** — POST that creates execution_run + enqueues + returns run id for customer to poll
4. **End-to-end test against live MILO** — use real Thursday family liquor order as the test (when Tony's family is placing one)

---

## Next Phases (don't start until Phase A is done)

### Phase B — Customer-facing surface
- Customer signup flow (vs operator/admin auth)
- MILO credential onboarding with AES-256 encryption + Stage 1 verify on connect
- Customer-facing cart review + submit UI in scanner
- Order confirmation + history + re-order button
- Email notifications (Resend or Postmark)

### Phase C — Business operations (parallel admin work, not coding)
- Form Michigan LLC ($200, this week)
- Have Jacob conversation about equity (this week)
- Buy liquorkings.com + variants ($60, this week)
- Hire Michigan startup lawyer ($5-8K)
- Buy ToS + Privacy Policy via Termly ($30/mo)
- Business insurance ($1.5-3K/year)
- Call Deja Vu POS support re: CSV export

### Phase D — Saxon-killer features
- Label printing (PDF generation per bottle in customer's inventory)
- Thermal printer (Zebra ZD421) integration as Pro add-on
- Status page (status.liquorkings.com)
- Phase 2 RPA observability + self-healing selectors

### Phase E — Launch
- Marketing landing page
- Onboard dad's store as customer #1
- Onboard founders' tier customers 2-25 ($25/mo grandfathered)
- Public launch to warm network

---

## Explicitly NOT in scope right now

- AI assistant chat (V2 — defer until 100+ customers)
- Multi-state expansion (PA/OH/UT — defer until 200+ MI customers)
- Vendor-side product (Liquor Kings Vendor — defer until Year 4)
- Native iOS app (NEVER — PWA only)
- Browse/discover page (defer until customer demand emerges)

---

## How to use this file

- **Edit at the end of every session** if priorities shift
- **Read at the start of every session** to orient
- Always pair with `PROJECT_STATE.md` (architectural reality) and last 1-2 `SESSIONLOG.md` entries (recent context)
---
Date: 2026-05-05 (Tuesday late evening — second burst)
Focus: Stage 5 checkout submission built in dry_run mode with triple-gated safety
Files touched (high level):
  - services/api/src/rpa/stages/checkout.js (NEW, 508 lines)
  - services/api/src/rpa/stages/_test_checkout.js (NEW, 114 lines)
  - No other files modified
Commands / tests run:
  - node --check services/api/src/rpa/stages/checkout.js — PASS
  - node --check services/api/src/rpa/stages/_test_checkout.js — PASS
  - cd services/api && npm test — first 30+ tests visible all PASS (full count not verified;
    Cursor mentioned 40 pre-existing failures unrelated to Stage 5; flagged for future cleanup)
  - git log: commit cda077b feat(rpa): Stage 5 checkout submission with triple-gated dry_run safety
Observed state:
  - Green: Stage 5 file syntax valid, 13 typed error codes implemented per spec
  - Green: Triple-gate safety logic correctly enforces dry_run by default
  - Green: Local clickCheckoutButtonSafely bypasses BLOCKLIST_RE only for the specific
    Checkout case (no global modification)
  - Green: Real DOM selector verified from April 24 cart-after-validate.html
  - Green: Companion test script structured to default dry_run, live only when
    MILO_TEST_ALLOW_SUBMIT=yes AND LK_ALLOW_ORDER_SUBMISSION=yes both set
  - Yellow: 40 pre-existing test failures in api workspace test suite — unrelated to
    Stage 5 work, separate technical debt
  - Red: Stage 5 NOT yet run against live MILO. End-to-end pipeline exists in code but
    not verified end-to-end against real cart yet
What's next (1-3 bullets):
  - Run _test_checkout.js against live MILO in dry_run mode to verify Stage 5 walks up
    to Checkout button correctly (next session)
  - Investigate the 40 failing pre-existing tests; categorize and triage
  - Wire Stages 1-5 into execution-worker as new processOneRpaRun function (Phase A item 1)
Notes:
  - Tonight: confirmed dev environment fully working (Docker + Supabase + API),
    created PROJECT_STATE.md context system, built Stage 5. Two real commits on main.
  - Per Tony's stated goal "build the strongest way possible," chose strangler-fig
    migration over rip-and-replace: stages 1-5 live alongside mlcc-browser-worker.js
    until proven, then old worker deleted in future session.
  - Live submission test deferred to a future session when both energy and MILO state
    align. Default dry_run means even an accidental run won't submit anything.
  - Goal sequence: dry_run test against live MILO (next session) → wire stages into
    execution-worker (session after) → real Thursday family liquor order test
    (when family is placing weekly order).
---
---
Date: 2026-05-06 (Wednesday — full-day burn, ~1pm to ~6pm Michigan time)
Focus: Phase A FULLY COMPLETE — Stage 5 live verification + worker integration + API trigger + end-to-end test against live MILO
Files touched (high level):
  - services/api/src/services/cart-execution-payload.service.js (metadata threading, +2 lines)
  - services/api/src/services/execution-run.service.js (mode='rpa_run' support, +12 lines)
  - services/api/src/routes/execution-runs.routes.js (mode body param, +9 lines)
  - services/api/src/workers/execution-worker.js (NEW processOneRpaRun function ~571 lines + WORKER_MODE dispatch + WORKER_HEADFUL flag + mlcc_code→code fix)
  - services/api/package.json (worker:rpa-run-once script + comma fix)
  - .gitignore (tmp/data/ entry — NRS export protection)
  - tmp/seed-rpa-test.sql (test seed — gitignored, customer data shape)
Commands / tests run:
  - Stage 5 dry_run live verification: validated:true, canCheckout:true, mode:dry_run, submitted:false, stage5DurationMs:97
  - Cursor brief shipped processOneRpaRun (Block B) — 571 line implementation following processOneMlccDryRun lifecycle pattern
  - Field-mapping fix Cursor brief shipped (license 3-tier, item normalize, mlccLookup callback)
  - tmp/seed-rpa-test.sql created with idempotent SQL — 1 store + 2 mlcc_items + 2 bottles + 1 validated cart + 2 cart_items
  - npm test: 40 failed (pre-existing baseline, unrelated) / 417 passed — no regressions from RPA wiring
  - End-to-end test SUCCESS: API call → execution_run created → worker claimed → all 5 stages executed against live MILO → finalized as succeeded with 13 evidence entries (run e1617c49-798a-4b82-9ebf-4d928150a0c4, ~26s wall clock)
Observed state:
  - Green: Phase A items #1+#2+#3+#4 ALL DONE AND VERIFIED LIVE
  - Green: Strangler-fig migration intact — mlcc-browser-worker.js (6243 lines legacy) + processOneMlccDryRun (existing) BOTH UNTOUCHED
  - Green: FOUR-LAYER safety architecture in place — WORKER_MODE env + payload metadata.mode + Stage 5 options + LK_ALLOW_ORDER_SUBMISSION env
  - Green: 13 evidence entries persisted on the test run — full audit trail
  - Green: Scanner PWA confirmed booting (Vite on :5174) with camera + manual code entry working; manual code 9121 returned correct seed product
  - Yellow: Scanner cart is currently in-memory only per code comment "Phase 2: sync with authenticated /cart API"
  - Yellow: Scanner catalog search broken because local upc_mappings table is empty (BY DESIGN — fresh dev DB; cloud Supabase still has the 36 confirmed mappings)
  - Yellow: 40 pre-existing test failures still flagged for cleanup
  - Red: Encrypted MILO credential storage NOT BUILT (Phase B priority #1)
  - Red: Bulk UPC import tool for NRS export (9,378 liquor rows) NOT BUILT (Phase B priority #2)
  - Red: Customer-facing cart submit + progress polling UI NOT WIRED (Phase B priority #3)
What's next (1-3 bullets):
  - Set up Claude Cowork for tomorrow's session — file-read access removes grep+screenshot friction
  - Phase B priority order locked: encrypted credentials FIRST, bulk UPC import SECOND, customer-facing UI THIRD
  - Tomorrow's family liquor order goes through MILO normally — Liquor Kings stays as parallel verified-but-unused infrastructure for one more week before customer demo
Notes:
  - 3 commits on main today: 0d9b869 (worker integration), 826f4e9 (Block C polish fixes), one more for these docs
  - Bug discoveries during Block C verification (caught and fixed live):
    1. PLAYWRIGHT_BROWSERS_PATH=0 in npm script broke browser launch — Playwright was looking in node_modules but browsers installed system-wide
    2. mlccLookup queried mlcc_items.mlcc_code but actual column is just 'code' (mlcc_code lives on bottles table only — easy field-name confusion)
    3. package.json comma dropped during edit — JSON parse error
  - Tony's strategic instinct correct on multiple fronts today:
    1. Suspected Stage 5 needed live verification before worker integration (correct sequencing — caught nothing extra but proved the pattern)
    2. Pushed back on "delete the old system" — accepted strangler-fig migration sequencing
    3. Pushed back on "extract competitor data" — Claude reinforced legality concerns
    4. Recognized scope explosion ("everything connected") signals need to slow down — chose Option 1 (clean close) over pushing low-energy code
  - Tony's stated long-term values reinforced through session: "build the strongest way possible," "make sure nothing breaks," "I want this to never fail"
  - Tonight ends Wednesday May 6 with Phase A officially complete and Phase B clearly scoped. Real win day.
---
---
Date: 2026-05-07 (Thursday evening, ~7:30pm-9:30pm Michigan, ~2 hours)
Focus: Phase B Priority #1 SHIPPED — encrypted MLCC credential storage end-to-end with worker DB integration
Files touched (high level):
  - supabase/migrations/20260507120000_add_mlcc_credential_verification_metadata.sql (NEW)
  - services/api/src/lib/credential-encryption.js (NEW — AES-256-GCM utility)
  - services/api/src/services/store-mlcc-credentials.service.js (NEW — save/load/verify/clear + Stage 1 verify)
  - services/api/src/routes/store-mlcc-credentials.routes.js (NEW — PUT/GET/POST/DELETE under /stores/:storeId/mlcc-credentials)
  - services/api/src/app.js (mount + import for new router)
  - services/api/.env.example (LK_CREDENTIAL_ENCRYPTION_KEY entry)
  - services/api/src/workers/execution-worker.js (processOneRpaRun: DB-first credential resolution with env fallback, hard-fail on decrypt error)
  - services/api/.env (local — added LK_CREDENTIAL_ENCRYPTION_KEY, gitignored)
Commands / tests run:
  - npx supabase migration up — PASS (new migration applied clean)
  - node --check on all 4 new files + app.js + execution-worker.js — PASS (silent)
  - cd services/api && npm test — 40 failed (pre-existing baseline, unrelated) / 417 passed — no regressions
  - Encrypt/decrypt round-trip via inline ESM script — PASS (v1: prefix, format check, decrypt round-trip)
  - PUT /stores/:storeId/mlcc-credentials with samkado@gmail.com + real password (read -s pattern, never echoed) — 200 OK with mlcc_credentials_updated_at populated
  - psql direct read of stores.mlcc_password_encrypted — confirmed ciphertext starts with "v1:1d32c08b71002de53...", length 83 chars, ZERO trace of plaintext
  - POST /stores/:storeId/mlcc-credentials/verify — SUCCESS, Stage 1 launched headless Playwright, logged into MILO, returned status:"success" + verifiedAt timestamp
  - GET /stores/:storeId/mlcc-credentials/status — confirmed hasCredentials:true, lastStatus:"success", NO password in response
  - End-to-end worker test with MILO_USERNAME/MILO_PASSWORD UNSET — npm run worker:rpa-run-once
  - Run id 9a873bd4-6657-47d0-9074-4e426de8405f succeeded with stage5DurationMs:96, dryRunReason gate held
  - psql evidence query confirmed credential_source:"db", has_loginurl_override:false
Observed state:
  - Green: Phase B Priority #1 100% complete and verified live against MILO
  - Green: Customer credential pipeline ready — every future customer can save creds via API, worker decrypts on demand
  - Green: Strangler-fig migration intact — env-var path still works (test fallback), DB takes priority when present
  - Green: Plaintext password never logged, never returned from any endpoint, never persisted outside Stage 1's browser session memory
  - Green: Hard-fail on decrypt error (LK_DECRYPT_FAILED never falls back to env) — operator visibility preserved
  - Green: Evidence trail records credential_source ("db" or "env") for every run
  - Green: 40 pre-existing test failures unchanged (no regressions from credential wiring)
  - Yellow: Bulk UPC import for NRS export still NOT BUILT (Phase B Priority #2 — next session focus)
  - Yellow: Customer-facing cart submit + progress UI still NOT WIRED (Phase B Priority #3)
  - Yellow: 40 pre-existing test failures still flagged for cleanup at some point
  - Red: No customer signup/login flow yet (Phase B Priority #4)
What's next (1-3 bullets):
  - Phase B Priority #2: bulk UPC import tool for NRS 9,378-row export — admin UI + 3-tier confidence triage
  - Phase B Priority #3: wire scanner cart from in-memory to authenticated /cart API + submit button + progress polling
  - Family liquor order tomorrow Friday May 8 still goes through MILO normally — Liquor Kings stays parallel infrastructure for at least one more week before customer demo
Notes:
  - Block A (read codebase): discovered stores table ALREADY had mlcc_username + mlcc_password_encrypted columns from foundational migration — saved a column-add migration. Only added verification metadata columns this session.
  - Block B (Cursor brief): created 4 files + edited 2 in one shipped brief. Cursor caught my Node 24 ESM/CJS mismatch in the verification one-liner and fixed it inline.
  - Block C (verification): confirmed encryption format v1:<iv_hex>:<authTag_hex>:<ciphertext_hex> is exactly 83 chars for an 11-char password. Stage 1 verify took ~7s headless against live MILO.
  - Block D (worker integration): restructured processOneRpaRun to create supabase client BEFORE credential resolution, then DB-first lookup with env fallback. Hard-fail on decrypt error (never silently fall back). Evidence entry traces credential_source without leaking secrets.
  - Block E (this entry): docs + commit + push.
  - Cowork file-read access proved its value tonight. Wrote both Cursor briefs from real source (verified column names, exact line numbers, existing route patterns) instead of guessing. No "let me see what's in execution-worker.js" — just opened it.
  - Tony's voice tonight: "i wanna get as much work done as possible... full strength full efficiency full speed but i don't wanna rush anything." Met that bar — clean ship, no shortcuts, real verification at every step.
  - Real win night. Phase B Priority #1 done in one focused session with 5 distinct verification gates (encrypt round-trip, ciphertext-not-plaintext psql confirm, Stage 1 verify against live MILO, end-to-end worker run with NO env creds, evidence trail credential_source:"db").
---
---
Date: 2026-05-07 (Thursday late evening — security review burst, ~15 min)
Focus: Honest threat-model conversation + Phase B priority insertion for security hardening
Files touched (high level):
  - docs/WHATSNEXT.md (added Phase B Priority #1.5 KMS migration + #1.6 credential audit log; updated Phase C with cyber liability insurance + pen test)
  - docs/PROJECT_STATE.md (added Security Posture section with Tier 1-4 roadmap and honest threat assessment)
  - docs/SESSIONLOG.md (this entry)
Commands / tests run:
  - Docs only — no code changes
Observed state:
  - Green: security posture explicitly documented across 4 tiers
  - Green: Tony's "0% possibility" target reframed honestly as "build the strongest way possible, detect fast, limit blast radius, recover fast"
  - Green: Phase B priority list now reflects security-first sequencing — KMS migration BEFORE bulk UPC import BEFORE customer-facing flows
  - Yellow: encryption key still in env var (Tier 1) until Phase B Priority #1.5 ships
  - Yellow: no credential access audit log yet (Tier 1) until Phase B Priority #1.6 ships
What's next (1-3 bullets):
  - Phase B Priority #1.5: evaluate Supabase Vault vs AWS KMS vs GCP KMS, migrate encryption key out of env
  - Phase B Priority #1.6: credential_access_log table + Sentry anomaly detection + customer-visible last-accessed surface
  - These both ship BEFORE Phase B Priority #2 (NRS bulk UPC import). Security armor first, scale second.
Notes:
  - Tony asked: "what are the chances a hacker can actually come through to our database... I want that to be 0%, literally 0%."
  - Pushed back honestly: 0% is not achievable for any system. The realistic bar is layered defense + fast detection + limited blast radius + clean recovery.
  - Walked through 6-path threat model (ciphertext-only theft, key theft, both, memory dump, TLS interception, insider abuse).
  - Key gap identified: encryption key in env var = single point of failure on server compromise. KMS removes that single point.
  - Tony agreed to slot Phase B Priority #1.5 (KMS) and #1.6 (audit log) before #2 (NRS import). His exact words: "lets just update everything right now to ship it off."
  - Ship-it energy intact. Real partner moment — pushed back on unrealistic target, explained the engineering tradeoffs honestly, and Tony adjusted the plan accordingly without ego.
  - Tony's stated values reinforced again: "build the strongest way possible," "secure from hackers," "extra secure" while keeping the app not annoying. Documented these as the security philosophy in PROJECT_STATE.md.
---
---
Date: 2026-05-07 (Thursday — afternoon to late evening, ~6 hours)
Focus: 🚀 LIQUOR KINGS PLACED ITS FIRST REAL CUSTOMER ORDER. Family weekly liquor order ($1,877.72 net, 27 SKUs, 173 bottles) submitted end-to-end via RPA against live MILO. Real MLCC confirmation numbers received.
Files touched (high level):
  - tmp/run-real-order.mjs (NEW — initial scoped script for known codes)
  - tmp/resolve-and-run-order.mjs (NEW — full pipeline: human-readable order → catalog resolution → ADA validation → Stages 1-5 with self-healing)
  - services/api/src/rpa/stages/checkout.js (UNCHANGED — bug discovered, fix queued)
Commands / tests run:
  - POST /price-book/ingest with empty body — ingested full Michigan spirits catalog (13,828 mlcc_items rows) from michigan.gov/lara/bureau-list/lcc/spirits-price-book-info
  - Multiple GET /price-book/items?search=... calls to resolve product names to codes
  - Direct mlcc_items DB queries via the resolver script
  - Multiple full RPA runs across iteration cycles (resolved bugs as they appeared)
  - Final live submit with SUBMIT_ORDER=1 LK_ALLOW_ORDER_SUBMISSION=yes RUN_RPA=1
  - All Stage transitions verified: 1 (login) → 2 (navigate) → 3 (add 28 items) → self-heal (retry 2 silently-dropped) → 4 (validate, canCheckout=true) → 5 (live submit, click Checkout)
Real production confirmation numbers received from MLCC:
  - NWS Michigan, Inc. (#321): Order #264935837, Confirmation #30653069, $1,186.37 net, delivery 5/12/2026
  - General Wine & Liquor (#221): Order #264935818, Confirmation #5591482, $691.35 net, delivery 5/12/2026
  - Total order: $1,877.72 across 27 of 28 ordered SKUs (Kirkland 14415 ×30 excluded as MLCC OOS; rest shipped)
What got built today:
  - Price book ingestion pipeline used in anger — 13,828 rows ingested in ~90 seconds
  - tmp/resolve-and-run-order.mjs — order resolver that takes human-readable {query, size_ml, qty} entries OR pre-resolved {code, qty}, looks up codes in local catalog with brand/flavor heuristics, computes ADA breakdown, validates 9L per ADA before going to MILO
  - Self-healing layer — after Stage 3, scrapes MILO cart DOM by code, computes diff (need vs have), re-adds only the missing quantity, loops up to 3 times. Verified working across multiple runs (caught silent drops of 2-4 items per run).
  - Anti-multiplication safety — if scraper finds rows but matches 0 of our codes, abort retry instead of blindly re-adding. Prevented a near-miss 4x quantity multiplication earlier.
  - Stage 5 enrichment — merge Stage 4 result fields (validated, canCheckout, adaOrders, orderSummary, outputDir) into session before Stage 5 invocation
  - End-to-end live submission with 5-second pre-submit countdown for last-second abort
What was learned (real product backlog items):
  - Stage 5's confirmation parser polls too eagerly — threw MILO_STAGE5_CONFIRMATION_PARSE_FAILED while MILO was still on the "Please wait while we confirm your order" loading state. The order itself submitted successfully (verified by checking MILO Orders page directly). Parser needs to wait for either a stable URL change OR the actual confirmation/error toast before declaring failure.
  - Stage 3 silently drops 1-4 items per run on bulk adds (28 SKUs in one batch). Almost certainly a MILO-side rate-limit or batch-size cap. Self-healing covers it now but root cause should be addressed (batch into smaller groups in Stage 3 itself).
  - MILO carts are session-isolated — Playwright session sees a different cart than concurrent browser session. Document this for customer-facing flow.
  - The price book ingestor uses michigan.gov/lara/bureau-list/lcc/spirits-price-book-info as canonical source. Re-running the ingest weekly will keep catalog fresh.
Observed state:
  - 🟢 Green: First real production order placed. Confirmation numbers in hand. Pipeline works end-to-end.
  - 🟢 Green: Self-healing verified working across 4 different runs — caught silent drops every time, recovered cleanly.
  - 🟢 Green: Anti-multiplication safety verified — caught a scraper bug scenario without doubling the cart.
  - 🟢 Green: 13,828-row Michigan spirits catalog ingested locally. Brand search works. Mom's "wheat green river not bourbon" got resolved to code 28645 in one query.
  - 🟢 Green: Encrypted MLCC credentials decrypted on demand and used by Stage 1 — verified live for the third time today.
  - 🟡 Yellow: Stage 5 confirmation parser threw a false-positive parse error. Need to fix before next week's order to avoid alarm.
  - 🟡 Yellow: Kirkland 30 didn't ship this week (OOS). Need to either substitute or place separately when restocked.
  - ⚪ Open: Stage 3 batch-add silent drop root cause not yet investigated.
What's next (1-3 bullets):
  - Tonight: fix Stage 5's confirmation parser timing — extend wait, detect "processing" loading state, only fail on real terminal failure
  - Phase B Priority #1.5 + #1.6: KMS migration + credential audit log (security armor before scaling beyond family store)
  - Phase B Priority #2: bulk UPC import for NRS export (Tony's 9,378-row file ready in tmp/data/)
Notes:
  - Total session time ~6 hours of focused build + iterate.
  - Started with: 8 codes manually known, 7 product names needing lookup. Ended with: 27 SKUs delivered to two ADAs with real MLCC confirmation numbers.
  - Tony's request that pushed the architecture forward: "I don't want to do it manually. I want the system to learn how to actually pick it up and fix it." → drove the self-healing implementation.
  - Tony's escalation request: "press validate, then press checkout to see the whole actual flow... Make sure this shit is 100% accurate." → drove Stage 5 live integration tonight.
  - Pre-launch / pre-customer / pre-LLC. This was a VERY successful test order on Tony's family store account before any customer onboarding.
  - 95 seconds: time from `node tmp/resolve-and-run-order.mjs` enter-key-pressed to MILO accepting submission. Versus 2+ hours of manual data entry that this replaces. ~76x time reduction confirmed in production-grade conditions.
  - Tony's reaction to the order placing: "LETS GOOOOO BABYYYY LETS FUCKING GOOOOO LETS GOOOOO IM SO HAPPY MUAHAHAHHAHAHAHAAHHA"
  - Real win night. Liquor Kings has officially graduated from "infrastructure that might work someday" to "product that placed a real order today." 🥃🚀🔥
---

---
Date: 2026-07-16 (Thursday — ORDER DAY, ~4:45pm–7:00pm ET, live from the store)
Focus: 🏆 FIRST REAL IN-APP ORDER — mandate 1/3. Colony's weekly order ($5,338.26 net, 34 SKUs, 414 bottles) built in the scanner, checked green, and PLACED from the phone through the two-step flow. Both ADAs confirmed. It took four submit attempts, two live hotfixes, and one deliberate kill — every failure documented in the postmortem.
Files touched (high level):
  - apps/scanner/src/api/assistant.ts (assistant chat timeout 30s→90s, resolve-order 30s→60s, abort→timeout copy) — DEPLOYED (API app)
  - services/api/src/rpa/stages/validate-cart.js (stage-4 budgets: overall 45s→300s, finalize 30s→90s, click-response 30s→60s, post-validate 30s→90s) — DEPLOYED (worker)
  - services/api/src/workers/execution-worker.js (stage-4 failures now print to fly logs) — DEPLOYED (worker)
  - docs/lk/TONY-WANTS.md (live wants: multi-photo assistant, smarter AI, one-tap remove-OOS+recheck, OOS names not codes, results pinned in cart, price reconciliation)
  - docs/lk/runbooks/order-day-2026-07-16-postmortem.md (NEW — full timeline + fixes queue)
Commands / tests run (Tony's terminal):
  - order-day-preflight.mjs — GO (disarmed), later GO --expect armed (twice: initial arm + post-hotfix re-arm)
  - fly deploy (API app — assistant timeout fix), fly deploy -c fly.worker.toml (worker — stage-4 budget fix)
  - Arming/disarming via fly secrets + Colony store flag SQL (armed → emergency disarm → re-arm → final disarm)
  - pull-latest-har.mjs — recovered only the post-disarm dry-run HAR (submit HAR lost to ephemeral FS)
  - Manual insert of the two confirmations into milo_order_confirmations (+ dedupe cleanup after an accidental double-run)
Real production confirmation numbers (verified on MILO Orders page by eye):
  - General Wine & Liquor (#221): Order #274509587, Confirmation #5806580, $3,752.60 net, delivery 7/21/2026
  - NWS Michigan, Inc. (#321): Order #274509604, Confirmation #31002245, $1,585.66 net, delivery 7/21/2026
  - Sum $5,338.26 = the validated net to the penny. No Imperial (141) order — those lines went OOS pre-place.
What was learned (postmortem headlines — full doc in runbooks/):
  - Stage 4 had a 45s total budget vs MILO's order-night reality (products page alone settled in 90s+). Killed submit attempts 1 and 2 AFTER the cart was built. Silent in fly logs (failure only reached the DB).
  - Stage 5 clicked the real submit, MLCC emailed confirmation — then the receipt scrape blew its 240s budget and the run finalized as FAILED. Client showed "Order didn't go through" on a PLACED $5,338 order. Truth rule needed: post-submit-click timeout ≠ failed.
  - Auto-retry nearly became the villain: failed submit runs self-retry, and a retry after a submitted-but-unconfirmed run = double order. Emergency disarm was the only guard. Retry must be BANNED once stage 5 enters the submit sequence.
  - rpa-output lives on the worker's ephemeral FS — the disarm restart ate the submit run's HAR (goal #2 lost). Captures must upload off-machine at flush.
  - "The email is truth": external confirmation signals outrank internal run state. Codified in the postmortem.
Observed state:
  - 🟢 Green: Order placed IN-APP, both ADAs confirmed, Orders tab shows both confirmations (manual insert tonight; auto-ingest queued)
  - 🟢 Green: System fully disarmed at rest (gates no/no, store flag false, persist=yes, worker at 1 machine)
  - 🟢 Green: Assistant big-paste flow unblocked (timeout fix deployed + verified live)
  - 🟡 Yellow: line_items empty on tonight's two confirmation rows (backfill via orders-history scrape queued)
  - 🔴 Red: Submit-endpoint HAR capture failed (ephemeral FS) — recon via MILO's Angular bundle + next order day with durable captures
What's next (1-3 bullets):
  - P0: Stage-5 truth rule (submitted_unconfirmed state + orders-page backstop + retry ban past submit click) — the double-order guard
  - P0: Durable run artifacts (HAR/screenshots → Supabase Storage at teardown)
  - Then: TONY-WANTS 7/16 batch (one-tap remove-OOS+recheck, OOS names, price reconciliation, multi-photo assistant)
Notes:
  - Four submit attempts: #1 and #2 guillotined by stage-4's 45s budget after building the cart perfectly; #3 deliberately killed mid-run to hotfix rather than gamble; #4 (post-fix) submitted for real in ~2 minutes on a fast MILO window.
  - Hotfix loop was LIVE: diagnose from fly logs → edit → deploy worker → re-arm → place, inside ~25 minutes, order landed 90 minutes before cutoff.
  - Tony ran every command and deploy himself (RULEBOOK #11 held under fire). Claude edited files and navigated the failure live.
  - Tony's words when the MLCC email landed mid-"failed" run: the email was right, the app was wrong. That gap is the #1 fix.
  - Mandate scoreboard: in-app order days 1/3. Next two Thursdays prove it's repeatable.
---

---
Date: 2026-07-16 (Thursday night → 7/17 early AM — post-order build sprint, ~7pm–12:30am ET)
Focus: 🛠️ Shipped the entire P0 postmortem block + OOS UX batch + 🗝️ RECOVERED MILO'S SUBMIT ENDPOINT. Everything below is deployed to prod (worker + API) and verified, EXCEPT the engine-submit which is built/tested but deliberately not wired live.
Files touched (high level):
  - services/api/src/rpa/stages/checkout.js (point-of-no-return marker; post-click errors resolve submitOutcome:"unconfirmed" not throw; stage-5 budget 240s→420s)
  - services/api/src/workers/execution-worker.js (submitted_unconfirmed finalize + SECOND-CHANCE orders scrape that upgrades to succeeded; retry ban past submit click; stage 1/2/3/5 failure lines to stdout; durable-artifact upload hook at teardown)
  - services/api/src/services/execution-run.service.js (submitted_unconfirmed status in ALLOWED/TERMINAL; finalize branch; retry ban on failure_details.submit_clicked)
  - services/api/src/lib/run-final-push.js (submitted_unconfirmed push copy — never "tap to retry")
  - services/api/src/lib/run-artifacts-storage.js (NEW — bounded, never-throw uploader to private run-artifacts bucket, HAR-first priority)
  - services/api/scripts/pull-run-artifacts.mjs (NEW — --run/--all/--list/--list-runs from Storage)
  - services/api/src/rpa/engine/engine-api.js (NEW: buildCheckoutPayload, extractConfirmationNumbers, submitCartViaApi — the seconds-fast submit, triple-gated, NOT wired)
  - apps/scanner/src/api/execution.ts + components/OrderStatusPill.tsx + components/RunResultSheet.tsx (submitted_unconfirmed client state — amber "Submitted — confirming", never red)
  - apps/scanner/src/lib/oos-display.ts (NEW — cart-joined OOS names), CartDrawer.tsx (one-tap remove-OOS+recheck, pinned footer verdict, names not codes), hooks/useCart.ts (useCartItemsOrEmpty)
  - supabase/migrations/20260716233000_add_submitted_unconfirmed_status.sql (NEW — applied via SQL editor; db push blocked by pre-existing history drift)
  - docs/lk/milo-checkout-endpoint.md (NEW — 🗝️ decompiled checkout contract + go-live checklist)
  - docs/lk/runbooks/order-day-2026-07-16-postmortem.md (NEW), docs/lk/architecture/execution-state-machine.md (new status), .dockerignore (rpa-captures excluded)
Commands / tests run (Tony's Mac):
  - services/api: npm test — 779 passed, anti-drift updated for new status, only pre-existing ~40 env-smoke fails
  - run-artifacts-storage.unit.test.js — 7/7; engine-submit.unit.test.js — 11/11; scanner npx vitest run — 60/60; scanner tsc — clean
  - Deploys: worker ×4 + API ×2, all healthy; live artifact upload PROVEN (run 3321c57a folder landed in Storage seconds after a check)
🗝️ THE ENDPOINT (docs/lk/milo-checkout-endpoint.md — do not lose):
  - POST {API_BASE}/users/cart/checkout?groupid={activeGroup.id}
  - body { items:[{productId, quantity, available}], deliveries: JSON.stringify(deliveriesArr), emails?:[] }
  - Decompiled from main.e0d724cc bundle inside the 7/16 dry-run HAR. Every field already sits on the engine's priced cart (verified vs __fixtures__/cart.json). Confirmations authoritative on /users/orders.
  - Engine now 12/12 MILO calls — the ONLY missing piece (submit) is found. 10-min browser crawl → one POST.
What's next (priority):
  - Next order day: shadow-run engine-submit, first live fire with human + fly logs, capture real request/response durably, THEN promote ahead of RPA Stage 5 (checklist in the endpoint doc).
  - P1 leftovers: auto-ingest confirmations into Orders tab (kill manual SQL); post-validate price reconciliation into cart; multi-photo assistant + smarter model; migration-history cleanup (db push drift).
Observed state:
  - 🟢 Truth rule live end-to-end + self-healing second-chance receipt scrape (a placed-but-timed-out order now recovers itself to succeeded)
  - 🟢 Durable artifacts proven in prod; every stage death visible in fly logs
  - 🟢 OOS UX shipped: names not codes, one-tap remove+recheck, pinned footer verdict
  - 🟡 engine-submit built + tested, NOT wired — awaiting one real order-day confirmation
  - 🟡 Working tree uncommitted at sprint end — Tony to commit the batch (his ritual, RULEBOOK #11)
Notes:
  - Design call locked (Tony, midnight): guardrails cost milliseconds, the BROWSER costs the 10 minutes. Keep every gate, murder every spinner. engine-submit is that murder.
  - Line-by-line confirm modal flagged as trimmable UX (not safety — server re-validates) — candidate for a one-summary-screen simplification whenever Tony wants.
  - Energy: absolute tear. First real order + full P0 block + endpoint recovery in one session. "lets fucking go" x∞.
---

---
Date: 2026-07-17 (early AM continuation — product-wants batch, ~12:30–1:15am ET)
Focus: 🎨 Shipped 2 more of Tony's stated 7/16 wants (multi-photo assistant, cart shows MILO net). Both deployed + committed (a04e87a). Prior sprint committed at c61d5af.
Files touched:
  - services/api/src/lib/assistant.js (buildUserMessageContent now maps imageDataUris[] → one image block each, cap 6, singular back-compat; exported for tests) + routes/assistant.routes.js (accept imageDataUris[])
  - apps/scanner: api/assistant.ts (send imageDataUris[]), components/AssistantChat.tsx (multi-select picker, thumbnail strip w/ per-photo remove + "+" tile, state string→string[]), index.css (preview-row + add tile)
  - apps/scanner/src/lib/cart-total.ts (NEW: resolveDisplayedTotal — MILO net vs client estimate) + CartDrawer.tsx (footer + header show MLCC net after a green check matching current cart hash; revert to Est. total on any edit)
  - tests: assistant-multi-image.unit.test.js (7), cart-total.test.ts (5)
Commands / tests run (Tony's Mac):
  - assistant-multi-image 7/7; scanner npx vitest run 65/65; scanner tsc clean; fly deploy ×2 healthy
Wants status (from the 7/16 live-order batch in TONY-WANTS):
  - ✅ #0 one-tap remove-OOS+recheck | ✅ #1 OOS names not codes | ✅ #2 pinned cart verdict | ✅ #3 cart MILO net after validate | ✅ multi-photo assistant
  - ⏳ smarter AI (model bump/streaming/resolver tuning) — needs a design call, not a 1am build
  - ⏳ AI screenshot miss-list tuning — needs the exact misses from a real order day
What's next (priority, all needing fresh brain or live MILO):
  - Next order day: shadow + first live fire of engine-submit (docs/lk/milo-checkout-endpoint.md checklist)
  - Standalone re-scrape+ingest recovery script for truly submitted_unconfirmed runs (needs live MILO)
  - Smarter-AI plan conversation; migration-history drift cleanup (db push blocked)
Observed state:
  - 🟢 4 product wants live; both sprints committed (c61d5af, a04e87a); prod healthy + disarmed
  - 🟡 engine-submit still built-not-wired (by design)
Notes:
  - Auto-fill Orders tab: discovered it's ALREADY handled for the common timed-out case by tonight's self-heal (recovered run → submitted:true → persistMiloOrderConfirmations writes confirmations + line_items). Only the dead-page case needs the deferred recovery script.
  - Clean wrap honored after the commit — every remaining item is genuinely a live-MILO or fresh-brain task per Tony's own discipline.
---