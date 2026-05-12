# Liquor Kings production image.
#
# Two-stage build:
#   1) admin-builder: builds the admin SPA from apps/admin so the API can
#      serve it under /operator-review/app/* (see services/api/src/app.js).
#   2) production:    Playwright base image (Chromium + Node 22 + system deps
#      already installed) running services/api. RPA workers can spawn
#      Chromium in this container because the Playwright image includes the
#      sandbox bits and we pass --no-sandbox via the launch wrapper.
#
# Production CMD just starts the Express API. Workers run inside the API
# process by hitting /execution-runs endpoints — no separate worker container
# is needed today.
#
# Scanner SPA is NOT bundled here; it deploys separately (Vercel/Netlify) or
# is served from a developer machine pointed at this API. The admin SPA IS
# bundled because it's the operator cockpit.

# ─── Stage 1: build admin SPA ─────────────────────────────────────────────
FROM node:22-bookworm AS admin-builder

WORKDIR /build

# Copy the manifests and lockfiles first so Docker can cache the install
# layer across rebuilds when only source code changes.
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/scanner/package.json ./apps/scanner/package.json

# Root install brings in the workspace packages (admin + scanner).
RUN npm ci

# Now the source.
COPY apps/admin ./apps/admin
COPY apps/scanner ./apps/scanner

# Builds apps/admin/dist/ — index.html + assets/* — which the API serves
# at /operator-review/app/*.
RUN npm run build:admin


# ─── Stage 2: production runtime ──────────────────────────────────────────
# Playwright base image: Node 22 + Chromium + all system libs Playwright
# needs to spawn a browser. Tagged version must match whatever Playwright
# version actually gets installed by `npm ci` in services/api below — when
# the package.json caret (`^1.49.1`) resolves to a newer minor (e.g. 1.59.1),
# you'll see "browserType.launch: Executable doesn't exist" at runtime.
# Bump this tag in lockstep with services/api/package.json's playwright dep.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS production

ENV NODE_ENV=production
ENV PORT=8080
# Prevent npm from re-downloading browsers — the image already has them.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Install API dependencies first for cache.
COPY services/api/package.json services/api/package-lock.json ./services/api/
RUN cd services/api && npm ci --omit=dev

# API source.
COPY services/api/src ./services/api/src

# Admin SPA from stage 1.
COPY --from=admin-builder /build/apps/admin/dist ./apps/admin/dist

# Allow the API to find the admin dist via its default search path.
ENV OPERATOR_REVIEW_ADMIN_DIST=/app/apps/admin/dist

EXPOSE 8080

WORKDIR /app/services/api
CMD ["npm", "start"]
