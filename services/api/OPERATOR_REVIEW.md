# Operator review console (serving)

The maintainable UI lives in `apps/admin` and is served by this API on the **same origin** as the operator session and JSON routes.

## Route layout

| Path | Purpose |
|------|---------|
| `GET /operator-review` | Redirects (302) to `/operator-review/app/` when the built SPA exists; otherwise serves legacy `operator-review.html`. |
| `GET /operator-review/app/` | SPA shell (`index.html`). |
| `GET /operator-review/app/assets/*` | Hashed static assets from Vite. |
| `GET/POST/PATCH/DELETE /operator-review/session` | Session (unchanged). |
| `PATCH /operator-review/session/store` | Store switch (unchanged). |
| `GET/POST /operator-review/api/...` | Operator queue, bundle, actions (unchanged). |
| `GET /operator-review/api/diagnostics/overview` | Operator session required. Store-scoped execution aggregates + recent `lk_system_diagnostics` (this store + `store_id` null) + **`trends`** (24h hourly / 7d & 30d daily UTC series: runs, failures, retryable vs non-retryable fails, manual-review action counts). Optional query: `days`, `diag_limit`, `run_limit`. |

There is no path collision: the SPA is under `/operator-review/app`, APIs under `/operator-review/session` and `/operator-review/api`.

## Environment variables

| Variable | Effect |
|----------|--------|
| `OPERATOR_REVIEW_ADMIN_DIST` | Absolute path to a built `dist` directory. Default: `<repo root>/apps/admin/dist`. |
| `OPERATOR_REVIEW_SERVE_LEGACY_HTML=true` | `GET /operator-review` serves the static HTML console instead of redirecting to the SPA. |

## Local development

1. **API:** `cd services/api && npm run dev` (or your usual port).
2. **Admin (Vite):** from repo root, `npm run dev:admin`.
3. Open **`http://127.0.0.1:5173/operator-review/app/`** (Vite `base` matches production). The dev server proxies `/operator-review` to the API so cookies stay same-origin.

## Production build and deploy

1. From repo root: **`npm run build:admin`** (outputs `apps/admin/dist`).
2. Start the API with the repo layout intact **or** set `OPERATOR_REVIEW_ADMIN_DIST` to the copied `dist` path in your image/host.
3. Operators open **`https://<api-host>/operator-review`** (redirect) or **`/operator-review/app/`** directly.

If `dist` is missing at startup, `GET /operator-review` still serves the legacy HTML; `GET /operator-review/app/*` returns **503** with a short message until a build is deployed.
