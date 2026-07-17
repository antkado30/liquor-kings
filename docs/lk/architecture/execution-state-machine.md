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
| `submitted_unconfirmed` | Terminal. Submit click DISPATCHED in submit mode; no confirmation or rejection captured before the run ended. The order likely exists on MILO — external truth (MLCC email / Orders page) outranks run state. Never auto-retried, never re-queued. (2026-07-16 postmortem P0-1, "the truth rule.") |

- **Active (non-terminal) for duplicate-run checks:** `ACTIVE_STATUSES = ["queued", "running"]`
- **Terminal:** `TERMINAL_STATUSES = ["succeeded", "failed", "canceled", "submitted_unconfirmed"]`

## Retry rules

- `retry_count` and `max_retries` on `execution_runs` (default max retries: **2** in code).
- Automatic re-queue on worker finalize when failure is **retryable** (`execution-failure.service.js`) and `retry_count < max_retries` (see `updateExecutionRunStatus`).
- **Operator `retry_now`:** only if `summary.retry_allowed` is true (failed + retryable + under max + not blocked by latest operator action semantics — see `buildRunSummary`).
- **The submit-click line (2026-07-16):** once Stage 5 dispatches the Checkout click, NO path may re-queue the run — not the failure-type allow-list (post-click crashes can surface as generic retryable codes like `TARGET_CLOSED`), not an operator action. Enforced twice: `submitted_unconfirmed` never enters the `failed` retry branch at all, and the `failed` branch itself refuses to re-queue when `failure_details.submit_clicked === true` (the one thrown post-click error is MILO's explicit rejection toast). Re-running a dispatched submit is the double-order machine.

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
