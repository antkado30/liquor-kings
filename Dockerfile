# Liquor Kings — API + web image (2026-06-08, slim after the worker split).
#
# This is the LIGHT half: the Express API + the two SPAs (admin Command Deck at
# /operator-review/app/*, in-store scanner at /scanner/*). It does NOT run the
# RPA worker and NEVER launches Chromium — verified: index.js → app.js → routes
# import zero Playwright/worker code. So it runs on a slim Node base instead of
# the ~1.5GB Playwright image, which is what makes deploys fast.
#
# The heavy RPA worker now lives in its own app (liquor-kings-worker, built from
# Dockerfile.worker). See docs/lk/runbooks/WORKER-SPLIT.md.

# ─── Stage 1: build admin + scanner SPAs ──────────────────────────────────
FROM node:22-bookworm AS web-builder

# AUDIT #29 (P1, 2026-06-13): Sentry DSNs for the two SPAs are baked in by
# Vite at BUILD time (import.meta.env.VITE_SENTRY_DSN) — `fly secrets set
# VITE_SENTRY_DSN=...` is a RUNTIME env var on the deployed machine and never
# reaches this build stage, so the old docs' instructions silently did
# nothing. Sentry DSNs are public-by-design (meant to ship in client
# bundles), so they're passed as Docker build args via fly.toml [build.args]
# rather than secrets. Each SPA has its own Sentry project, hence two ARGs.
ARG VITE_SENTRY_DSN_ADMIN=""
ARG VITE_SENTRY_DSN_SCANNER=""

WORKDIR /build

# Manifests + lockfiles first so the install layer caches across source-only
# rebuilds.
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/scanner/package.json ./apps/scanner/package.json

RUN npm ci

COPY apps/admin ./apps/admin
COPY apps/scanner ./apps/scanner

RUN VITE_SENTRY_DSN="$VITE_SENTRY_DSN_ADMIN" npm run build:admin
RUN VITE_SENTRY_DSN="$VITE_SENTRY_DSN_SCANNER" npm run build:scanner


# ─── Stage 2: slim production runtime (NO Chromium) ───────────────────────
FROM node:22-bookworm-slim AS production

ENV NODE_ENV=production
ENV PORT=8080
# The API never launches a browser; skip Playwright's browser download so the
# (still-present) playwright npm dep installs as pure JS on the slim base.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# API deps first for cache. All deps are pure-JS / prebuilt (no native compile),
# so npm ci succeeds on the slim base without build tools.
COPY services/api/package.json services/api/package-lock.json ./services/api/
RUN cd services/api && npm ci --omit=dev

# API source.
COPY services/api/src ./services/api/src
COPY services/api/scripts ./services/api/scripts

# Admin SPA (served at /operator-review/app/*).
COPY --from=web-builder /build/apps/admin/dist ./apps/admin/dist
ENV OPERATOR_REVIEW_ADMIN_DIST=/app/apps/admin/dist

# Scanner SPA (served at /scanner/*).
COPY --from=web-builder /build/apps/scanner/dist ./apps/scanner/dist
ENV SCANNER_SPA_DIST=/app/apps/scanner/dist

EXPOSE 8080

WORKDIR /app/services/api
CMD ["npm", "start"]
