# Execution state machine (canonical)

**Implementation:** `services/api/src/services/execution-run.service.js`  
**HTTP:** `services/api/src/routes/execution-runs.routes.js`

## Run statuses

Defined in code as `ALLOWED_STATUSES`:

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for a worker to claim |
| `running` | Claimed; worker may heartbeat / finalize |
| `succeeded` | Terminal success |
| `failed` | Terminal failure |
| `canceled` | Terminal cancel |

- **Active (non-terminal) for duplicate-run checks:** `ACTIVE_STATUSES = ["queued", "running"]`
- **Terminal:** `TERMINAL_STATUSES = ["succeeded", "failed", "canceled"]`

## Retry rules

- `retry_count` and `max_retries` on `execution_runs` (default max retries: **2** in code).
- Automatic re-queue on worker finalize when failure is **retryable** (`execution-failure.service.js`) and `retry_count < max_retries` (see `updateExecutionRunStatus`).
- **Operator `retry_now`:** only if `summary.retry_allowed` is true (failed + retryable + under max + not blocked by latest operator action semantics — see `buildRunSummary`).

## Attempt history truth

- Table: `execution_run_attempts` (see migrations under `supabase/migrations/`).
- Rows created/updated on claim, heartbeat, and terminal status paths in `execution-run.service.js`.
- Review bundle includes `attempt_history` via `getExecutionRunOperatorReviewBundleById` / `getExecutionRunAttemptsById`.
- Attempt rows reflect **stored** progress and evidence metadata; they do not invent per-attempt `mlcc_signal` on attempts (signals live on run `failure_details` where applicable).

## Operator action model

**Constants:** `OPERATOR_ACTION` in `execution-run.service.js` (also exported as `EXECUTION_RUN_MODEL.OPERATOR_ACTION`).

| Action | Purpose (high level) |
|--------|----------------------|
| `acknowledge` | Ack terminal / review state |
| `mark_for_manual_review` | Flag for manual review |
| `retry_now` | Re-queue when allowed |
| `cancel` | Cancel run |
| `resolve_without_retry` | Close failed run without retry |

**Guardrails:** `applyExecutionRunOperatorAction` validates action name, store match, and rules such as `retry_now` when `!retry_allowed` → **400** with `retry_now is not allowed for this run`.

**Tests:** `services/api/tests/operator-actions.unit.test.js`
