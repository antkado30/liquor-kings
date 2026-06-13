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
| 6 | P0 | Client | AuthGate boot: no catch/finally + unbounded store_users await + auth-lock deadlock pattern → infinite "Loading your account" on flaky network | 🟡 hardened (timeouts/retry screen) — in tree |
| 7 | P1 | Client | Camera/ZXing decode loop hardcoded-active behind overlays; fresh 1MP canvas per tick + ×4 rotations every tick → overheating, laggy taps | 🟢 sleep + reuse + throttle deployed 06-12 |
| 8 | P1 | Data | Catalog photos stored at original retailer size (1–3MB) into a phone grid | 🟢 thumbs+capped fulls in prod; right-size at birth deployed 06-12 |
| 9 | P1 | Data | UPC tier-2 scoring: editions could outrank base (Lions class); unknown-size let nips tie fifths (Maker's class) | 🟢 penalty + retail prior deployed 06-12 |
| 10 | P1 | Data | Photo verify: sub-brand collisions passed both gates (Parrot Bay class) | 🟢 text Rule 3 + vision rule deployed 06-12 |
| 11 | P2 | Deps | npm reports 6 vulnerabilities (5 moderate, 1 high) in services/api | 🔴 triage pending (§Infra) |
| 12 | NOTE | Data | nrs_import EMPTY in prod → all 4,179 UPC mappings unverifiable | ⚪ needs Tony's NRS export → load-nrs-import.mjs → audit --apply |
| 13 | P1 | Infra | Zero error reporting (SENTRY_DSN + VITE_SENTRY_DSN unset; code is Sentry-ready both sides) | ⚪ Tony: sentry.io signup (~10 min) |
| 14 | P0 | Server | **UPC catalog-truth WRITES wide open** — /upc/:upc/confirm (writes user_confirmed mappings, exempt from safety swaps), /flag, /report-no-match had NO auth. Anyone could remap any barcode for every store | 🟢 sealed + deployed v149 |
| 15 | P0 | E2E | **Submit could lie: "Order submitted to MILO" on a dry-run downgrade.** Stage-5 triple gate silently downgrades submit→dry_run; run finalizes "succeeded"; truth lived only in workerNotes/evidence; green banner showed AND cleared the user's cart. Any not-yet-armed store's first submit = phantom order | 🟡 sealed: submit_result lifted into run summary (validate_result pattern) → client requires submitted===true for the green banner; amber "Nothing was ordered" + cart PRESERVED otherwise. 5/5 proofs. In tree |
| 15b | NOTE | UX | ⚪ Tony decision: should trigger REJECT submit upfront for a disarmed store ("Live ordering isn't enabled yet") instead of running a 2-min dry-run RPA? Cleaner UX, touches submit path — not built without sign-off |
| 16 | P1 | Worker | cart_reset_only success path missing `runSucceeded = true` → every successful cart reset / activation probe tore down the healthy warm session → next validate paid the 2-min cold path | 🟡 fixed, in tree |
| 17 | P0 | Worker | **No boundary comparison before live submit (doctrine #11)** — a partial Stage-3 outcome (e.g. 81 of 84 verified) flowed into Stage 5 and silently submitted a short order. Pre-submit modal shows the LOCAL cart, so no layer caught it | 🟡 sealed: hard gate refuses live submit on ANY requested-vs-verified mismatch (missing, qty, unexpected item), typed MLCC_CART_MISMATCH_BEFORE_SUBMIT, full mismatch list in evidence. 10/10 proofs. In tree |
| 18 | P1 | Worker | Stage-3 budget flat 240s regardless of cart size — 84 sequential adds ≈ at/over budget = the 2026-06-10 "4-minute validate death" class | 🟡 budget scales (120s + 4s/item, 240s floor, 600s cap; 84 items → 456s). Reaper-safe (per-item heartbeats). In tree |
| 19 | P1 | Worker/UX | Stage 3 emitted ONE heartbeat then went silent for minutes on big carts — blind wait (mandate violation) | 🟡 per-item onProgress → throttled heartbeats ("Adding items — 37 of 84"); guarded so progress can never sink a run. In tree |
| 20 | P0 | Worker | **No duplicate-submit protection across the crash window** — a run reaper-killed or timing-out mid-checkout reads as plain "failed"; a retry would place a second MILO order | 🟡 tripwire: refuses live submit when a same-store submit died AT CHECKOUT ambiguously within 30 min (error-toast/safety/boundary refusals exempt — those provably didn't submit); fails SAFE if the check itself errors. 7/7 proofs. In tree |
| 21 | P0 | Server | **Nothing serialized runs per store across 2 worker machines** — claim is atomic per RUN only; two queued runs for one store could run concurrently, two browsers fighting one account-scoped MILO cart (live risk since the worker app has 2 machines) | 🟡 sealed: partial unique index `one_running_run_per_store` (migration 20260613013000) + claim prefilters busy stores + treats 23505 as lost-claim. In tree, MIGRATION REQUIRED before deploy |
| 22 | P1 | Server | Reaper destroyed forensics (overwrote progress_stage with "reaped") and stamped UNKNOWN — hiding exactly the died-at-checkout signal #20 needs | 🟡 stage preserved, typed LK_RUN_REAPED, humanized. In tree |
| 23 | P2 | Worker | Hardcoded UNKNOWN failure types where precise codes existed (decrypt/no-creds/invalid-items/no-license) — actionable guidance hidden | 🟡 precise codes + humanizer entries. In tree |

---

## §1 Money path (cart → validate → submit → confirmation)
*Status: IN PROGRESS — begun 2026-06-12*

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
*Status: QUEUED*

## §4 Auth / tenancy / RLS / schema-vs-code
*Status: QUEUED*

## §5 Infra, dependencies, external-change tripwires
*Status: QUEUED*

## §6 Admin (Command Deck) + assistant + tag printing + remaining surfaces
*Status: QUEUED*
