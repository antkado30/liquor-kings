# Liquor Kings Auth Endpoint Audit

## Session Metadata

- Date/time: `Wed May 27 21:28:58 EDT 2026` from local `date`.
- Branch: `main`.
- Git status summary at audit start:

```text
 M apps/admin/src/App.tsx
 M apps/admin/src/index.css
 M apps/admin/src/shell/AppNavLayout.tsx
 M apps/admin/vite.config.ts
 M fly.toml
 M services/api/src/services/nrs-import.service.js
 M supabase/.temp/cli-latest
 M supabase/.temp/gotrue-version
 M supabase/.temp/pooler-url
 M supabase/.temp/postgres-version
 M supabase/.temp/project-ref
 M supabase/.temp/rest-version
 M supabase/.temp/storage-migration
 M supabase/.temp/storage-version
?? actions.jsonl
?? apps/admin/src/api/nrsReview.ts
?? apps/admin/src/pages/NrsReviewPage.tsx
?? docs/lk/briefs/
?? docs/lk/competitive-research.md
?? docs/lk/v1-spec.md
?? services/api/actions.jsonl
?? services/api/scripts/copy-mappings-to-prod.mjs
?? services/api/src/routes/nrs-review.routes.js
?? supabase/migrations/20260512175800_create_nrs_ambiguous_review_table.sql
?? supabase/migrations/Untitled
?? supabase/snippets/
```

This is a static code audit only. No DB, no live MILO/RPA, no env secrets, and no production systems were touched.

## Scope

Inspected API boot and mount wiring in `services/api/src/app.js` and `services/api/src/index.js`; all `services/api/src/routes/*.js` files; store/auth middleware in `services/api/src/middleware/`; and scanner auth/API usage in `apps/scanner/src/api/*.ts`, `apps/scanner/src/lib/supabase.ts`, `apps/scanner/src/components/AuthGate.tsx`, `apps/scanner/src/pages/ScannerPage.tsx`, plus scanner call sites in `CartDrawer`, `AssistantPanel`, `ProductCard`, `UpcCandidatePicker`, `useSubmission`, and `useCatalogSearch`.

Not inspected: runtime env values, deployed Supabase settings/RLS, production DB contents, built SPA dist contents, live MILO/RPA behavior, and browser behavior. No tests were run.

## Route Mount Summary

| Mount/prefix | Source file | Mount middleware | Classification | Notes |
|---|---|---|---|---|
| `GET /price-book/upc/:upc` | `services/api/src/app.js` -> `price-book.routes.js` handler | none | `public` | App-level direct registration before `/price-book` router. Duplicates router endpoint. |
| `POST /price-book/upc/:upc/flag` | `services/api/src/app.js` -> `price-book.routes.js` handler | none | `public` | App-level direct registration before `/price-book` router. Duplicates router endpoint. |
| `/admin` | `services/api/src/routes/admin.routes.js` | route-local `X-Admin-Token` check | `admin_token` | Token is enforced only when `LK_ADMIN_TOKEN` is set; routes are open when unset. |
| `/admin` | `services/api/src/routes/nrs-import.routes.js` | route-local `X-Admin-Token` check | `admin_token` | Same conditional admin-token convention. |
| `/admin` | `services/api/src/routes/nrs-review.routes.js` | route-local `X-Admin-Token` check | `admin_token` | Untracked file in working tree, but mounted by `app.js`; treated as active local code. |
| `/cart` | `cart.routes.js`, `cart-summary.routes.js`, `cart-lifecycle.routes.js` | `resolveAuthenticatedStore`; router `storeId` params use `enforceParamStoreMatches` | `auth_required` | Same prefix mounts three routers in order. `POST /cart/:storeId/validate` is defined in both `cart.routes.js` and `cart-lifecycle.routes.js`; first handler likely wins. |
| `/inventory` | `services/api/src/routes/inventory.routes.js` | `resolveAuthenticatedStore`; `storeId` param enforcement | `auth_required` | Store-scoped. |
| `/bottles` | `services/api/src/routes/bottles.routes.js` | `resolveAuthenticatedStore` | `auth_required` | Catalog-style routes are protected here, unlike `/price-book/items`. |
| `/execution-runs` | `services/api/src/routes/execution-runs.routes.js` | `resolveAuthenticatedStore`; some routes use `requireServiceRole` or `storeId` param enforcement | `auth_required` | `POST /claim-next` is additionally service-role-only. |
| `/stores` | `services/api/src/routes/store-mlcc-credentials.routes.js` | `resolveAuthenticatedStore`; `storeId` param enforcement | `auth_required` | `POST verify` would run live MILO credential verification if called; it was not called. |
| `/operator-review` | `services/api/src/routes/operator-review.routes.js` | route-local operator session cookie on protected routes | `unknown` | Mixed public session bootstrap/logout plus protected operator APIs. Uses custom in-memory cookie session, not `resolveAuthenticatedStore`. |
| `/price-book` | `services/api/src/routes/price-book.routes.js` | mixed: none, service-role bearer, or cron secret | `unknown` | Mixed public catalog/UPC endpoints, service-role maintenance endpoints, and `LK_CRON_SECRET` endpoint. |
| `/assistant` | `services/api/src/routes/assistant.routes.js` | none | `public` | Route comment says V1 trusts body `storeId`; per-store auth is deferred. |
| `/operator-review/app` | `services/api/src/app.js` | `express.static` plus GET/HEAD SPA fallback, or 503 fallback if dist missing | `static_asset` | Conditional on built admin SPA dist. |
| `/scanner` | `services/api/src/app.js` | `express.static` plus GET/HEAD SPA fallback, or 503 fallback if dist missing | `static_asset` | Conditional on built scanner SPA dist. |
| `GET /health` | `services/api/src/app.js` | none | `public` | Basic health response. |
| `GET /operator-review`, `GET /operator-review/` | `services/api/src/app.js` | none | `static_asset` | Redirects to admin SPA or serves legacy HTML depending on env/dist. |
| `GET /test-db` | `services/api/src/app.js` | none | `public` | Unauthenticated DB smoke route; reads one store row if called. Not called in this audit. |
| `GET /test-bottles` | `services/api/src/app.js` | none | `public` | Unauthenticated DB smoke route; reads five bottle rows if called. Not called in this audit. |

## Endpoint Inventory

| Method | Full path | Router file | Local router path | Middleware/auth gate | Classification | Expected 401/403 behavior | Notes |
|---|---|---|---|---|---|---|---|
| GET | `/price-book/upc/:upc` | `app.js` direct -> `price-book.routes.js` | app direct | none | `public` | No expected auth 401/403. | Same handler as router `GET /price-book/upc/:upc`; registered before router. |
| POST | `/price-book/upc/:upc/flag` | `app.js` direct -> `price-book.routes.js` | app direct | none | `public` | No expected auth 401/403. | Same handler as router `POST /price-book/upc/:upc/flag`; registered before router. |
| GET | `/health` | `app.js` | app direct | none | `public` | No expected auth 401/403. | Health check. |
| GET | `/operator-review` | `app.js` | app direct | none | `static_asset` | No expected auth 401/403. | Redirects to `/operator-review/app/` or serves legacy HTML. |
| GET | `/operator-review/` | `app.js` | app direct | none | `static_asset` | No expected auth 401/403. | Same root handler. |
| GET | `/test-db` | `app.js` | app direct | none | `public` | No expected auth 401/403. | Unauthenticated DB read smoke endpoint. |
| GET | `/test-bottles` | `app.js` | app direct | none | `public` | No expected auth 401/403. | Unauthenticated DB read smoke endpoint. |
| GET/HEAD | `/operator-review/app/*` | `app.js` static | static mount | none | `static_asset` | No expected auth 401/403. | Serves admin SPA when built; otherwise 503 text fallback for all methods under mount. |
| GET/HEAD | `/scanner/*` | `app.js` static | static mount | none | `static_asset` | No expected auth 401/403. | Serves scanner SPA when built; otherwise 503 text fallback for all methods under mount. |
| GET | `/admin/upc-mappings` | `admin.routes.js` | `/upc-mappings` | `assertAdminToken` with `X-Admin-Token` when env set | `admin_token` | 401 when `LK_ADMIN_TOKEN` is set and header mismatches; open if env unset. | Reads mapping counts and recent mappings. |
| GET | `/admin/upc-audit` | `admin.routes.js` | `/upc-audit` | `assertAdminToken` | `admin_token` | 401 when token is enforced and invalid. | Reads UPC audit rows. |
| GET | `/admin/upc-audit/suspicious` | `admin.routes.js` | `/upc-audit/suspicious` | `assertAdminToken` | `admin_token` | 401 when token is enforced and invalid. | Reads suspicious UPC audit rows. |
| GET | `/admin/telemetry` | `admin.routes.js` | `/telemetry` | `assertAdminToken` | `admin_token` | 401 when token is enforced and invalid. | Reads UPC telemetry. |
| POST | `/admin/nrs-import` | `nrs-import.routes.js` | `/nrs-import` | `assertAdminToken` with `X-Admin-Token` when env set | `admin_token` | 401 when `LK_ADMIN_TOKEN` is set and header mismatches; open if env unset. | Can write mappings unless request/body sets dry-run. |
| GET | `/admin/nrs-review/pending` | `nrs-review.routes.js` | `/nrs-review/pending` | `assertAdminToken` with `X-Admin-Token` when env set | `admin_token` | 401 when token is enforced and invalid. | Reads pending ambiguous NRS review rows. |
| POST | `/admin/nrs-review/:reviewId/resolve` | `nrs-review.routes.js` | `/nrs-review/:reviewId/resolve` | `assertAdminToken`; local JSON parser | `admin_token` | 401 when token is enforced and invalid. | Writes UPC mapping and marks review resolved. |
| POST | `/admin/nrs-review/:reviewId/skip` | `nrs-review.routes.js` | `/nrs-review/:reviewId/skip` | `assertAdminToken`; local JSON parser | `admin_token` | 401 when token is enforced and invalid. | Marks review skipped. |
| POST | `/cart/:storeId/validate` | `cart.routes.js` | `/:storeId/validate` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing `X-Store-Id`; 403 no membership or store mismatch. | Shared cart validation by item codes. |
| PATCH | `/cart/items/:itemId` | `cart.routes.js` | `/items/:itemId` | `resolveAuthenticatedStore`; `enforceCartItemStoreScope` | `auth_required` | 401 missing/invalid bearer; 403 if cart item store does not match `req.store_id`. | No `storeId` URL param; depends on authenticated/store header context. |
| DELETE | `/cart/items/:itemId` | `cart.routes.js` | `/items/:itemId` | `resolveAuthenticatedStore`; `enforceCartItemStoreScope` | `auth_required` | 401 missing/invalid bearer; 403 if cart item store does not match `req.store_id`. | No `storeId` URL param. |
| GET | `/cart/:storeId` | `cart.routes.js` | `/:storeId` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Returns active cart. |
| POST | `/cart/:storeId/items` | `cart.routes.js` | `/:storeId/items` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Scanner add-line path. |
| DELETE | `/cart/:storeId/items` | `cart.routes.js` | `/:storeId/items` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Clears active cart items. |
| GET | `/cart/:storeId/active-summary` | `cart-summary.routes.js` | `/:storeId/active-summary` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Active cart summary. |
| GET | `/cart/:storeId/active-availability` | `cart-summary.routes.js` | `/:storeId/active-availability` | same | `auth_required` | Same store auth failures. | Active cart availability. |
| GET | `/cart/:storeId/overview` | `cart-summary.routes.js` | `/:storeId/overview` | same | `auth_required` | Same store auth failures. | Active/latest submitted overview. |
| GET | `/cart/:storeId/latest-submitted-summary` | `cart-summary.routes.js` | `/:storeId/latest-submitted-summary` | same | `auth_required` | Same store auth failures. | Latest submitted summary. |
| GET | `/cart/:storeId/execution-payload/latest` | `cart-summary.routes.js` | `/:storeId/execution-payload/latest` | same | `auth_required` | Same store auth failures. | Latest execution payload. |
| GET | `/cart/:storeId/history/:cartId/availability` | `cart-summary.routes.js` | `/:storeId/history/:cartId/availability` | same | `auth_required` | Same store auth failures. | Submitted cart availability. |
| GET | `/cart/:storeId/history/:cartId/execution-payload` | `cart-summary.routes.js` | `/:storeId/history/:cartId/execution-payload` | same | `auth_required` | Same store auth failures. | Submitted cart execution payload. |
| GET | `/cart/:storeId/history/:cartId/mlcc-execution-readiness` | `cart-summary.routes.js` | `/:storeId/history/:cartId/mlcc-execution-readiness` | same | `auth_required` | Same store auth failures. | Read-only readiness. |
| GET | `/cart/:storeId/history/:cartId/summary` | `cart-summary.routes.js` | `/:storeId/history/:cartId/summary` | same | `auth_required` | Same store auth failures. | Submitted cart summary. |
| POST | `/cart/:storeId/submit` | `cart-lifecycle.routes.js` | `/:storeId/submit` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Marks active cart submitted. |
| GET | `/cart/:storeId/history` | `cart-lifecycle.routes.js` | `/:storeId/history` | same | `auth_required` | Same store auth failures. | Submitted cart history. |
| GET | `/cart/:storeId/mlcc-readiness-dashboard` | `cart-lifecycle.routes.js` | `/:storeId/mlcc-readiness-dashboard` | same | `auth_required` | Same store auth failures. | Operator/readiness feed. |
| GET | `/cart/:storeId/mlcc-mapping-backlog` | `cart-lifecycle.routes.js` | `/:storeId/mlcc-mapping-backlog` | same | `auth_required` | Same store auth failures. | Mapping backlog. |
| GET | `/cart/:storeId/mlcc-mapping-backlog/:bottleId` | `cart-lifecycle.routes.js` | `/:storeId/mlcc-mapping-backlog/:bottleId` | same | `auth_required` | Same store auth failures. | Backlog drill-down. |
| GET | `/cart/:storeId/mlcc-operator-overview` | `cart-lifecycle.routes.js` | `/:storeId/mlcc-operator-overview` | same | `auth_required` | Same store auth failures. | Combined MLCC operator overview. |
| GET | `/cart/:storeId/history/:cartId/mlcc-blocking-hints` | `cart-lifecycle.routes.js` | `/:storeId/history/:cartId/mlcc-blocking-hints` | same | `auth_required` | Same store auth failures. | Blocking hints. |
| GET | `/cart/:storeId/history/:cartId` | `cart-lifecycle.routes.js` | `/:storeId/history/:cartId` | same | `auth_required` | Same store auth failures. | Submitted cart detail. |
| POST | `/cart/:storeId/validate` | `cart-lifecycle.routes.js` | `/:storeId/validate` | same | `auth_required` | Same store auth failures. | Duplicate full path with `cart.routes.js`; likely shadowed by earlier router. |
| PATCH | `/cart/:storeId/history/:cartId/validation-result` | `cart-lifecycle.routes.js` | `/:storeId/history/:cartId/validation-result` | same | `auth_required` | Same store auth failures. | Records validation result. |
| POST | `/cart/:storeId/execute` | `cart-lifecycle.routes.js` | `/:storeId/execute` | same | `auth_required` | Same store auth failures. | Requests execution for submitted cart. |
| PATCH | `/cart/:storeId/history/:cartId/execution-result` | `cart-lifecycle.routes.js` | `/:storeId/history/:cartId/execution-result` | same | `auth_required` | Same store auth failures. | Records execution result. |
| GET | `/inventory/:storeId/summary` | `inventory.routes.js` | `/:storeId/summary` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Store inventory summary. |
| GET | `/inventory/:storeId/lookup` | `inventory.routes.js` | `/:storeId/lookup` | same | `auth_required` | Same store auth failures. | Store inventory lookup. |
| GET | `/inventory/:storeId/bottle/:bottleId` | `inventory.routes.js` | `/:storeId/bottle/:bottleId` | same | `auth_required` | Same store auth failures. | Inventory by bottle. |
| GET | `/inventory/:storeId/low-stock` | `inventory.routes.js` | `/:storeId/low-stock` | same | `auth_required` | Same store auth failures. | Low stock list. |
| GET | `/inventory/:storeId/out-of-stock` | `inventory.routes.js` | `/:storeId/out-of-stock` | same | `auth_required` | Same store auth failures. | Out-of-stock list. |
| GET | `/inventory/:storeId/reorder-candidates` | `inventory.routes.js` | `/:storeId/reorder-candidates` | same | `auth_required` | Same store auth failures. | Reorder candidates. |
| GET | `/inventory/:storeId/location/:location` | `inventory.routes.js` | `/:storeId/location/:location` | same | `auth_required` | Same store auth failures. | Inventory by location. |
| PATCH | `/inventory/:storeId/:inventoryId/quantity` | `inventory.routes.js` | `/:storeId/:inventoryId/quantity` | same | `auth_required` | Same store auth failures. | Quantity update. |
| PATCH | `/inventory/:storeId/:inventoryId/location` | `inventory.routes.js` | `/:storeId/:inventoryId/location` | same | `auth_required` | Same store auth failures. | Location update. |
| PATCH | `/inventory/:storeId/:inventoryId/reorder-settings` | `inventory.routes.js` | `/:storeId/:inventoryId/reorder-settings` | same | `auth_required` | Same store auth failures. | Reorder settings update. |
| GET | `/inventory/:storeId/:inventoryId` | `inventory.routes.js` | `/:storeId/:inventoryId` | same | `auth_required` | Same store auth failures. | Inventory item detail. |
| GET | `/inventory/:storeId` | `inventory.routes.js` | `/:storeId` | same | `auth_required` | Same store auth failures. | Store inventory list. |
| GET | `/bottles/search` | `bottles.routes.js` | `/search` | `resolveAuthenticatedStore` from mount | `auth_required` | 401 missing/invalid bearer; 403 no active store membership. | No route `storeId`; membership resolves context. |
| GET | `/bottles/search/compact` | `bottles.routes.js` | `/search/compact` | same | `auth_required` | Same auth failures. | Compact search. |
| GET | `/bottles/code/:mlccCode` | `bottles.routes.js` | `/code/:mlccCode` | same | `auth_required` | Same auth failures. | Bottle by MLCC code. |
| GET | `/bottles/upc/:upc` | `bottles.routes.js` | `/upc/:upc` | same | `auth_required` | Same auth failures. | Bottle by UPC. |
| GET | `/bottles/related/:id` | `bottles.routes.js` | `/related/:id` | same | `auth_required` | Same auth failures. | Related bottles. |
| GET | `/bottles/:id` | `bottles.routes.js` | `/:id` | same | `auth_required` | Same auth failures. | Bottle detail. |
| POST | `/execution-runs/claim-next` | `execution-runs.routes.js` | `/claim-next` | `resolveAuthenticatedStore`; `requireServiceRole` | `service_role_only` | 401 missing/invalid bearer at mount; 403 valid non-service-role bearer. | Worker claim endpoint; also reaps stale runs as failed. |
| POST | `/execution-runs/from-cart/:storeId/:cartId` | `execution-runs.routes.js` | `/from-cart/:storeId/:cartId` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Scanner trigger path; mode limited to `rpa_run`. |
| GET | `/execution-runs/cart/:storeId/:cartId` | `execution-runs.routes.js` | `/cart/:storeId/:cartId` | same | `auth_required` | Same store auth failures. | Runs for cart. |
| GET | `/execution-runs/cart/:storeId/:cartId/history` | `execution-runs.routes.js` | `/cart/:storeId/:cartId/history` | same | `auth_required` | Same store auth failures. | Run summaries for cart. |
| GET | `/execution-runs/review/:storeId/runs` | `execution-runs.routes.js` | `/review/:storeId/runs` | same | `auth_required` | Same store auth failures. | Operator review run feed via store auth. |
| GET | `/execution-runs/review/:storeId/pilot-runs` | `execution-runs.routes.js` | `/review/:storeId/pilot-runs` | same | `auth_required` | Same store auth failures. | Pilot runs feed. |
| GET | `/execution-runs/review/:storeId/pilot-overview` | `execution-runs.routes.js` | `/review/:storeId/pilot-overview` | same | `auth_required` | Same store auth failures. | Pilot overview. |
| GET | `/execution-runs/:runId/summary` | `execution-runs.routes.js` | `/:runId/summary` | `resolveAuthenticatedStore`; requires `req.store_id` | `auth_required` | 401 missing/invalid bearer; 400 service-role/multi-store missing `X-Store-Id`; 403 no membership. | Scanner polling path. |
| GET | `/execution-runs/:runId/lifecycle` | `execution-runs.routes.js` | `/:runId/lifecycle` | same | `auth_required` | Same auth failures. | Lifecycle detail. |
| GET | `/execution-runs/:runId/pilot-verification` | `execution-runs.routes.js` | `/:runId/pilot-verification` | same | `auth_required` | Same auth failures. | Pilot verification. |
| GET | `/execution-runs/:runId/pilot-verdict` | `execution-runs.routes.js` | `/:runId/pilot-verdict` | same | `auth_required` | Same auth failures. | Pilot verdict. |
| GET | `/execution-runs/:runId/pilot-review-packet` | `execution-runs.routes.js` | `/:runId/pilot-review-packet` | same | `auth_required` | Same auth failures. | Pilot review packet. |
| GET | `/execution-runs/:runId/review-bundle` | `execution-runs.routes.js` | `/:runId/review-bundle` | same | `auth_required` | Same auth failures. | Review bundle. |
| GET | `/execution-runs/:runId/evidence` | `execution-runs.routes.js` | `/:runId/evidence` | same | `auth_required` | Same auth failures. | Evidence. |
| GET | `/execution-runs/:runId/actions` | `execution-runs.routes.js` | `/:runId/actions` | same | `auth_required` | Same auth failures. | Operator actions. |
| GET | `/execution-runs/:runId` | `execution-runs.routes.js` | `/:runId` | same | `auth_required` | Same auth failures. | Run detail. |
| PATCH | `/execution-runs/:runId/heartbeat` | `execution-runs.routes.js` | `/:runId/heartbeat` | same | `auth_required` | Same auth failures. | Worker heartbeat if authorized into store context. |
| PATCH | `/execution-runs/:runId/status` | `execution-runs.routes.js` | `/:runId/status` | same | `auth_required` | Same auth failures. | Status update. Not additionally service-role-gated in this router. |
| POST | `/execution-runs/:runId/actions` | `execution-runs.routes.js` | `/:runId/actions` | same | `auth_required` | Same auth failures. | Applies operator action. |
| GET | `/stores/:storeId/mlcc-credentials/status` | `store-mlcc-credentials.routes.js` | `/:storeId/mlcc-credentials/status` | `resolveAuthenticatedStore`; `enforceParamStoreMatches` | `auth_required` | 401 missing/invalid bearer; 400 multi-store missing header; 403 membership/store mismatch. | Never returns password. |
| PUT | `/stores/:storeId/mlcc-credentials` | `store-mlcc-credentials.routes.js` | `/:storeId/mlcc-credentials` | same | `auth_required` | Same store auth failures. | Saves credentials. |
| POST | `/stores/:storeId/mlcc-credentials/verify` | `store-mlcc-credentials.routes.js` | `/:storeId/mlcc-credentials/verify` | same | `auth_required` | Same store auth failures. | Would run live MILO Stage 1 if called; not called. |
| DELETE | `/stores/:storeId/mlcc-credentials` | `store-mlcc-credentials.routes.js` | `/:storeId/mlcc-credentials` | same | `auth_required` | Same store auth failures. | Clears credentials. |
| POST | `/operator-review/session` | `operator-review.routes.js` | `/session` | Supabase `accessToken` in body plus active store membership check | `auth_required` | 401 invalid/expired token; 403 no active store membership or requested store mismatch. | Creates in-memory operator session cookie. |
| GET | `/operator-review/session` | `operator-review.routes.js` | `/session` | optional session cookie check | `public` | No auth 401; invalid/expired cookie returns 200 with `authenticated:false`. | Session status endpoint. |
| PATCH | `/operator-review/session/store` | `operator-review.routes.js` | `/session/store` | `requireOperatorSession` | `auth_required` | 401 missing/expired operator cookie; 403 requested store not in membership. | Switches operator session store. |
| DELETE | `/operator-review/session` | `operator-review.routes.js` | `/session` | optional cookie clear | `public` | No auth 401/403 expected. | Clears session cookie if present. |
| GET | `/operator-review/api/runs` | `operator-review.routes.js` | `/api/runs` | `requireOperatorSession` | `auth_required` | 401 missing/expired operator cookie; 403 if membership revoked. | Operator run feed. |
| GET | `/operator-review/api/runs/:runId/review-bundle` | `operator-review.routes.js` | `/api/runs/:runId/review-bundle` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Review bundle scoped to session store. |
| POST | `/operator-review/api/runs/:runId/actions` | `operator-review.routes.js` | `/api/runs/:runId/actions` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Operator action scoped to session store. |
| GET | `/operator-review/api/diagnostics/overview` | `operator-review.routes.js` | `/api/diagnostics/overview` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Diagnostics overview. |
| GET | `/operator-review/api/pilot-ops/stores` | `operator-review.routes.js` | `/api/pilot-ops/stores` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Pilot ops store list for operator memberships. |
| GET | `/operator-review/api/pilot-ops/notifications` | `operator-review.routes.js` | `/api/pilot-ops/notifications` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Pilot notifications. |
| GET | `/operator-review/api/pilot-ops/quality-summary` | `operator-review.routes.js` | `/api/pilot-ops/quality-summary` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Quality summary. |
| GET | `/operator-review/api/pilot-ops/stores-needing-follow-up` | `operator-review.routes.js` | `/api/pilot-ops/stores-needing-follow-up` | `requireOperatorSession` | `auth_required` | Same operator-session failures. | Follow-up list. |
| GET | `/operator-review/api/pilot-ops/stores/:storeId` | `operator-review.routes.js` | `/api/pilot-ops/stores/:storeId` | `requireOperatorSession` plus requested store membership check | `auth_required` | 401 missing/expired session; 403 not member of requested store. | Store detail. |
| PATCH | `/operator-review/api/pilot-ops/stores/:storeId/workflow-state` | `operator-review.routes.js` | `/api/pilot-ops/stores/:storeId/workflow-state` | `requireOperatorSession` plus requested store membership check | `auth_required` | 401 missing/expired session; 403 not member of requested store. | Workflow state update. |
| GET | `/price-book/status` | `price-book.routes.js` | `/status` | none | `public` | No expected auth 401/403. | Scanner price-book freshness banner uses this. |
| POST | `/price-book/ingest` | `price-book.routes.js` | `/ingest` | route-local service-role bearer equals `SUPABASE_SERVICE_ROLE_KEY` | `service_role_only` | 401 missing/bad bearer; 500 if service-role key missing. | Price book ingest. |
| POST | `/price-book/enrich-upcs` | `price-book.routes.js` | `/enrich-upcs` | route-local service-role bearer | `service_role_only` | 401 missing/bad bearer; 500 if service-role key missing. | UPC enrichment. |
| POST | `/price-book/check-updates` | `price-book.routes.js` | `/check-updates` | `LK_CRON_SECRET` via `X-Cron-Token` or `?token=` | `unknown` | 401 missing/bad cron secret; 500 if `LK_CRON_SECRET` unset. | Auth is clear, but classification taxonomy has no cron-secret bucket. |
| POST | `/price-book/upc/:upc/confirm` | `price-book.routes.js` | `/upc/:upc/confirm` | none | `public` | No expected auth 401/403. | Writes `upc_mappings` asynchronously. Scanner may send optional bearer, but server does not verify it. |
| POST | `/price-book/upc/:upc/flag` | `price-book.routes.js` | `/upc/:upc/flag` | none | `public` | No expected auth 401/403. | Flags/deletes UPC mapping. Duplicated by app-level route. |
| POST | `/price-book/upc/:upc/report-no-match` | `price-book.routes.js` | `/upc/:upc/report-no-match` | none | `public` | No expected auth 401/403. | Writes audit event for user-rejected candidates. |
| GET | `/price-book/upc/:upc` | `price-book.routes.js` | `/upc/:upc` | none | `public` | No expected auth 401/403. | UPC lookup may call external UPC sources and queue audit/log writes. Duplicated by app-level route. |
| GET | `/price-book/items/:code/family` | `price-book.routes.js` | `/items/:code/family` | none | `public` | No expected auth 401/403. | Product family lookup. |
| GET | `/price-book/items` | `price-book.routes.js` | `/items` | none | `public` | No expected auth 401/403. | Public MLCC catalog search/list. |
| POST | `/assistant/ask` | `assistant.routes.js` | `/ask` | none | `public` | No expected auth 401/403. | Route comment says body `storeId` is trusted; per-store auth hardening deferred. |

## Scanner Client Cross-Reference

| Scanner file | Function/client call | Endpoint | Auth bearer used? | Auth failure handler used? | Risk level | Notes |
|---|---|---|---|---|---|---|
| `apps/scanner/src/lib/supabase.ts` | `getAuthBearer` | helper only | Yes, returns Supabase access token. | N/A | `low` | Reads fresh session token for API clients. |
| `apps/scanner/src/lib/supabase.ts` | `handleAuthFailure` | helper only | N/A | Handles 401 only. | `medium` | Store auth middleware can return 403 for no membership/store mismatch; helper will not sign out on 403. |
| `apps/scanner/src/api/cart.ts` | `getAuthHeaders` | helper for `/cart` | Yes, `Authorization: Bearer <jwt>` and `X-Store-Id`. | N/A | `low` | Throws if no session or no `VITE_SCANNER_STORE_ID`. |
| `apps/scanner/src/api/cart.ts` | `addCartLine` | `POST /cart/:storeId/items` | Yes, via `getAuthHeaders`. | Yes, but 401 only. | `medium` | Correct bearer usage; 403 membership/store mismatch becomes ordinary API error, not forced login/reset. |
| `apps/scanner/src/api/cart.ts` | `getActiveCart` | `GET /cart/:storeId` | Yes. | Yes, but 401 only. | `medium` | Same 403 handling gap. |
| `apps/scanner/src/api/cart.ts` | `validateCart` | `POST /cart/:storeId/validate` | Yes. | Yes, but 401 only. | `medium` | Called by `CartDrawer`; 403 would show validation/API error rather than redirecting to login. |
| `apps/scanner/src/api/execution.ts` | `triggerRpaRunFromCart` | `POST /execution-runs/from-cart/:storeId/:cartId` | Yes, via local `getAuthHeaders`. | Yes, but 401 only. | `medium` | Correct bearer and store header; 403 is not treated as auth failure. |
| `apps/scanner/src/api/execution.ts` | `getRunSummary` | `GET /execution-runs/:runId/summary` | Yes. | Yes, but 401 only. | `medium` | Polling silently continues on failed summaries in `useSubmission`; 403 may look like a stuck run. |
| `apps/scanner/src/api/catalog.ts` | `searchProducts` | `GET /price-book/items` | No. | No. | `low` | Endpoint is public by server design. |
| `apps/scanner/src/api/catalog.ts` | `getProductByUpc` | `GET /price-book/upc/:upc` | No. | No. | `medium` | Public lookup can trigger audit/log writes and external lookup paths. |
| `apps/scanner/src/api/catalog.ts` | `confirmUpcMapping` | `POST /price-book/upc/:upc/confirm` | Optional `VITE_UPC_CONFIRM_TOKEN`, not Supabase auth. | No. | `high` | Server currently does not validate the optional bearer; public endpoint writes `upc_mappings`. |
| `apps/scanner/src/api/catalog.ts` | `getProductByCode` | `GET /price-book/items`; sometimes `GET /price-book/upc/:upc` | No. | No. | `medium` | Composite public lookup. |
| `apps/scanner/src/api/catalog.ts` | `flagIncorrectMatch` | `POST /price-book/upc/:upc/flag` | No. | No. | `high` | Public server endpoint can remove/flag UPC mapping. |
| `apps/scanner/src/api/catalog.ts` | `reportUpcNoMatch` | `POST /price-book/upc/:upc/report-no-match` | No. | No. | `medium` | Public server endpoint writes audit event. |
| `apps/scanner/src/api/catalog.ts` | `getProductFamily` | `GET /price-book/items/:code/family` | No. | No. | `low` | Public read endpoint. |
| `apps/scanner/src/api/catalog.ts` | `getPriceBookStatus` | `GET /price-book/status` | No. | No. | `low` | Public read endpoint. |
| `apps/scanner/src/api/assistant.ts` | `askAssistant` | `POST /assistant/ask` | No. | No. | `high` | Sends `storeId` from `VITE_SCANNER_STORE_ID`; server trusts body `storeId` and has no route auth. |
| `apps/scanner/src/components/AuthGate.tsx` | Supabase sign-in/session gate | Supabase Auth client, not LK API | Uses Supabase client session. | Auth state listener handles sign-out. | `low` | Correctly gates scanner UI when Supabase env is configured; shows misconfiguration screen if env missing. |
| `apps/scanner/src/components/CartDrawer.tsx` | `validateCart` and `useSubmission.start` | `/cart` and `/execution-runs` via API clients | Yes through API clients. | Yes, but 401 only. | `medium` | UI has confirmation before pipeline trigger; auth gap is 403 handling, not missing bearer. |
| `apps/scanner/src/hooks/useSubmission.ts` | `addCartLine`, `triggerRpaRunFromCart`, `getRunSummary` | `/cart/:storeId/items`, `/execution-runs/from-cart/:storeId/:cartId`, `/execution-runs/:runId/summary` | Yes through API clients. | Yes, but 401 only in API clients. | `medium` | Polling ignores failed summaries as transient; persistent 403 can hide auth/store-access failure. |
| `apps/scanner/src/components/AssistantPanel.tsx` | `askAssistant` | `POST /assistant/ask` | No. | No. | `high` | User-facing assistant inherits public/trusted-storeId backend posture. |
| `apps/scanner/src/components/ProductCard.tsx` | `flagIncorrectMatch` | `POST /price-book/upc/:upc/flag` | No. | No. | `high` | Public mutation path. |
| `apps/scanner/src/components/UpcCandidatePicker.tsx` | `confirmUpcMapping` | `POST /price-book/upc/:upc/confirm` | Optional non-enforced token only. | No. | `high` | Public mapping write path. |
| `apps/scanner/src/pages/ScannerPage.tsx` | scan/search/UPC flow | `/price-book/*` public endpoints | Mostly no; optional token only for confirm call. | No. | `medium` | Catalog reads likely intentional; mapping mutation endpoints are higher risk. |

## Findings

### Confirmed Safe / Handled

- `/cart`, `/inventory`, `/bottles`, `/execution-runs`, and `/stores` mounts use `resolveAuthenticatedStore`; missing bearer returns 401, invalid bearer returns 401, missing store membership returns 403, and `storeId` URL mismatches return 403.
- Scanner cart/execution clients attach a real Supabase JWT plus `X-Store-Id` and call `handleAuthFailure` for 401 responses.
- `POST /execution-runs/claim-next` is additionally `requireServiceRole`, returning 403 for valid non-service-role users after the store resolver runs.
- Price-book maintenance endpoints `/price-book/ingest` and `/price-book/enrich-upcs` require the Supabase service-role bearer.
- Admin and NRS admin routes consistently use the `X-Admin-Token` convention when `LK_ADMIN_TOKEN` is configured.
- Operator-review protected APIs consistently use `requireOperatorSession`; session bootstrap verifies a Supabase access token and active store membership before setting the cookie.
- Static scanner/admin SPA mounts are static assets/fallbacks only; no live browser automation was used.

### Needs Follow-Up

- `POST /assistant/ask` is public and trusts body `storeId`. The route comment explicitly calls this a V1 posture, but from auth audit perspective this is a high-risk data-scope gap for a scanner/operator-facing assistant.
- Scanner `askAssistant` sends no Supabase bearer and has no auth-failure path because the backend route has no auth gate.
- `POST /price-book/upc/:upc/confirm` is public and writes `upc_mappings`; scanner can optionally send `VITE_UPC_CONFIRM_TOKEN`, but the server endpoint does not verify that token.
- `POST /price-book/upc/:upc/flag` is public and can flag/delete UPC mapping state.
- `POST /price-book/upc/:upc/report-no-match` is public and writes audit data.
- Scanner `handleAuthFailure` handles 401 only. Store-auth routes can return 403 for revoked/missing membership or store mismatch, so scanner users may see ordinary errors or stuck polling instead of being signed out or shown a clear access problem.
- `GET /test-db` and `GET /test-bottles` are unauthenticated DB smoke endpoints. They were not called, but they are public in `app.js`.
- `POST /cart/:storeId/validate` is defined in both `cart.routes.js` and `cart-lifecycle.routes.js` under the same `/cart` mount. Static inspection suggests the earlier `cart.routes.js` handler likely wins; duplicate routing should be clarified later.
- `PATCH /execution-runs/:runId/status` and `PATCH /execution-runs/:runId/heartbeat` are store-authenticated but not `requireServiceRole` in the router. That may be intentional for current worker flow, but it is broader than `claim-next`.

### Unknown From Static Inspection

- Whether production has `LK_ADMIN_TOKEN` set; if unset, `/admin/*`, NRS import, and NRS review routes are open by code convention.
- Whether production has `LK_CRON_SECRET` set and who holds it.
- Whether runtime `OPERATOR_REVIEW_ADMIN_DIST` and `SCANNER_SPA_DIST` point to built dist folders.
- Whether deployed Supabase RLS/policies add constraints beyond Express route auth.
- Whether public price-book mutation endpoints are intentionally public for scanner UX or waiting on token/auth hardening.
- Whether assistant tools expose sensitive store data for arbitrary `storeId`; route code says store auth is deferred, but exact data exposure depends on `lib/assistant.js` tool behavior and runtime data.
- Whether any external admin UI calls include `X-Admin-Token`; scanner does not call `/admin/*`.

## Safety Confirmation

No application code was changed. No schema/migration files were changed. No env/deployment files were changed. No RPA/MILO commands were run. No live DB commands were run. No MLCC order-related action was attempted.

## Recommended Next Task

Add a small scanner-auth-hardening change so authenticated scanner API calls treat store-auth 403 responses as access/session failures with a clear sign-out or re-login path, with focused client tests for `cart.ts` and `execution.ts`. This is scanner-only, does not need live DB access, and does not touch RPA/MLCC submission code.
