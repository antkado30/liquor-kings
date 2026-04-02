# MLCC browser dry-run — repeatability and operator readiness (2a–2r)

**Scope:** Operational repeatability for **existing** safe phases only. **Checkout, submit, finalize, and real order placement are out of scope** and must not be enabled via this document.

**Canonical phase table:** [rpa-rebuild-phases.md](./rpa-rebuild-phases.md)  
**Safety rules:** [rpa-safety-rules.md](./rpa-safety-rules.md)

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

- `MLCC_ADD_BY_CODE_PROBE`, `MLCC_ADD_BY_CODE_PHASE_2C` … `MLCC_ADD_BY_CODE_PHASE_2R`
- `*_APPROVED` flags for gated phases (2H, 2J, 2L, 2N, 2O, 2Q, 2R)
- Test payloads: `MLCC_ADD_BY_CODE_PHASE_2H_TEST_CODE`, `*_TEST_QUANTITY`, combined rehearsal fields for 2L
- `MLCC_HEADLESS`, `MLCC_STEP_SCREENSHOTS`, `MLCC_SUBMISSION_ARMED` (submit **not** implemented; guard for future)

**Planning-only (no env flags; do not import in worker/probe until execution phase):**

- [`mlcc-phase-2s-policy.js`](../../../services/api/src/workers/mlcc-phase-2s-policy.js) — future checkout model

## Phase-by-phase dry-run checklist (operator / dev)

Use this in order when enabling deeper phases. Each step assumes previous prerequisites from [rpa-rebuild-phases.md](./rpa-rebuild-phases.md).

1. **Base** — Payload username + `MLCC_PASSWORD` + `MLCC_LOGIN_URL` (+ safe/ordering URLs as needed). Run worker once; confirm login and `mlcc_ordering_ready_*` evidence.
2. **2a license (optional)** — `MLCC_LICENSE_STORE_AUTOMATION=true` + both selectors; optional URL pattern.
3. **2b probe** — `MLCC_ADD_BY_CODE_PROBE=true`; optional entry selector. Confirms add-by-code UI mapping without typing.
4. **2c** — Tenant code/qty field selectors + `MLCC_ADD_BY_CODE_PHASE_2C=true`.
5. **2d or 2e** — One of `MLCC_ADD_BY_CODE_PHASE_2D` or `MLCC_ADD_BY_CODE_PHASE_2E` (not both); 2e may set scoped root + uncertain hints JSON.
6. **2f** — `MLCC_ADD_BY_CODE_PHASE_2F=true` + non-empty `MLCC_ADD_BY_CODE_SAFE_OPEN_CANDIDATE_SELECTORS` JSON.
7. **2g** — `MLCC_ADD_BY_CODE_PHASE_2G=true`; optional rehearsal flags per env doc.
8. **2h** — `MLCC_ADD_BY_CODE_PHASE_2H=true` + `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true` + test code + tenant code selector.
9. **2j** — `MLCC_ADD_BY_CODE_PHASE_2J=true` + approved + test quantity + tenant qty selector.
10. **2l** — `MLCC_ADD_BY_CODE_PHASE_2L=true` + approved + field order + both test values + both tenant selectors.
11. **2n** — `MLCC_ADD_BY_CODE_PHASE_2N=true` + approved + `MLCC_ADD_BY_CODE_PHASE_2N_ADD_APPLY_SELECTORS` JSON (requires 2L gates in config).
12. **2o** — `MLCC_ADD_BY_CODE_PHASE_2O=true` + approved (requires 2N; zero clicks at runtime).
13. **2q** — `MLCC_ADD_BY_CODE_PHASE_2Q=true` + approved + validate selectors JSON; if 2O off, `MLCC_ADD_BY_CODE_PHASE_2Q_OPERATOR_ACCEPTS_MISSING_2O=true`.
14. **2r** — `MLCC_ADD_BY_CODE_PHASE_2R=true` + approved (requires 2Q; zero clicks; inferred checkout-like text is **not** permission to proceed).

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
| Probe 2b | `mlcc_add_by_code_probe` | Field detection, safe open |
| 2c–2g | `mlcc_phase_2*` findings | Policy, scans, rehearsal |
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
