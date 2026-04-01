# Auth and store-scoping invariants (canonical)

## User-authenticated cart / inventory API

- **Middleware:** `resolveAuthenticatedStore` (`services/api/src/middleware/resolve-store.middleware.js`) on `/cart`, `/inventory`, `/bottles`, `/execution-runs`.
- **Invariant:** Requests carry store context consistent with the authenticated user’s store membership (as enforced by middleware + routes).

## Execution runs (JWT / user context)

- Routes under `/execution-runs` use `enforceParamStoreMatches` for `:storeId` path params and require `X-Store-Id` where implemented for run-specific reads/writes.
- **Service role:** `POST /execution-runs/claim-next` uses `requireServiceRole` — workers use `SUPABASE_SERVICE_ROLE_KEY` + `Authorization` bearer (see `execution-worker.js`).

## Operator review (separate session)

- **Router:** `services/api/src/routes/operator-review.routes.js`
- **Session:** HTTP-only cookie `lk_operator_session`; in-memory session map; TTL **12h**.
- **Invariant:** `requireOperatorSession` checks session + active `store_users` membership for `session.storeId`. Revoked membership → session invalidated (`operator_session_revoked`).
- **API:** `/operator-review/api/*` uses `req.operatorSession.storeId` — runs and diagnostics are **store-scoped** to that session.

## Security notes

- Operator session is **not** the same as Supabase JWT on `/cart`; do not mix without explicit design.
- Service role key must **never** ship to browsers; only workers/server.

## Drift

- Contract checks list critical route files in `scripts/lk-verify/verify-contracts.mjs`.
