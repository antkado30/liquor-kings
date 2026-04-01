# API contract truth — what exists now

**Only** endpoints and shapes that are wired in the codebase at the time of Anti-Drift v1.  
Admin UI may call these via `apps/admin`; paths below are **server** paths.

## Execution runs (`/execution-runs`)

**Router:** `services/api/src/routes/execution-runs.routes.js`  
**Prefix:** Mounted at `/execution-runs` with `resolveAuthenticatedStore` (except behaviors that only use service role on claim).

| Method | Path | Notes |
|--------|------|--------|
| POST | `/execution-runs/claim-next` | `requireServiceRole` — worker claim |
| POST | `/execution-runs/from-cart/:storeId/:cartId` | Create run from cart |
| GET | `/execution-runs/cart/:storeId/:cartId` | List runs for cart |
| GET | `/execution-runs/cart/:storeId/:cartId/history` | Summaries |
| GET | `/execution-runs/review/:storeId/runs` | Operator review list (filters: status, failure_type, pending_manual_review, cart_id, limit, offset) |
| GET | `/execution-runs/:runId/summary` | Requires `X-Store-Id` |
| GET | `/execution-runs/:runId/review-bundle` | Bundle incl. attempt history, MLCC context, evidence flags |
| GET | `/execution-runs/:runId/evidence` | Evidence list |
| GET | `/execution-runs/:runId/actions` | Operator actions |
| GET | `/execution-runs/:runId` | Full run |
| PATCH | `/execution-runs/:runId/heartbeat` | Worker heartbeat |
| PATCH | `/execution-runs/:runId/status` | Worker finalize |
| POST | `/execution-runs/:runId/actions` | Operator action (also duplicated under operator-review for session auth) |

## Operator review (`/operator-review`)

**Router:** `services/api/src/routes/operator-review.routes.js`

| Method | Path | Auth |
|--------|------|------|
| POST | `/operator-review/session` | Establish operator session (Supabase access token + store) |
| GET | `/operator-review/api/runs` | `requireOperatorSession` — same list semantics as review runs |
| GET | `/operator-review/api/runs/:runId/review-bundle` | Bundle |
| POST | `/operator-review/api/runs/:runId/actions` | Operator actions |
| GET | `/operator-review/api/diagnostics/overview` | **Diagnostics overview** — `getOperatorDiagnosticsOverview` (`operator-diagnostics.service.js`) |

Query params for diagnostics (as coded): `days`, `diag_limit`, `run_limit`.

## Diagnostics / MLCC intelligence

- **Service:** `services/api/src/services/operator-diagnostics.service.js`
- **Response includes** (when data available): execution window stats, trends, `attempt_history_insights`, `mlcc_diagnostics`, `queue_health`, etc. — see service implementation for exact keys.

## Admin app

- **Diagnostics UI:** `apps/admin/src/pages/DiagnosticsPage.tsx`
- **Operator overview:** `apps/admin/src/pages/OperatorOverviewPage.tsx`
- **MLCC review context types:** `apps/admin/src/operator-review/mlccOperatorContext.ts`

## Drift check

- `npm run verify:lk:contracts` validates that referenced implementation files exist.
