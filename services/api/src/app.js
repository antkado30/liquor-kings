import cartRouter from "./routes/cart.routes.js";
import cartSummaryRouter from "./routes/cart-summary.routes.js";
import cartLifecycleRouter from "./routes/cart-lifecycle.routes.js";
import executionRunsRouter from "./routes/execution-runs.routes.js";
import express from "express";
import cors from "cors";
import supabase from "./config/supabase.js";
import bottlesRouter from "./routes/bottles.routes.js";
import inventoryRouter from "./routes/inventory.routes.js";
import { resolveAuthenticatedStore } from "./middleware/resolve-store.middleware.js";
import path from "path";
import { fileURLToPath } from "url";
import operatorReviewRouter from "./routes/operator-review.routes.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

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

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Liquor Kings API running" });
});

app.get("/operator-review", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "operator-review.html"));
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

export default app;
