# Sentry error tracking setup

## Overview

Sentry captures **uncaught exceptions**, **unhandled promise rejections**, and **performance traces** from three surfaces:

- **API** (`services/api`) — Node/Express via `@sentry/node`, with request context and stack traces.
- **Scanner PWA** (`apps/scanner`) — React via `@sentry/react`, including **session replay** (sampled) and **browser tracing**.
- **Admin** (`apps/admin`) — same as scanner, tagged separately as `admin` in Sentry.

Each event is tagged with `service`: `api`, `scanner`, or `admin` so you can filter in the Sentry UI. **Release** and **environment** are set from env vars (or derived on the API from git when `SENTRY_RELEASE` is unset).

## Setup steps

1. Create projects (or one project with multiple platforms) in [Sentry](https://sentry.io/).
2. Copy each project’s **DSN** into the **real** env files (not committed):
   - API: `services/api/.env` — set `SENTRY_DSN`, and optionally `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`.
   - Scanner: `apps/scanner/.env` — set `VITE_SENTRY_DSN`, and optionally `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`.
   - Admin: `apps/admin/.env` — same variable names as scanner.
3. Run `npm install` in `services/api`, `apps/scanner`, and `apps/admin` so `@sentry/*` packages are present.
4. Start dev servers as usual. If DSN is missing, apps log `[sentry] ... not set, error tracking disabled` and run normally.
5. **Verify**: trigger a test error (e.g. temporary `throw new Error("sentry test")` in a route or component), confirm an issue appears in Sentry within a minute.

## Environment and release

| Surface | Variable | Purpose |
|--------|----------|---------|
| API | `SENTRY_ENVIRONMENT` | e.g. `development`, `staging`, `production` (falls back to `NODE_ENV` then `development`) |
| API | `SENTRY_RELEASE` | Version or git SHA shown in Sentry (falls back to `git rev-parse HEAD`, then `unknown`) |
| Scanner / Admin | `VITE_SENTRY_ENVIRONMENT` | Same idea (falls back to Vite `MODE`) |
| Scanner / Admin | `VITE_SENTRY_RELEASE` | Build label in Sentry (falls back to `unknown`) |

In CI/CD, set `SENTRY_RELEASE` / `VITE_SENTRY_RELEASE` to your git tag or commit SHA so regressions map to deploys.

## Viewing errors in Sentry

1. Open your organization in [sentry.io](https://sentry.io/).
2. Go to **Issues** — new errors appear with stack traces, `service` tag, environment, and release.
3. Go to **Performance** (or **Explore → Traces**) — a **10%** sample of transactions is recorded (`tracesSampleRate: 0.1`).
4. For scanner/admin, open **Replays** to inspect sessions (10% baseline, 100% when an error occurs).

## Privacy notes

- **Captured by default**: URL paths, query strings, headers Sentry’s SDK attaches, user agent, stack traces, breadcrumbs, and (for scanner/admin) replay DOM unless you tighten `replayIntegration` options.
- **Not automatically sent**: full request bodies for the API unless you explicitly add them via Sentry APIs; avoid logging secrets into breadcrumbs.
- The API `beforeSend` **drops** events for `/health` and for errors whose message contains `ECONNRESET` to reduce noise.

## Sample DSN format (fake values)

Do **not** commit real DSNs. They look like:

```text
https://abcdef1234567890@o123456.ingest.sentry.io/7654321
```

Vite variables must be prefixed with `VITE_` to be exposed to the browser — only put the **browser** DSN in `VITE_SENTRY_DSN` (project type: React), not server-only secrets.

## API note (SDK 8.x)

`@sentry/node` v8 uses **OpenTelemetry** under the hood. Express is auto-instrumented when `Sentry.init` runs **before** the Express app module loads (`services/api/src/index.js` uses a dynamic `import()` after `initSentry()`). The app calls `Sentry.setupExpressErrorHandler(app)` once at the end of the middleware stack — there is no separate `requestHandler` / `tracingHandler` in v8; request and trace context are handled by that pipeline.
