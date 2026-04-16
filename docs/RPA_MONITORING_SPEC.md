# RPA minimum monitoring spec (documentation-only)

**Purpose:** Define **what** should be observable for MLCC-related runs, **when** events occur, and **where** an operator or integrator would review them — **without** implementing webhooks or changing runtime code in this task.

**Status:** This spec is **aligned to current implementation** where fields already exist; anything marked **recommended** is a forward-looking contract for a future integration task.

**Related:** [`contracts/rpa-run-summary.md`](./contracts/rpa-run-summary.md) (optional JSON shape mirror), [`MLCC_PRE_RUN_CHECKLIST.md`](./MLCC_PRE_RUN_CHECKLIST.md), [`MLCC_ROLLBACK_PLAN.md`](./MLCC_ROLLBACK_PLAN.md), [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md).

---

## Code alignment (reality-check)

- **On-disk summary fields** in §3 are copied from `buildMlccSafeFlowRunSummaryPayload` in `services/api/src/workers/mlcc-browser-evidence.js` (including `mlcc_dry_run_safe_mode` from the worker constant).
- **Disk write path:** `persistMlccDryRunRunSummaryToDisk` in `services/api/src/workers/mlcc-browser-worker.js` (only when `safeFlowOutDir` is non-null).
- **API heartbeats / finalize:** `heartbeatRun` and `finalizeRun` in `services/api/src/workers/execution-worker.js` — this spec does **not** duplicate every DB column; operators should inspect the live `execution_runs` schema in Supabase for indexes and extra columns.

---

## 1. Current observability (today)

| Sink | What appears | Notes |
|------|----------------|-------|
| **On-disk run folder** | When `MLCC_SAFE_FLOW_SCREENSHOT_DIR` is set and the worker resolves `safeFlowOutDir`: `mlcc_run_summary.json` + milestone PNG evidence files | Written at run end (`persistMlccDryRunRunSummaryToDisk` → `writeMlccSafeFlowRunSummaryJson` in `mlcc-browser-worker.js` / `mlcc-browser-evidence.js`). |
| **`execution_runs` (Supabase)** | `heartbeatRun` PATCH updates `progressStage` / `progressMessage`; `finalizeRun` PATCH sets `status`, `errorMessage`, `failureType`, `failureDetails`, `evidence` | See `services/api/src/workers/execution-worker.js` — requires API base URL + service role headers as configured in your deployment. |
| **CI / local verify** | `npm run safety:lk:rpa-local`, `verify:lk:rpa-safety` | Pre-merge / pre-pilot static signal; not per-store runtime monitoring. |
| **Structured in-memory evidence** | Array of objects with `kind`, `stage`, `message`, `attributes` | Ends up in finalize payload when passed through worker; tally reflected in on-disk summary. |

**Not implemented in this repo (explicit gap):** a **dedicated outbound webhook** or third-party APM sink for run summaries. If you add one later, treat it as a **separate approved task**; use §3 as the payload contract.

---

## 2. Event timing (logical phases)

These are **logical** timestamps for monitoring design; the worker records `started_at_iso` / `finished_at_iso` on disk when the summary is built at end of run.

| Phase | When | Minimum signal |
|-------|------|----------------|
| **run_claimed** | Worker claims a run from the API | `execution_runs` transitions to processing (per your API); optional `heartbeat` with `progressStage` after claim. |
| **run_started** | Browser / dry-run work begins | First `heartbeatRun` from MLCC worker (e.g. early `progressStage` values in `mlcc-browser-worker.js`). |
| **mapping_confidence_validated** | Before browser continues on guarded payloads | Evidence kind `mlcc_dry_run_mapping_confidence`, stage `validate_mapping_confidence`. |
| **run_blocked** | Guard or validation stops work | `finalizeRun` with `failed` + `failureType` / evidence; on-disk summary `outcome: "failure"` if disk path configured. |
| **run_success** | Normal completion | `finalizeRun` success path; on-disk summary `outcome: "success"`. |
| **run_summary_written** | End of dry-run path when disk enabled | Evidence kind `mlcc_safe_flow_run_summary`, stage `mlcc_safe_flow_run_summary_written` (attributes include absolute path to JSON). |

**Recommended (not all present as discrete events today):** explicit **`run_started_iso`** heartbeat field in API if you extend the heartbeat contract later.

---

## 3. Minimal run summary payload (on-disk contract)

**Source of truth in code:** `buildMlccSafeFlowRunSummaryPayload` in `services/api/src/workers/mlcc-browser-evidence.js`.

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `schema_version` | number | yes | Currently `1` (default argument). |
| `run_id` | string/UUID | yes | Execution run id. |
| `store_id` | string/UUID | yes | Store scope. |
| `worker_id` | string \| null | yes | Worker identifier if provided. |
| `outcome` | string | yes | e.g. `"success"` \| `"failure"` (worker passes explicit outcome). |
| `started_at_iso` | string | yes | ISO-8601 start. |
| `finished_at_iso` | string | yes | ISO-8601 end. |
| `error_message` | string \| null | yes | Populated on failure path. |
| `final_page_url` | string \| null | yes | Last known Playwright URL when summary built. |
| `mlcc_dry_run_safe_mode` | boolean | yes | Mirrors compile-time `MLCC_BROWSER_DRY_RUN_SAFE_MODE` (must remain `true` in current product posture). |
| `add_by_code_probe_enabled` | boolean | yes | Whether add-by-code probe was enabled for that run. |
| `network_guard_blocked_request_count` | number \| null | yes | Layer-2 guard counter when available. |
| `evidence_entry_count` | number | yes | Length of collected evidence array. |
| `evidence_kinds_tally` | object | yes | Map of `kind` → count from `tallyMlccEvidenceEntriesByKind`. |
| `milestone_screenshot_evidence_entries` | number | yes | Count of `mlcc_safe_flow_milestone_screenshot` entries. |
| `run_summary_basename` | string | yes | Constant `mlcc_run_summary.json`. |

**Recommended extensions (future webhook / admin parity — not in current payload):**

- `line_item_count` — cart lines in execution payload.
- `mappingconfidence_summary` — counts of `confirmed` / `inferred` / `unknown` on payload.
- `git_commit` / `worker_image_tag` — build provenance.

---

## 4. Intended review sinks (operational)

| Audience | Sink | How to use |
|----------|------|------------|
| **Engineering** | On-disk `mlcc_run_summary.json` + PNG folder | Compare `evidence_kinds_tally` to incident narrative; correlate `finished_at_iso` with host logs. |
| **Operations / support** | Supabase `execution_runs` + admin UI | Filter by `store_id`, time, `status`; read `error_message` and `evidence` JSON for operator-visible stages. |
| **Security / compliance** | Read-only SQL audits | [`RLSAUDIT.md`](./RLSAUDIT.md) for RLS posture if access or data scope is questioned. |
| **Future automation** | **Webhook (not implemented)** | If added: POST a superset of §3 at `run_success` / `run_blocked` only after redaction policy is approved; do not exfiltrate secrets or raw credentials. |

---

## 5. Alignment with pilot readiness

- **Pre-pilot:** operators know **where** summaries land (`MLCC_SAFE_FLOW_SCREENSHOT_DIR`) and how to open **`execution_runs`** for the same `run_id`.
- **Post-incident:** [`MLCC_ROLLBACK_PLAN.md`](./MLCC_ROLLBACK_PLAN.md) lists the same artifacts as mandatory exports.
- **No false confidence:** unattended “production RPA” is **out of scope** until explicit future tasks add approved sinks + real-mode controls.
