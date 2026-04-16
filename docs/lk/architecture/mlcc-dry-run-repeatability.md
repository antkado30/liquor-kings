# MLCC browser dry-run — repeatability and operator readiness (2a–2w)

**Scope:** Operational repeatability for **existing** safe phases only. **Checkout, submit, finalize, and real order placement are out of scope** and must not be enabled via this document.

**Canonical phase table:** [rpa-rebuild-phases.md](./rpa-rebuild-phases.md)  
**Safety rules:** [rpa-safety-rules.md](./rpa-safety-rules.md)

## Operator quick path (step by step)

Do these in order; skip steps that do not apply to your tenant.

1. **Copy env** — Put tenant secrets and URLs in `services/api/.env` (or your deploy secret store). Never commit credentials.
2. **Doctor (config-only)** — From repo root: `npm run doctor:lk:mlcc-dry-run -- <store_mlcc_username>`. Exit **0** means structural readiness passed; **1** means fix listed errors; **2** means username missing. This command does **not** open a browser.
3. **Read SUMMARY** — The printed report includes runnable vs off counts and a **Suggested next action** line. Use that before changing env at random.
4. **Interpret phase rows** — Each phase shows **Status** (`RUNNABLE` vs `off`) and **Off-kind**:
   - **`blocked(2b)`** — `MLCC_ADD_BY_CODE_PROBE` is false. Phases **2c–2w** are structurally blocked until 2b is on; base login/2a_nav can still be runnable.
   - **`disabled`** — That phase’s own flags (and any `*_APPROVED` gate) are off; turn them on only when prior steps in this doc are green.
   - **`—`** (runnable) — Config allows the phase; you must still run the worker dry-run and confirm evidence for that phase id (doctor does not prove UI success).
5. **Tenant vs generic lists** — Below the table, **Tenant-specific keys** are what you must document per MLCC skin; **Generic / operator flags** are booleans and shared patterns.
6. **Worker dry-run** — After doctor is clean for your target depth: `npm run worker:mlcc-browser-dry-run` from `services/api` (see `package.json`). Still **no** checkout/submit/finalize in the worker during this rebuild phase.
7. **Anti-drift** — After env or readiness code changes: `npm run verify:lk:rpa-safety` and `npm run verify:lk:architecture` from repo root.

**2Q without 2O:** If you enable Phase 2Q but not 2O, the worker and doctor expect **`MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true`** (explicit waiver per phase plan). Otherwise 2Q is treated as not ready.

**2D vs 2E:** Enable **at most one** of `MLCC_ADD_BY_CODE_PHASE_2D` and `MLCC_ADD_BY_CODE_PHASE_2E` for a given config (mutually exclusive paths).

**`MLCC_SUBMISSION_ARMED`:** May appear in env for future guardrails; submit/finalize paths are **not** implemented in safe dry-run — do not treat it as permission to place orders.

## Minimum config (every tenant run)

| Item | Source | Tenant-specific? |
|------|--------|------------------|
| MLCC username | Execution payload `store.mlcc_username` | Yes (per store) |
| MLCC password | `MLCC_PASSWORD` | Yes (secret; not in repo) |
| Login URL | `MLCC_LOGIN_URL` | Usually yes (tenant portal) |
| Safe / ordering URLs | `MLCC_SAFE_TARGET_URL`, optional `MLCC_ORDERING_ENTRY_URL` | Usually yes |

Without these, `buildMlccBrowserConfig` returns `ready: false` — the worker will not start a useful dry-run.

## Tenant-specific vs generic configuration

**Typically tenant-specific (selectors and URLs):**

- License/store: `MLCC_LICENSE_STORE_*` selectors, URL pattern
- Add-by-code: `MLCC_ADD_BY_CODE_ENTRY_SELECTOR`, `MLCC_ADD_BY_CODE_CODE_FIELD_SELECTOR`, `MLCC_ADD_BY_CODE_QTY_FIELD_SELECTOR`, `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR`
- Phase 2f: `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` (JSON)
- Phase 2n: `MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS` (JSON)
- Phase 2q: `MLCC_ADD_BY_CODE_PHASE_2Q_VALIDATE_SELECTORS` (JSON)
- Optional text allowlists: `MLCC_ADD_BY_CODE_*_TEXT_ALLOW_SUBSTRINGS` where documented

**Shared / operator pattern (boolean gates and approvals):**

- `MLCC_ADD_BY_CODE_PROBE`, `MLCC_ADD_BY_CODE_PHASE_2C` … `MLCC_ADD_BY_CODE_PHASE_2R`, plus MILO successor gates `MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE` / `MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE`
- `*_APPROVED` flags for gated phases (2H, 2J, 2L, 2N, 2O, 2Q, 2R, 2V, 2W)
- Test payloads: `MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE`, `*_TEST_QUANTITY`, combined rehearsal fields for 2L
- `MLCC_HEADLESS`, `MLCC_STEP_SCREENSHOTS`, `MLCC_STEP_SCREENSHOT_MAX_BYTES` (optional), `MLCC_SUBMISSION_ARMED` (submit **not** implemented; guard for future)

**Planning-only (no env flags; do not import in worker/probe until execution phase):**

- [`mlcc-phase-2s-policy.js`](../../../services/api/src/workers/mlcc-phase-2s-policy.js) — future checkout model
- [`mlcc-phase-2v-2w-policy.js`](../../../services/api/src/workers/mlcc-phase-2v-2w-policy.js) — MILO validate/post-validate successor contracts (2V bounded runtime + 2W design-only)

## Phase-by-phase dry-run checklist (operator / dev)

Use this in order when enabling deeper phases. Each step assumes previous prerequisites from [rpa-rebuild-phases.md](./rpa-rebuild-phases.md).

1. **Base** — Payload username + `MLCC_PASSWORD` + `MLCC_LOGIN_URL` (+ safe/ordering URLs as needed). Run worker once; confirm login and `mlcc_ordering_ready_*` evidence.
2. **2a license (optional)** — `MLCC_LICENSE_STORE_AUTOMATION=true` + both selectors; optional URL pattern.
3. **2b probe** — `MLCC_ADD_BY_CODE_PROBE=true`; optional `MLCC_ADD_BY_CODE_ENTRY_SELECTOR` (single bounded open click, Layer-3 guarded). Scans for visible code-like inputs and may click only **safe** text-matched controls (`add by code`, `enter code`, etc.). On **MILO**, the search field often does **not** appear on generic `/milo/products` or home, so `add_by_code_ui_reached` may stay **false** with `stop_reason=no_safe_entry_path_found_without_dangerous_controls` — **expected** unless you document a tenant-specific entry control. That does **not** block deeper phases when you use the bounded route below.
4. **2c** — `MLCC_ADD_BY_CODE_PHASE_2C=true` (requires probe). **Canonical bounded entry to the add-by-code surface on MILO:** default navigation to `{login-origin}/milo/products/bycode` (override with `MLCC_ADD_BY_CODE_PHASE_2C_NAV_URL` if needed). Tenant code/qty CSS is optional; placeholder `Search by code` is the default anchor when no tenant code selector matches. Still no typing, cart mutation, validate, or checkout.
5. **2d or 2e** — Exactly one path: either `MLCC_ADD_BY_CODE_PHASE_2D` **or** `MLCC_ADD_BY_CODE_PHASE_2E` (never both). Use **after Phase 2c** on canonical `/milo/products/bycode`. Both phases attach **`bycode_surface_boundary_pack`** (code/qty field snapshots, container chain, form summary, structure hints, help/error text samples, surrounding controls with observed-only risk labels) plus a **read-only** interactive control scan (bounded to form / `role="search"` / `.search-container` / parent when possible; full-page fallback if empty). **2e:** optional `MLCC_MUTATION_BOUNDARY_ROOT_SELECTOR` overrides scope; without it, worker auto-scopes from the resolved by-code field. Uncertain hints JSON is advisory only.
6. **2f** — `MLCC_ADD_BY_CODE_PHASE_2F=true` + non-empty `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` JSON. Bounded **at most one** open-intent click only if add-by-code UI is **not** already detected as open; after **2c** on MILO by-code, the worker usually **skips the click** (signals already satisfied) while still persisting **2f** evidence. No typing; not validate/checkout/submit.
7. **2g** — `MLCC_ADD_BY_CODE_PHASE_2G=true`; **default read-only** (policy manifest + mutation-risk + field snapshots). Optional `MLCC_ADD_BY_CODE_PHASE_2G_FOCUS_BLUR_REHEARSAL` or sentinel pair (`MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_TYPING` + `MLCC_ADD_BY_CODE_PHASE_2G_SENTINEL_VALUE` matching `^__LK_…__$`); **number** inputs skip sentinel until a future numeric policy. No real product codes unless a later approved phase.
8. **2h** — `MLCC_ADD_BY_CODE_PHASE_2H=true` + `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true` + test code + tenant code selector.
9. **2j** — `MLCC_ADD_BY_CODE_PHASE_2J=true` + approved + test quantity + tenant qty selector.
10. **2l** — `MLCC_ADD_BY_CODE_PHASE_2L=true` + approved + field order + both test values + both tenant selectors.
11. **2n** — `MLCC_ADD_BY_CODE_PHASE_2N=true` + approved + `MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS` JSON (requires 2L gates in config). **Do not use for MILO** when repeated evidence shows no single-line add/apply control and only bulk `Add all to Cart`.
12. **2u (MILO bulk single-click)** — `MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK=true` + `MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_APPROVED=true` + non-empty `MLCC_ADD_BY_CODE_PHASE_2U_MILO_BULK_SELECTORS` JSON. Requires 2L gates; runtime is **one bounded click max** with Layer 2/3 guards and must be judged with the MILO 2U acceptance rubric below.
13. **2o** — read-only post-click observation (zero clicks). Legacy path: `MLCC_ADD_BY_CODE_PHASE_2O=true` + approved (requires 2N). MILO path: `MLCC_ADD_BY_CODE_PHASE_2O_MILO_POST_2U=true` + approved (requires successful same-run 2U; decoupled from 2N).
14. **2q** — `MLCC_ADD_BY_CODE_PHASE_2Q=true` + approved + validate selectors JSON; if 2O off, `MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true`.
15. **2r** — `MLCC_ADD_BY_CODE_PHASE_2R=true` + approved (requires 2Q; zero clicks; inferred checkout-like text is **not** permission to proceed).
16. **2v (MILO validate successor)** — `MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE=true` + `MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_APPROVED=true` + non-empty `MLCC_ADD_BY_CODE_PHASE_2V_MILO_VALIDATE_SELECTORS` JSON + MILO `2U` and MILO `2O` prerequisites. Runtime is **at most one bounded validate click** with Layer 2/3 guards.
17. **2w (MILO post-validate successor, inert skeleton)** — `MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE=true` + `MLCC_ADD_BY_CODE_PHASE_2W_MILO_POST_VALIDATE_APPROVED=true` (contract requires `2V`; optional settle ms). Runtime emits structured **design-only blocked** evidence (no post-validate execution).

### MILO-specific replacement contract (2u guarded execution model)

Use this when MILO by-code repeatedly shows **no single-line add/apply** control and only bulk-style `Add all to Cart`.

- **Purpose:** define a future MILO post-2L bounded action model around one guarded bulk target click.
- **Preconditions:** 2L proven on MILO; repeated read-only captures showing absent single-line control; stable bulk control signature documented (label/selector context/a11y).
- **Approvals / gates:** dedicated MILO-specific env gate + dedicated `*_APPROVED` gate + tenant-locked selector list for bulk target only.
- **Safety assumptions:** one click max; Layer 2 delta checks remain required; Layer 3 downstream forbiddens remain active for validate/checkout/submit/finalize.
- **Required evidence for each run:** pre-click and post-click snapshots, candidate evaluation dump, selector clicked, blocked-request deltas, explicit exclusion of any non-target cart/order controls.
- **Reconciliation payload:** capture and compare `pre_click_observation` vs `immediate_post_click_observation` plus `immediate_post_click_reconciliation_diff` (URL/title/body excerpt, success/error samples, cart summary samples, by-code row samples, cart-badge/count samples, control inventory sample deltas).
- **Success / failure:** success = exactly one approved bulk target click with declared evidence; failure = zero target eligible, wrong target matched, positive Layer 2 delta, or any downstream forbidden behavior.
- **Forbidden:** any validate/checkout/submit/finalize action in same phase; any second click; any claim that browser evidence proves server cart truth.

### MILO 2U acceptance rubric (standard go/no-go)

Apply this rubric to each approved 2U run before calling the run acceptable.

- **Acceptable:** `click_count_this_phase=1`; clicked selector/label matches approved 2U target set; `network_guard_delta_during_click=0`; `no_new_blocked_downstream_requests_observed=true`; downstream phases remain off/null (`2o/2q/2r`); post-click observation payload present (`url`, `title`, `body_text_excerpt`, success/error samples, cart summary samples, by-code row samples, immediate control sample).
- **Acceptable:** `click_count_this_phase=1`; clicked selector/label matches approved 2U target set; `network_guard_delta_during_click=0`; `no_new_blocked_downstream_requests_observed=true`; downstream phases remain off/null (`2o/2q/2r`); reconciliation payload present (`pre_click_observation`, `immediate_post_click_observation`, `immediate_post_click_reconciliation_diff`, control samples).
- **Warning:** bounded click still occurred, but post-click read-only payload changed materially from current baseline (new warning/error text, URL/title drift, or major control inventory drift) while Layer 2 delta remains 0 and downstream phases remain off; requires operator review before treating as stable repeatability.
- **Fail:** click count not equal to 1; wrong/unapproved selector clicked; positive Layer 2 delta; downstream-forbidden indicators not clear; downstream phases enabled; or required post-click observation payload missing/empty.

## Repeatability harness (doctor)

**Command (repo root):**

```bash
npm run doctor:lk:mlcc-dry-run -- <store_mlcc_username>
```

Or set `MLCC_DOCTOR_USERNAME` / `MLCC_DOCTOR_STORE_USER` and run without args (see script help).

Loads optional `services/api/.env`, calls `buildMlccDryRunReadinessReport` (uses `buildMlccBrowserConfig` — **no browser**). Exit code **0** if config is structurally ready; **1** if config errors; **2** if username missing.

Implementation: [`scripts/lk-verify/mlcc-dry-run-doctor.mjs`](../../../scripts/lk-verify/mlcc-dry-run-doctor.mjs), [`services/api/src/workers/mlcc-dry-run-readiness.js`](../../../services/api/src/workers/mlcc-dry-run-readiness.js).

## Evidence: where to look

| Area | Typical evidence `kind` / `stage` | What it shows |
|------|-----------------------------------|---------------|
| Ordering ready | `mlcc_step_snapshot` / `mlcc_ordering_ready_landing` | URL/title heuristic landing |
| License 2a | license-store stages in worker evidence | Bounded navigation only |
| Probe 2b | `mlcc_add_by_code_probe` | Field detection, optional safe open; on MILO, `add_by_code_ui_reached: false` on generic products is common (use Phase 2c by-code route) |
| 2c | `mlcc_add_by_code_phase_2c_findings` | By-code route, field hardening |
| 2d / 2e | `mlcc_mutation_boundary_map_findings` / `mlcc_mutation_boundary_phase_2e_findings` | `bycode_surface_boundary_pack` + bounded or full-page control scan (read-only) |
| 2f–2g | `mlcc_phase_2*` findings | Policy, scans, rehearsal |
| 2h/2j/2l | `mlcc_phase_2h_*`, `2j_*`, `2l_*` | Fill/clear; lengths not values where applicable |
| 2n | `mlcc_phase_2n_*` | Single add/apply click, Layer 2 delta |
| 2o | `mlcc_phase_2o_*` | Read-only observation, zero clicks |
| 2q | `mlcc_phase_2q_*` | Single validate click, disclaimers |
| 2r | `mlcc_phase_2r_*` | Post-validate read-only, inferred controls |
| Run summary | `worker_log` / `completed` | Enabled phases, policy versions |

## Allowed vs forbidden claims (truthfulness)

**Allowed to say (when supported by evidence attributes for that run):**

- Which phases ran and their **env-gated** outcomes (e.g. click performed, observation performed).
- Layer 2 **blocked request count** deltas **for configured patterns** (not “no server mutation”).
- Visible DOM / text samples as **browser-local** observations.
- “Inferred” labels on regex-based cart/checkout **hints** (explicitly not inventory or authorization).

**Forbidden (unless a future phase explicitly authorizes and evidence supports it):**

- Checkout completed, cart submitted, order finalized, or payment captured.
- “Safe to checkout” or “ready to submit” from dry-run or validate/post-validate alone.
- Backend order truth, inventory, or pricing **from DOM alone**.
- Assuming MLCC is “generally safe” from a single tenant run.

## Related commands

- Dry-run worker: `npm run worker:mlcc-browser-dry-run` in `services/api` (see `services/api/package.json`).
- Anti-drift: `npm run verify:lk:rpa-safety`, `npm run verify:lk:architecture` from repo root.
- Broader product direction (MILO vs MLCC paths, reconciliation, durable truth): [strategic-architecture.md](./strategic-architecture.md).
