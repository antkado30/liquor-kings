/**
 * Orders routes — surface MILO order confirmations to the scanner.
 * Task #41 (2026-06-02). Reads from public.milo_order_confirmations
 * which the Stage 5 worker writes after every successful submit.
 *
 * All routes are auth-gated by the existing resolveAuthenticatedStore
 * middleware mounted at /orders in app.js. The store_id used in the
 * query comes from the resolved-store middleware (NOT the URL or body)
 * so a user can never query another store's orders by accident or by
 * trying to.
 */

import express from "express";
import supabaseDefault from "../config/supabase.js";

const router = express.Router();

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

/**
 * GET /orders — list this store's MILO order confirmations, newest first.
 *
 * Query params:
 *   - limit:  1..50, default 25
 *   - cursor: ISO timestamp; only return orders placed before this (for paging)
 *   - ada_number: optional filter (e.g. "321" for NWS Michigan only)
 *
 * Response:
 *   { ok: true, orders: [...], nextCursor: string | null }
 */
router.get("/", async (req, res) => {
  const storeId = req.resolvedStore?.id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;

  const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIMIT, rawLimit)
      : DEFAULT_LIMIT;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const adaNumber =
    typeof req.query.ada_number === "string" && req.query.ada_number.trim()
      ? req.query.ada_number.trim()
      : null;

  /*
    Selection: most fields the UI needs at list-time. line_items is
    intentionally NOT selected here (could be big; the per-order detail
    endpoint pulls it). Keeping the list endpoint lean keeps the iOS
    scrollback snappy.
  */
  let q = supabase
    .from("milo_order_confirmations")
    .select(
      "id, store_id, execution_run_id, ada_number, ada_name, confirmation_number, order_number, placed_at, delivery_date, submitted_at, net_total, gross_total, line_item_count, distributor_raw, status_at_placement, created_at",
    )
    .eq("store_id", storeId)
    .order("placed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit + 1); // grab one extra to compute nextCursor

  if (cursor) {
    q = q.lt("placed_at", cursor);
  }
  if (adaNumber) {
    q = q.eq("ada_number", adaNumber);
  }

  const { data, error } = await q;
  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > limit;
  const orders = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && orders[orders.length - 1]?.placed_at
      ? orders[orders.length - 1].placed_at
      : null;

  return res.json({ ok: true, orders, nextCursor });
});

/**
 * GET /orders/:id — full detail for a single confirmation, including
 * line items. Scoped to the resolved store so you can't pull another
 * store's order via a guessed UUID.
 */
router.get("/:id", async (req, res) => {
  const storeId = req.resolvedStore?.id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    return res.status(400).json({ ok: false, error: "id required" });
  }
  const supabase = supabaseDefault;

  const { data, error } = await supabase
    .from("milo_order_confirmations")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  if (!data) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  return res.json({ ok: true, order: data });
});

/**
 * GET /orders/summary/recent — aggregate counts and spend for the last
 * 30 days. Used by the Orders page header for a quick "you've placed N
 * orders, $X in the last month" stat. Cheap because it's bounded.
 */
router.get("/summary/recent", async (req, res) => {
  const storeId = req.resolvedStore?.id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("milo_order_confirmations")
    .select("id, net_total, gross_total, placed_at, ada_number")
    .eq("store_id", storeId)
    .gte("placed_at", since);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  const rows = Array.isArray(data) ? data : [];
  const totalConfirmations = rows.length;
  const distinctOrders = new Set(
    rows
      .map((r) => `${r.placed_at?.slice(0, 10)}-${r.ada_number ?? ""}`)
      .filter((k) => k && !k.startsWith("undefined-")),
  ).size;
  const netSpend = rows.reduce(
    (sum, r) => sum + (Number(r.net_total) || 0),
    0,
  );
  const grossSpend = rows.reduce(
    (sum, r) => sum + (Number(r.gross_total) || 0),
    0,
  );
  return res.json({
    ok: true,
    sinceIso: since,
    totalConfirmations,
    distinctOrders,
    netSpend: Math.round(netSpend * 100) / 100,
    grossSpend: Math.round(grossSpend * 100) / 100,
  });
});

export default router;
