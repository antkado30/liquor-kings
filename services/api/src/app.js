import cartRouter from "./routes/cart.routes.js";
import cartSummaryRouter from "./routes/cart-summary.routes.js";
import cartLifecycleRouter from "./routes/cart-lifecycle.routes.js";
import executionRunsRouter from "./routes/execution-runs.routes.js";
import express from "express";
import cors from "cors";
import { Sentry } from "./lib/sentry.js";
import bottlesRouter from "./routes/bottles.routes.js";
import inventoryRouter from "./routes/inventory.routes.js";
import { resolveAuthenticatedStore } from "./middleware/resolve-store.middleware.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import operatorReviewRouter from "./routes/operator-review.routes.js";
import adminRouter from "./routes/admin.routes.js";
import priceBookRouter, { priceBookUpcFlagHandler, priceBookUpcHandler } from "./routes/price-book.routes.js";
import storeMlccCredentialsRouter from "./routes/store-mlcc-credentials.routes.js";
import nrsImportRouter from "./routes/nrs-import.routes.js";
import nrsReviewRouter from "./routes/nrs-review.routes.js";
import assistantRouter from "./routes/assistant.routes.js";
import catalogVisionRouter from "./routes/catalog-vision.routes.js";
import catalogPhotoRouter from "./routes/catalog-photo.routes.js";
import ordersRouter from "./routes/orders.routes.js";
import tagsRouter from "./routes/tags.routes.js";
import homeRouter from "./routes/home.routes.js";
import browseRouter from "./routes/browse.routes.js";
import orderTemplatesRouter, { runSchedulerHandler as orderTemplatesRunSchedulerHandler } from "./routes/order-templates.routes.js";
import authRouter from "./routes/auth.routes.js";
import { landingPageHtml } from "./lib/landing-page.js";
import { termsPageHtml } from "./lib/terms-page.js";
import { privacyPageHtml } from "./lib/privacy-page.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const operatorReviewLegacyHtml = path.join(__dirname, "static", "operator-review.html");
const operatorAdminDistDefault = path.join(repoRoot, "apps", "admin", "dist");
const operatorAdminDist = process.env.OPERATOR_REVIEW_ADMIN_DIST
  ? path.resolve(process.env.OPERATOR_REVIEW_ADMIN_DIST)
  : operatorAdminDistDefault;
const operatorAdminIndexHtml = path.join(operatorAdminDist, "index.html");
const operatorAdminDistReady = fs.existsSync(operatorAdminIndexHtml);

// In-store scanner SPA (apps/scanner). Vite-built React app with a base of
// "/scanner/" (see apps/scanner/vite.config.ts). Authenticates via real
// Supabase Auth (no bundled service-role keys) — see auth migration in
// apps/scanner/src/api/*. Served same-origin so the JWT in localStorage and
// the API live on the same host (no CORS, no third-party cookies).
const scannerDistDefault = path.join(repoRoot, "apps", "scanner", "dist");
const scannerDist = process.env.SCANNER_SPA_DIST
  ? path.resolve(process.env.SCANNER_SPA_DIST)
  : scannerDistDefault;
const scannerIndexHtml = path.join(scannerDist, "index.html");
const scannerDistReady = fs.existsSync(scannerIndexHtml);

app.use(cors());
/** Large enough for MLCC browser worker finalize payloads (step screenshots + boundary evidence). */
app.use(express.json({ limit: "12mb" }));
/**
 * Sentry Node SDK v8: request and trace context for Express are set up when `initSentry()`
 * runs in `index.js` before this module is loaded. Legacy `Sentry.Handlers.requestHandler` /
 * `tracingHandler` are not used in v8; use `setupExpressErrorHandler` at the end of this file.
 */

/** App-level registration so GET /price-book/upc/:upc always resolves (not only via mounted router). */
app.get("/price-book/upc/:upc", priceBookUpcHandler);
app.post("/price-book/upc/:upc/flag", priceBookUpcFlagHandler);
/** Admin JSON: optional `LK_ADMIN_TOKEN` + `X-Admin-Token` — see `services/api/src/routes/admin.routes.js`. */
app.use("/admin", adminRouter);
/** Admin: NRS POS export bulk import (X-Admin-Token auth, raw CSV body). */
app.use("/admin", nrsImportRouter);
/** Admin: operator review queue for Tier 2 ambiguous NRS matches. */
app.use("/admin", nrsReviewRouter);

app.use(
  "/cart",
  resolveAuthenticatedStore,
  cartRouter,
  cartSummaryRouter,
  cartLifecycleRouter,
);
app.use("/inventory", resolveAuthenticatedStore, inventoryRouter);
app.use("/bottles", resolveAuthenticatedStore, bottlesRouter);
app.use("/execution-runs", resolveAuthenticatedStore, executionRunsRouter);
app.use("/stores", resolveAuthenticatedStore, storeMlccCredentialsRouter);
app.use("/operator-review", operatorReviewRouter);
app.use("/price-book", priceBookRouter);
/** AI Assistant: POST /assistant/ask — Claude tool-use over store data. */
app.use("/assistant", assistantRouter);
/**
 * Catalog vision: POST /catalog/identify-from-image — fallback when
 * the in-store scanner can't read a barcode (task #37, 2026-06-01).
 * Behind the existing store-auth middleware because each call costs us
 * money via the Anthropic API.
 */
app.use("/catalog", resolveAuthenticatedStore, catalogVisionRouter);
/**
 * Catalog photo truth layer: POST /catalog/items/:code/photo (in-store
 * capture = highest-precedence image) + /photo-report ("wrong photo?" —
 * clears a lying image immediately). 2026-06-10.
 */
app.use("/catalog", resolveAuthenticatedStore, catalogPhotoRouter);
/**
 * Orders: GET /orders, GET /orders/:id, GET /orders/summary/recent
 * MILO order confirmations persisted by the Stage 5 worker.
 * Task #41 (2026-06-02) — replaces the buried-in-evidence model with
 * a queryable table.
 */
app.use("/orders", resolveAuthenticatedStore, ordersRouter);
/**
 * Shelf tags: POST /tags/render, GET /tags/render?code=N — render
 * printable HTML shelf tags for one or more MLCC products. Pillar 3
 * of V1 (task #22, 2026-06-02). Auth-gated; barcode generation is
 * server-side via bwip-js (real Code 128).
 */
app.use("/tags", resolveAuthenticatedStore, tagsRouter);
/**
 * Scanner home smart cards: GET /home/smart-cards — surfaces price
 * changes, reorder suggestions, and price-book staleness as
 * actionable cards on the scanner's main screen. Task #63 (2026-06-02).
 */
app.use("/home", resolveAuthenticatedStore, homeRouter);
/**
 * Browse: GET /catalog/browse, GET /catalog/browse/facets
 * Amazon-style filtering + sorting over mlcc_items (task #64,
 * 2026-06-03). Mounted under /catalog alongside the vision endpoint.
 */
app.use("/catalog", resolveAuthenticatedStore, browseRouter);
/**
 * App-level registration for the order-templates cron endpoint so it
 * bypasses resolveAuthenticatedStore — cron-job.org sends X-Cron-Token,
 * not Authorization: Bearer. Mirrors the same pattern used for
 * /price-book/upc/:upc above. Must be registered BEFORE the
 * /order-templates router mount so Express matches it first.
 */
app.post("/order-templates/run-scheduler", orderTemplatesRunSchedulerHandler);
app.use("/order-templates", resolveAuthenticatedStore, orderTemplatesRouter);

/*
 * Public auth routes (task #78). NOT behind resolveAuthenticatedStore
 * because new sign-ups don't have a session bearer yet — they're
 * literally creating one. The signup handler does its own validation
 * + rate-limit logic.
 */
app.use("/auth", authRouter);

/**
 * Operator admin SPA (built apps/admin). Same origin as session + API under /operator-review/*.
 * - Shell: GET /operator-review/app/ (assets under /operator-review/app/assets/*)
 * - Session + JSON API: unchanged on /operator-review/session, /operator-review/api/*
 *
 * OPERATOR_REVIEW_ADMIN_DIST — absolute path to dist (default: <repo>/apps/admin/dist)
 * OPERATOR_REVIEW_SERVE_LEGACY_HTML=true — serve static operator-review.html at GET /operator-review
 *   instead of redirecting to the SPA (rollback / verification).
 */
if (operatorAdminDistReady) {
  console.log(`[operator-review] Serving admin SPA from ${operatorAdminDist}`);
  app.use("/operator-review/app", express.static(operatorAdminDist));
  app.use("/operator-review/app", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(operatorAdminIndexHtml);
  });
} else {
  console.warn(
    `[operator-review] Admin SPA dist missing (${operatorAdminDist}). ` +
      "GET /operator-review will serve legacy HTML until you run: npm run build:admin",
  );
  app.use("/operator-review/app", (req, res) => {
    res.status(503).type("text/plain").send(
      "Operator admin SPA is not built. From repo root run: npm run build:admin " +
        "(or set OPERATOR_REVIEW_ADMIN_DIST to a built dist directory).",
    );
  });
}

const serveOperatorReviewLegacyHtml = (req, res) => {
  res.sendFile(operatorReviewLegacyHtml);
};

/**
 * In-store scanner SPA, served at /scanner/* same-origin with the API.
 * - Shell + assets: GET /scanner/* (Vite emits everything under /scanner/ base)
 * - SPA fallback: any unmatched GET /scanner/<anything> returns index.html
 *   so client-side react-router routes resolve correctly on hard reload.
 *
 * Auth: all /cart, /execution-runs, /catalog requests go through
 * resolveAuthenticatedStore middleware unchanged — the scanner sends a real
 * Supabase JWT in the Authorization header, no service-role keys in the bundle.
 *
 * SCANNER_SPA_DIST — absolute path to dist (default: <repo>/apps/scanner/dist).
 */
if (scannerDistReady) {
  console.log(`[scanner] Serving scanner SPA from ${scannerDist}`);
  /*
    Two-tier cache headers (fix for the iOS PWA blank-screen bug,
    2026-06-02 evening). The problem: Vite emits content-hashed
    asset filenames (index-ABCD.js) referenced by index.html. iOS
    home-screen PWAs cache index.html aggressively. After a new
    deploy, the cached index.html points to OLD asset URLs that no
    longer exist in dist → blank screen until Tony deletes + re-adds
    the home-screen icon.

    Fix:
      - index.html → Cache-Control: no-store. Always pulls fresh.
        Tiny file (~500 bytes), revalidation cost is negligible.
      - /assets/* → Cache-Control: public, max-age=31536000, immutable.
        Filenames are content-hashed, so the same URL always means
        the same bytes — safe to cache forever.

    The express.static middleware is wrapped so it sets the long
    cache header on everything; the index.html sender (below) sets
    its own no-store header that overrides for that one file.
  */
  app.use(
    "/scanner",
    express.static(scannerDist, {
      // Default for all files under /scanner/ (mostly /assets/*) —
      // content-hashed filenames make eternal caching safe.
      maxAge: "1y",
      immutable: true,
      // index.html itself is served by the fallback handler below
      // so we can give it different cache headers.
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store, max-age=0");
        }
      },
    }),
  );
  app.use("/scanner", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.sendFile(scannerIndexHtml);
  });
} else {
  console.warn(
    `[scanner] Scanner SPA dist missing (${scannerDist}). ` +
      "GET /scanner/* will 503 until you run: npm run build:scanner",
  );
  app.use("/scanner", (req, res) => {
    res.status(503).type("text/plain").send(
      "Scanner SPA is not built. From repo root run: npm run build:scanner " +
        "(or set SCANNER_SPA_DIST to a built dist directory).",
    );
  });
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Liquor Kings API running" });
});

/*
 * Public marketing landing page (task #79, 2026-06-06). Static HTML
 * served from a module so apex `liquor-kings.fly.dev` shows the
 * product pitch instead of dropping straight into a login screen.
 *
 * GET / → landing
 * GET /signup → redirect to scanner with signup tab focused
 */
app.get("/", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.send(landingPageHtml());
});
app.get("/signup", (req, res) => {
  res.redirect(302, "/scanner#signup");
});

/*
 * Static legal pages (task #87, 2026-06-06). Served at /terms and
 * /privacy by Express directly — no React, no auth, no DB. The
 * footer of the landing page and (eventually) every signed-in screen
 * link here. Cache 5 minutes so we can roll updates without a long
 * stale window.
 */
app.get(["/terms", "/terms/"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.send(termsPageHtml());
});
app.get(["/privacy", "/privacy/"], (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.send(privacyPageHtml());
});

app.get(["/operator-review", "/operator-review/"], (req, res) => {
  if (process.env.OPERATOR_REVIEW_SERVE_LEGACY_HTML === "true") {
    return serveOperatorReviewLegacyHtml(req, res);
  }
  if (!operatorAdminDistReady) {
    return serveOperatorReviewLegacyHtml(req, res);
  }
  return res.redirect(302, "/operator-review/app/");
});

Sentry.setupExpressErrorHandler(app);

export default app;
