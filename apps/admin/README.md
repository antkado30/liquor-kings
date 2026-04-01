# Liquor Kings — internal operator review (admin app)

Minimal Vite + React surface for the operator review workflow. Uses the same backend routes as the legacy static page under `/operator-review/*` (session cookie, review list, bundle, actions).

Production URL on the API host: **`/operator-review/app/`** (or open **`/operator-review`**, which redirects to the SPA when the built app is present). See **`services/api/OPERATOR_REVIEW.md`** for serving, env vars, and deploy.

In-app routes (relative to that base): **`/review`** (queue), **`/review/:runId`** (detail), **`/diagnostics`** (placeholder).

## Development

1. Start the API (default `http://127.0.0.1:4000`).
2. From repo root or this folder:

```bash
cd apps/admin
npm install
npm run dev
```

3. Open **`http://127.0.0.1:5173/operator-review/app/`**. The dev server proxies `/operator-review` to the API so the session cookie stays same-origin.

Optional proxy target:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:4000 npm run dev
```

## Build

From repo root:

```bash
npm run build:admin
```

Or in this package: `npm run build`. Output: **`dist/`** with `base: /operator-review/app/` so assets load when the API serves the folder under that path.

## Production

The API serves `apps/admin/dist` at **`/operator-review/app`** after `build:admin` (or `OPERATOR_REVIEW_ADMIN_DIST`). No separate dev server or Vite proxy is required in production.
