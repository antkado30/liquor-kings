# STATE OF LIQUOR KINGS — the one map

**Written 2026-07-03, the morning after order day failed.** Purpose: end the
"I don't know what's in here anymore." This is the complete census — every
table, script, flag, service, and feature — each marked:

- ✅ **DONE** — finished, working, leave it alone
- 🟡 **HALF** — started, not finished; either finish it or kill it
- 💀 **DEAD** — abandoned; safe to delete/cancel, confirm then remove
- ❓ **VERIFY** — status unknown until we check prod/logs

**The rule from here (Tony, 2026-07-03):** nothing new gets built until every
🟡 is either ✅ or 💀. We finish or we kill. No third option.

---

## 0. THE WOUND — order day failed (fix these FIRST, they are why)

The app white-screened at 7:15pm Thursday; Tony hand-placed the order at
dinner. Postmortem complete 2026-07-03 from fly logs — ROOT CAUSE FOUND:

### The white-screen, mechanically (not a mystery, a config bug)
- `fly.toml`: `kill_signal=SIGINT` + `kill_timeout=5m`, start command `npm start`.
- `src/index.js`: `app.listen()` with **no signal handler**.
- **Only ONE API machine** (`min_machines_running=1`).
- Chain: any restart (deploy OR `fly secrets set`) → Fly sends SIGINT →
  `npm start` does NOT forward it to the node child, and node had no handler →
  process never exits → Fly waits the **full 5-minute kill_timeout**, then
  SIGTERM force-kills. Proven in logs: SIGINT 17:50:28 → SIGTERM 17:55:28,
  "Machine created and started in 5m1s". **Every restart = 5 min of the single
  machine down = blank site.** Thursday's arming ran several secrets changes
  back-to-back; Tony hit the site during a cycle → white screen. This is ALSO
  why every `fly secrets set` "timed out" all week — it was never cosmetic; it
  was the 5-minute-downtime bug waving at us, and it got dismissed. Owned.

### The fixes (code READY 2026-07-03, awaiting Tony's deploy)
1. ✅ **Graceful shutdown** (`index.js`): SIGINT/SIGTERM → `server.close()` →
   exit in ~seconds (+10s force-exit safety net).
2. ✅ **Exec node directly** (`fly.toml`: `npm start` → `node src/index.js`) so
   the signal actually reaches the process.
3. ✅ **kill_timeout 5m → 30s** (this app runs no RPA; that cap was vestigial
   from before the worker split).
4. ✅ **Silence the `git: not found` boot noise** (`sentry.js`).
5. ✅ **Running 2 API machines** — DONE + VERIFIED 2026-07-03 (`fly scale count 2`;
   `fly status` shows both `started`, both `1/1 passing`, deploy rolled across
   both). Restarts are now rolling: one serves while the other cycles = ZERO
   downtime. The white-screen is structurally impossible now.

**✅ FIX DEPLOYED 2026-07-03 (commit 9c9112f):** items 1-5 all live. The
5-minute-restart bug is gone; next `fly secrets set` will finish in seconds
(the proof). Postmortem closed.

### Still open (not code — Tony actions)
6. 🟡 **External uptime monitor** — Sentry canNOT catch a down machine (a dead
   machine runs no code to report itself). Need an outside pinger
   (UptimeRobot free tier) hitting `liquor-kings.fly.dev/health` every 1-5 min →
   alert on failure. This is the "never blind again" piece.
7. 🟡 **"Needs your decision" notification** — 8 bottles went OOS; the app waited
   silently for Tony to reopen it. Should push/text "8 items OOS — tap to fix."
8. ℹ️ **Census correction:** Sentry is NOT a placeholder — logs show it
   initializes in prod (real DSN). But it's not instrumenting express + release
   is "unknown". Partially wired; finish it. Still wouldn't have caught the
   white-screen (that's what #6 is for).

These ARE the product's core promise ("never silent, never a mystery, never a
wait"). They outrank every feature below.

---

## 1. DATABASE — 26 tables (from 52 migrations)

### Core ordering (✅ all live + used)
- ✅ `stores` — store records; heavily used (RLS, arming flag, creds meta)
- ✅ `store_users` — membership/auth; RLS recursion fixed 6/6
- ✅ `carts` / `cart_items` — the cart; dedupe unique + sync RPC (6/9)
- ✅ `execution_runs` — every RPA/validate/submit run; the spine
- ✅ `execution_run_attempts` — retry rows per run
- ✅ `execution_run_operator_actions` — operator audit trail
- ✅ `milo_order_confirmations` — placed-order confirmation numbers
- ✅ `order_templates` — saved recurring carts + scheduling
- ✅ `mlcc_rules` — MLCC ordering rules (9L min, ADA)

### Catalog / pricing (✅ core, 🟡 grouping)
- ✅ `mlcc_items` — THE catalog (13,828 rows). 20+ columns bolted on over 7
  migrations — heaviest table. Includes: image_url/thumb, name_searchable,
  featured_sort, scan tracking, and the new 🟡 `family_key`/`container`/
  `pack_count`/`is_combo` (backfilled 7/1, **read by nothing yet** — the
  family-tree UI is unwired).
- ✅ `mlcc_price_book_runs` — price-book ingest audit
- ✅ `mlcc_brand_aliases` — brand alias matching
- ❓ `mlcc_code_map` / `mlcc_item_codes` — code mapping (6/13). VERIFY still used.
- ✅ `bottles` — legacy per-store bottle table (name_searchable added 6/10)

### UPC / matching (✅ mostly live — corrected 7/3)
- ✅ `upc_mappings` — UPC→code (the scan path)
- ✅ `upc_match_audit` — every scan match logged
- ✅ `upc_lookups` — **STILL LIVE** (verified 7/3): written by
  `price-book.routes.js` on the UPC scan path. NOT dead. (Note: UPCitemdb was
  dropped as an IMAGE source 6/4, but `lookupUpcFromUpcitemdb` is STILL called
  for UPC→size/candidate lookup at price-book.routes.js:1315 — so the
  `UPCITEMDB_API_KEY` is still doing real work. **Do NOT cancel it** without
  first replacing that call path.)
- ❓ `nrs_ambiguous_review` — NRS import review queue (1,329 rows built
   5/12). VERIFY: was this ever worked through, or abandoned mid-review? (This
   one is a genuine ❓ — data table, need to check if any UI reads it.)

### Pilot ops (✅ LIVE — census guess was WRONG, verified 7/3)
- ✅ `pilot_ops_workflow_states`
- ✅ `pilot_ops_workflow_state_history`
- ✅ `pilot_ops_notifications`
- ✅ `pilot_ops_notification_state`
  → **NOT dead.** Verified 7/3: wired into 5 service files
  (`pilot-ops-*.service.js`), the `operator-review.routes.js` route, the admin
  `PilotOpsPage.tsx` (routed at `/pilot-ops` in App.tsx), and 4 unit test
  files. This is the operator-review subsystem. **DO NOT DROP.** Lesson: the
  census's "looks abandoned" instinct was wrong — verification caught it before
  we broke the admin. This is exactly why we verify before we kill.

### System
- ✅ `lk_system_diagnostics` — auth failures, store mismatches, photo events
- ✅ stored procedures: `cart_items_sync`, `search_fuzzy` (trigram),
  `add_cart_item`, `browse_facets`, updated-at trigger — all live

**DB verdict:** core is clean and used. The suspects are the 4 `pilot_ops_*`
tables (likely dead), `upc_lookups` (dead if UPCitemdb is gone), and
`nrs_ambiguous_review` (abandoned mid-review?). ~6 tables to confirm + likely
retire out of 26. Not chaos — a short list.

---

## 2. SCRIPTS — 30 (services/api/scripts/)

### Keep — operational (✅)
- ✅ `order-day-preflight.mjs` — GO/NO-GO (built 7/1)
- ✅ `pull-latest-har.mjs` / `extract-submit-endpoint.mjs` — capture tooling
- ✅ `backfill-family-key.mjs` / `audit-family-grouping.mjs` — family work
- ✅ `inspect-execution-runs.mjs` — run timing inspector
- ✅ `recover-store.mjs` — unwedge a stuck store
- ✅ `refresh-price-book.mjs` — manual price-book refresh
- ✅ `preorder-doctor.mjs` — pre-order health
- ✅ `dump-order.mjs` — MILO-ready lines fallback (needs LK_PROD_* env — the
  reason it errored Thursday)
- ✅ `rls-verification.mjs` — the RLS attack suite
- ✅ `resolve-order-codes.mjs` / `audit-resolver.mjs` / `lookup-codes.mjs` — matcher tools

### Image backfill — 5 scripts, only 1 alive (🟡/💀)
- 🟡 `backfill-mlcc-item-images-serper.mjs` — the LIVE path (never fully run)
- 💀 `backfill-mlcc-item-images-google.mjs` — Google CSE dead-ended 6/8
- 💀 `backfill-mlcc-item-images-ai.mjs` — AI-gen dead-ended 6/10
- ❓ `backfill-mlcc-item-images.mjs` / `build-image-thumbs.mjs` — VERIFY which is current
  → **Decision needed: run Serper once for real, or accept placeholders for V1.**

### Data-load — one-time, likely retired (❓)
- ❓ `load-nrs-import.mjs` / `check-nrs-import.mjs` — NRS one-time loads
- ❓ `load-mlcc-pricebook-upcs.mjs` / `copy-mappings-to-prod.mjs` /
  `backfill-milo-order-confirmations.mjs` — one-time migrations, probably done
- ❓ `load-test-rpa.mjs` — load tester, "run only after Thursday" (never run)

### Test harnesses (✅ keep)
- ✅ `test-rpa-stages.mjs` / `test-assistant.mjs` / `test-mlcc-rules.mjs` /
  `test-orders-history-scrape.mjs`

**Scripts verdict:** ~13 keepers, 2 confirmed dead (Google/AI images), ~8
one-time loaders to archive. A `scripts/archive/` folder solves most of it.

---

## 3. ENV FLAGS — 44 in code

### Live + load-bearing (✅)
`LK_ALLOW_ORDER_SUBMISSION`, `LK_RPA_PERSIST_SESSION`, `LK_ORDER_ENGINE`,
`LK_CREDENTIAL_ENCRYPTION_KEY`, `SUPABASE_*`, `ANTHROPIC_API_KEY`,
`MILO_USERNAME/PASSWORD`, `API_BASE_URL`, `PORT`, `WORKER_MODE`, `FLY_MACHINE_ID`

### Set-and-forget tuning (✅ leave)
`LK_CONFIDENT_*`, `LK_PICKER_*`, `LK_RPA_LIGHT_VALIDATE`, `ENABLE_CONFIDENT_CACHE`

### ❓ VERIFY / cleanup
- 🟡 `SENTRY_DSN` — **placeholder = the reason nobody knew the app died.** FIX.
- ✅ `LK_CRON_SECRET` — **RESOLVED 7/4.** Verified the cron had failed ALL 36
  runs (GitHub secret was never set → 401 daily). Fixed: fresh secret set on
  BOTH Fly + GitHub repo secrets; manual `check-updates` returned 200.
  Verified against MLCC's site: May 3 book is still the newest full book →
  **prices were never actually stale — nothing was missed.** Remaining proof:
  tomorrow's ~6-7am scheduled run should go GREEN (check Actions tab once).
- 🟡 NEW (found 7/4): ingestor deliberately skips MLCC's between-book
  **"New Item Price List"** (e.g. June 7, 2026 list published; excluded at
  mlcc-price-book-ingestor.js:116). New SKUs released between full books are
  missing from the catalog (scanner/search can't see them) until the next full
  book. Small, real. Decide: ingest new-item lists too, or accept the lag.
- 💀 `UPCITEMDB_API_KEY` — UPCitemdb abandoned 6/4. Remove.
- ❓ `SUPABASE_JWT_SECRET` — replaced by ES256/JWKS 6/10; may be vestigial
- ❓ `DEBUG_UPC_FILTER`, `MILO_TEST_*`, `*_HEADFUL` — dev-only, confirm not set in prod

---

## 4. EXTERNAL SERVICES / SUBSCRIPTIONS — what you're actually paying for

**The "which subscriptions am I even using" answer:**

### Actively used — KEEP (✅)
- ✅ **Fly.io** — hosting (API + worker). Core.
- ✅ **Supabase** — database + auth. Core. (Project `eamoozfhqolshdztbrez` = prod.)
- ✅ **Anthropic (Claude)** — the AI assistant + vision. Core.
- ✅ **GitHub** — repo + the (maybe-inactive) cron workflow.
- ✅ **Michigan LARA / MILO** — the thing we automate (not a subscription).

### Paid but MAYBE unused — CHECK (💀/❓) — CORRECTED 7/3
- ❓ **Serper.dev** — Google Images API for bottle photos. Signed up, **never
  ran the full backfill.** If you're paying monthly, either run it once and
  keep, or cancel until you need it. (Genuinely optional — safe to cancel.)
- ⚠️ **UPCitemdb** — dropped as an IMAGE source 6/4, BUT verified 7/3 it's
  STILL wired into the UPC scan path (`lookupUpcFromUpcitemdb`,
  price-book.routes.js:1315). **DO NOT cancel yet** — it's doing real work on
  scans. Retiring it means replacing that lookup first (Open Food Facts is the
  other source already in the code). Was on my "cancel it" list — that was
  WRONG, corrected here.
- 💀 **Google Custom Search (CSE)** — genuinely dead-ended 6/8, the script is
  standalone (nothing imports it). Safe to disable billing on that Google
  Cloud project. **This is the one real "cancel it" today.**
- ❓ **Sentry** — account exists, DSN is a placeholder = not actually wired.
  Free tier is fine; just needs the real DSN. Don't pay until it's used.
- ❓ **Any others you subscribed to and forgot** — if it's not in this list,
  the CODE doesn't reference it → it's almost certainly cancelable. Send me
  the name and I'll confirm from the repo.

**⚠️ CENSUS LESSON (7/3): my first-pass "likely dead" guesses were WRONG on
pilot_ops, upc_lookups, and UPCitemdb — all three are still wired in.
Verification caught it before we deleted anything. The takeaway isn't "the
system is junk" — it's the opposite: it's MORE connected than it looks. Only
truly-dead things confirmed: the 2 unused image scripts + Google CSE billing.**

### Free / referenced only
- Open Food Facts (UPC fallback, free), cdnjs (CDN), npm (packages)

**Services verdict:** you're using 4 things (Fly, Supabase, Anthropic,
GitHub). Everything else is a photo-source experiment that didn't finish.
Likely 2-3 subscriptions to cancel today for real money back.

---

## 5. FEATURE SURFACES

### Scanner app pages (apps/scanner/src/pages) — ✅ mostly live
Scan, Cart, Browse, Inventory, Orders, OrderDetail, Assistant, Templates,
Settings, More — all active. 🟡 open items: template item-editing (add/remove
bottles) never built; AI-as-full-page + AI-accepts-images partial.

### Admin app — ❓ mixed
Founder Console (✅), Operator Review (✅), Image Curation (🟡 depends on the
image backfill decision), Diagnostics (✅), 🟡 **Pilot Ops pages** (tie to the
4 suspect tables — likely 💀), NRS Review (❓ abandoned queue?).
🟡 **Command Deck sign-in is still the token-paste hack** — you can barely log
into your own admin.

### API routes (services/api/src/routes) — ✅ core solid
21 route files, 100+ endpoints. Core (auth, cart, execution-runs, browse,
price-book, assistant, home) all live and used. The 🟡 `/items/:code/family`
endpoint still uses the OLD name-pool logic — the new family_key columns exist
but nothing reads them yet (the wiring we planned).

### Known dead/superseded code (💀)
- The old Validate→Submit two-step components (`startValidate`/`startSubmit`/
  `pollUntilTerminal`) — superseded by the async fire-and-track flow 6/26,
  marked "unreached" in comments. Safe to remove in a cleanup pass.

---

## THE PATH — finish-to-empty, in order (no new features until 🟡 = 0)

**Phase 0 — Trust & safety (this week, before anything):**
1. ✅ White-screen postmortem (fly logs) → fix the API boot problem for real. (DONE 7/3)
2. Uptime monitor + real Sentry DSN → the app can never die silently again.
3. ✅ Confirm `LK_CRON_SECRET` is set → prices aren't silently stale. (FIXED 7/4 —
   was broken all 36 runs; secret re-keyed both sides; prices verified current.
   Final proof = tomorrow's scheduled run green.)

**Phase 1 — Kill the dead (one afternoon, pure subtraction, feels amazing):**
4. Confirm + drop the 4 `pilot_ops_*` tables + their admin pages.
5. Cancel UPCitemdb + Google CSE billing; decide Serper (run once or cancel).
6. Archive the ~8 one-time loader scripts; delete the 2 dead image scripts.
7. Remove `UPCITEMDB_API_KEY` + vestigial flags; delete superseded validate code.

**Phase 2 — Finish the started (the order loop is the point):**
8. The notification layer (Phase 0 #3's cousin): "order needs you" push.
9. Family-tree wiring (engine + backfill DONE 7/1 → endpoint + chips + search).
10. Then, and only then: the deferred speed win (productId pre-map) + engine submit.

**Phase 3 — the rest of TONY-WANTS**, once the board is clean.

Every item above is finite and named. There is no "everything" anymore —
there's this list, and we cross items off until it's empty.
