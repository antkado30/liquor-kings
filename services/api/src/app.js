import cartRouter from "./routes/cart.routes.js";
import cartSummaryRouter from "./routes/cart-summary.routes.js";
import cartLifecycleRouter from "./routes/cart-lifecycle.routes.js";
import executionRunsRouter from "./routes/execution-runs.routes.js";
import express from "express";
import cors from "cors";
import { Sentry } from "./lib/sentry.js";
import supabase from "./config/supabase.js";
import bottlesRouter from "./routes/bottles.routes.js";
import inventoryRouter from "./routes/inventory.routes.js";
import { resolveAuthenticatedStore } from "./middleware/resolve-store.middleware.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import operatorReviewRouter from "./routes/operator-review.routes.js";
import adminRouter from "./routes/admin.routes.js";
import priceBookRouter, { priceBookUpcFlagHandler, priceBookUpcHandler } from "./routes/price-book.routes.js";

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
app.use("/operator-review", operatorReviewRouter);
app.use("/price-book", priceBookRouter);

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

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Liquor Kings API running" });
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

app.get("/test-db", async (req, res) => {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .limit(1);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, data });
});

app.get("/test-bottles", async (req, res) => {
  const { data, error } = await supabase
    .from("bottles")
    .select("*")
    .limit(5);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, data });
});

Sentry.setupExpressErrorHandler(app);

export default app;
