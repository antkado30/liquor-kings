# Liquor Kings — internal operator review (admin app)

Minimal Vite + React surface for the operator review workflow. Uses the same backend routes as the legacy static page under `/operator-review/*` (session cookie, review list, bundle, actions).

## Development

1. Start the API (default `http://127.0.0.1:4000`).
2. From repo root or this folder:

```bash
cd apps/admin
npm install
npm run dev
```

3. Open `http://127.0.0.1:5173`. The dev server proxies `/operator-review` to the API so the session cookie stays same-origin.

Optional proxy target:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:4000 npm run dev
```

## Build

```bash
npm run build
```

Output: `dist/`. Serving `dist` in production must preserve same-origin access to `/operator-review` (or equivalent deployment) so cookies and credentials continue to work.

## Legacy

The static HTML console remains at **`GET /operator-review`** on the API until this app is verified in your environment.
