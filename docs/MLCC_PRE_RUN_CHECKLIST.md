# MLCC pre–first-real-order checklist (supervised pilot only)

**Purpose:** A concrete, same-day checklist before any **future** first **supervised** MLCC order attempt. This doc does **not** enable real ordering or change SAFE MODE. It assumes you will **not** run unattended automation against production MLCC.

**Related:** [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md) (canonical Gate / DONE rollup), [`RPA_SAFETY_CHECKLIST.md`](./RPA_SAFETY_CHECKLIST.md), [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md), [`MLCC_MAPPING.md`](./MLCC_MAPPING.md), [`SELECTORS.md`](./SELECTORS.md), [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md).

---

## 1. Human and policy gates (non-negotiable)

- [ ] **Human-present operator** for the entire session (someone who can stop the worker, read MLCC UI, and call support). No “start and walk away.”
- [ ] **Written / explicit business approval** for this specific pilot window (who approved, date, scope: which store(s), max lines, max cart value if applicable). This is **outside** the repo; the checklist only records that it happened.
- [ ] **Real-mode is still off by default:** do **not** treat this checklist as permission to enable checkout/submit/finalize in the browser worker. The codebase today documents `MLCC_SUBMISSION_ARMED` as a future gate; SAFE MODE dry-run does **not** perform submit/place/confirm order clicks (see [`lk/architecture/rpa-safety-rules.md`](./lk/architecture/rpa-safety-rules.md)).

---

## 2. SAFE MODE validation immediately before the attempt

Run from **repo root** (same stack as local safety gate; see root `package.json`):

```bash
npm run safety:lk:rpa-local
```

That runs, in order:

1. `npm run doctor:lk:mlcc-dry-run` — static checks (e.g. `MLCC_BROWSER_DRY_RUN_SAFE_MODE === true` in `mlcc-browser-worker.js`, presence of `verify-rpa-safety.mjs`, SAFE MODE invariant test, CI workflow doc, safety docs).
2. `npm run test:ci` — API unit tests (CI-shaped; smoke excluded).
3. `npm run verify:lk:rpa-safety` — RPA static gate + SAFE MODE invariant.

- [ ] **All three complete successfully** on the branch / commit you will use for the pilot worker.
- [ ] If you changed **quantity rules** or **mapping guard** since last green run: also run targeted tests listed in [`RPA_SAFETY_CHECKLIST.md`](./RPA_SAFETY_CHECKLIST.md).

---

## 3. `mappingconfidence` confirmed (runtime dry-run guard)

Per [`MLCC_MAPPING.md`](./MLCC_MAPPING.md):

- [ ] **Payload review:** every cart line intended for the run has `mappingconfidence` set intentionally (`confirmed`, `inferred`, or `unknown`).
- [ ] **Fail-closed behavior understood:** `unknown` **blocks** the dry-run before browser work on those lines (`evaluateDryRunMappingConfidenceGuard` in `services/api/src/quantity-rules/index.js`; worker evidence kind `mlcc_dry_run_mapping_confidence`, stage `validate_mapping_confidence`).
- [ ] **`inferred`:** allowed but surfaced for **human review** in evidence — operator must accept residual catalog risk before proceeding.
- [ ] **SQL catalog posture (Gate 1 / Gate 2):** if the pilot depends on catalog linkage, refresh [`MLCC_MAPPING.md`](./MLCC_MAPPING.md) snapshots using `sql/mlcc_mapping_audit.sql` per that doc (read-only SQL).

---

## 4. Evidence capture verification

- [ ] **`MLCC_SAFE_FLOW_SCREENSHOT_DIR`** is set for the worker environment when you need **on-disk** artifacts: under that base, the worker resolves a per-run directory via `buildMlccSafeFlowRunOutputDir(base, runId)` and can write milestone screenshots and **`mlcc_run_summary.json`** (see `services/api/src/workers/mlcc-browser-evidence.js` and worker `persistMlccDryRunRunSummaryToDisk`).
- [ ] **Operator knows the absolute path** to the run folder and can copy it off-box after the run.
- [ ] **In-run evidence:** worker collects structured `evidence` entries (kinds/stages vary by phase); **finalize** path can attach evidence to the run record via `finalizeRun` (see `execution-worker.js`). Confirm your **admin / API** review path for the `execution_runs` row for this `run_id`.
- [ ] **Login / selector failures:** diagnostics may include bounded screenshots/HTML excerpts where implemented (see [`SELECTORS.md`](./SELECTORS.md)); do not disable network guards to “unstick” a run ([`RPA_SAFETY_CHECKLIST.md`](./RPA_SAFETY_CHECKLIST.md)).

---

## 5. Explicit operator approval (env gates for gated phases)

Phases that type real test values or combined gestures require **explicit** env flags (documented in `mlcc-browser-worker.js` header comments), for example:

- `MLCC_ADD_BY_CODE_PHASE_2H_APPROVED=true` (with `MLCC_ADD_BY_CODE_PHASE_2H=true` and other prerequisites)
- `MLCC_ADD_BY_CODE_PHASE_2J_APPROVED=true`
- `MLCC_ADD_BY_CODE_PHASE_2L_APPROVED=true`

- [ ] **Only** the phases you intend are enabled; approval env vars are **not** left `true` in shared `.env` templates by accident.
- [ ] **Pilot scope:** if the pilot is *only* a dry-run / recon path, leave add-by-code phases off unless they are explicitly in scope for that session.

---

## 6. Session continuity and docs

- [ ] Skim last entries in [`SESSIONLOG.md`](./SESSIONLOG.md) and [`WHATSNEXT.md`](./WHATSNEXT.md).
- [ ] After the pilot session, append a SESSIONLOG entry (commands run, PASS/FAIL, artifact paths).

---

## 7. Mapping to “Gate 2” / pre-first-real-order readiness

| Gate / concern | Where addressed |
|----------------|-----------------|
| **Static SAFE MODE invariants** | `npm run safety:lk:rpa-local` + [`SAFETY_INVARIANTS.md`](./SAFETY_INVARIANTS.md) |
| **Catalog / linkage confidence** | [`MLCC_MAPPING.md`](./MLCC_MAPPING.md) + SQL audit |
| **Runtime mapping guard** | Same doc + worker mapping-confidence evidence |
| **Operator + approval** | Sections 1, 5 above |
| **Artifacts for audit** | Section 4 + [`MLCC_ROLLBACK_PLAN.md`](./MLCC_ROLLBACK_PLAN.md) |
| **Future monitoring contract** | [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md) + optional [`contracts/rpa-run-summary.md`](./contracts/rpa-run-summary.md) |

---

## Assumptions to validate with a human before a real pilot

- **Who** is on-call for MLCC vendor / account issues and **internal** escalation during the window.
- **Whether** a future real-order path will use the same `execution_runs` + evidence model or a different one — this checklist reflects **current** dry-run / worker behavior only.
- **No automated cancellation** of MLCC orders is implied by Liquor Kings RPA docs today; rollback is **operational** (see rollback plan).

---

## Code alignment (reality-check)

Evidence paths and env names in §4 match `services/api/src/workers/mlcc-browser-evidence.js` (`buildMlccSafeFlowRunOutputDir`, `MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME`, `buildMlccSafeFlowRunSummaryPayload`) and `mlcc-browser-worker.js` (`persistMlccDryRunRunSummaryToDisk`). Finalize API fields match `finalizeRun` in `services/api/src/workers/execution-worker.js`. If your deployment wraps these APIs, confirm field names in **your** OpenAPI or route handlers before pilot.
