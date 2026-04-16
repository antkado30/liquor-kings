import express from "express";
import supabase from "../config/supabase.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import {
  getCartItemsDetailed,
  getSubmittedCartById,
} from "../services/cart.service.js";
import { serializeMlccExecutionReadiness } from "../mlcc/mlcc-execution-readiness-serialize.js";
import { evaluateMlccExecutionReadinessForSubmittedCart } from "../services/cart-execution-payload.service.js";
import {
  fetchMlccBlockingHintsPayload,
  getBlockingHintsForSubmittedCart,
} from "../mlcc/mlcc-blocking-hints.service.js";
import {
  aggregateMlccMappingBacklog,
  buildBottleBacklogDetailFromHints,
  buildBacklogSummaryFromItems,
} from "../mlcc/mlcc-mapping-backlog.service.js";
import { loadMlccOperatorOverview } from "../mlcc/mlcc-operator-overview.service.js";
import {
  buildMlccDashboardCounts,
  DASHBOARD_CANDIDATE_FETCH_LIMIT,
  filterMlccDashboardCarts,
  loadSubmittedCartsWithMlccRows,
  mapRowToMlccReadinessDashboardCart,
  parseMlccDashboardQueryParams,
  sortMlccDashboardCartsForTriage,
} from "../services/cart-submitted-mlcc-feed.service.js";
import { isUuid } from "../utils/validation.js";
import {
  recordExecutionResult,
  recordValidationResult,
  requestExecution,
  requestValidation,
} from "../services/cart-state.service.js";

const router = express.Router();

router.param("storeId", enforceParamStoreMatches);

async function loadHintsWithMetaForSubmittedCarts(supabaseClient, storeId, rows) {
  const hintsWithMeta = [];
  for (const row of rows) {
    const cartId = String(row.id);
    const seen_at = row.updated_at ?? row.created_at ?? "";
    const { hints } = await getBlockingHintsForSubmittedCart(
      supabaseClient,
      storeId,
      cartId,
    );
    for (const h of hints) {
      hintsWithMeta.push({
        ...h,
        cart_id: cartId,
        seen_at: seen_at != null ? String(seen_at) : "",
      });
    }
  }
  return hintsWithMeta;
}

router.post("/:storeId/submit", async (req, res) => {
    const { storeId } = req.params;

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Active cart not found" });
    }

    const { data: cartItems, error: itemsError } = await supabase
      .from("cart_items")
      .select("id")
      .eq("cart_id", cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const itemCount = (cartItems ?? []).length;

    if (itemCount === 0) {
      return res.status(400).json({ error: "Cannot submit an empty cart" });
    }

    const { data: updatedCart, error: updateError } = await supabase
      .from("carts")
      .update({
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cart.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      success: true,
      cart: updatedCart,
      itemCount,
    });
  });

router.get("/:storeId/history", async (req, res) => {
    const { storeId } = req.params;

    const { ok, error, rows } = await loadSubmittedCartsWithMlccRows(
      supabase,
      storeId,
    );

    if (!ok) {
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      history: rows,
    });
  });

/** Read-only operator feed: submitted carts + MLCC summary + first blocking lines preview. */
router.get("/:storeId/mlcc-readiness-dashboard", async (req, res) => {
  const { storeId } = req.params;
  const q = parseMlccDashboardQueryParams(req.query);

  const { ok, error, rows } = await loadSubmittedCartsWithMlccRows(
    supabase,
    storeId,
    { limit: DASHBOARD_CANDIDATE_FETCH_LIMIT },
  );

  if (!ok) {
    return res.status(500).json({
      ok: false,
      store_id: storeId,
      carts: [],
      error,
    });
  }

  const mappedAll = rows.map((row) => mapRowToMlccReadinessDashboardCart(row));
  // Counts reflect every cart loaded and evaluated above (up to DASHBOARD_CANDIDATE_FETCH_LIMIT),
  // not the filtered or length-capped `carts` array.
  const counts = buildMlccDashboardCounts(mappedAll);

  const filtered = filterMlccDashboardCarts(mappedAll, {
    blockedOnly: q.blockedOnly,
    statusCode: q.statusCode,
  });
  const sorted = sortMlccDashboardCartsForTriage(filtered);
  const carts = sorted.slice(0, q.limit);

  res.json({
    ok: true,
    store_id: storeId,
    filters: {
      blocked_only: q.blockedOnly,
      status_code: q.statusCode,
      limit: q.limit,
    },
    counts,
    carts,
  });
});

/** Read-only: bottle-centric MLCC mapping backlog from recent submitted carts + blocking hints. */
router.get("/:storeId/mlcc-mapping-backlog", async (req, res) => {
  const { storeId } = req.params;
  let itemLimit = parseInt(String(req.query?.limit ?? ""), 10);
  if (!Number.isFinite(itemLimit) || itemLimit < 1) {
    itemLimit = 50;
  }
  itemLimit = Math.min(100, itemLimit);

  const { ok, error, rows } = await loadSubmittedCartsWithMlccRows(supabase, storeId, {
    limit: DASHBOARD_CANDIDATE_FETCH_LIMIT,
  });

  if (!ok) {
    const emptySummary = buildBacklogSummaryFromItems([], 0);
    return res.status(500).json({
      ok: false,
      store_id: storeId,
      counts: {
        scanned_carts: 0,
        backlog_bottles: 0,
        total_blocking_hints: 0,
      },
      backlog_summary: emptySummary,
      items: [],
      error,
    });
  }

  const hintsWithMeta = await loadHintsWithMetaForSubmittedCarts(
    supabase,
    storeId,
    rows,
  );

  const { counts, items: backlogItems } = aggregateMlccMappingBacklog(hintsWithMeta, {
    scanned_carts: rows.length,
  });

  const backlog_summary = buildBacklogSummaryFromItems(
    backlogItems,
    counts.total_blocking_hints,
  );

  res.json({
    ok: true,
    store_id: storeId,
    counts,
    backlog_summary,
    items: backlogItems.slice(0, itemLimit),
  });
});

/** Read-only: drill-down backlog detail for one bottle across recent submitted carts. */
router.get("/:storeId/mlcc-mapping-backlog/:bottleId", async (req, res) => {
  const { storeId, bottleId } = req.params;
  if (!isUuid(bottleId)) {
    return res.status(404).json({
      ok: false,
      store_id: storeId,
      bottle_id: bottleId,
      error: "Bottle backlog item not found",
    });
  }

  const { ok, error, rows } = await loadSubmittedCartsWithMlccRows(
    supabase,
    storeId,
    { limit: DASHBOARD_CANDIDATE_FETCH_LIMIT },
  );
  if (!ok) {
    return res.status(500).json({
      ok: false,
      store_id: storeId,
      bottle_id: bottleId,
      error,
    });
  }

  let cartLimit = parseInt(String(req.query?.cart_limit ?? ""), 10);
  if (!Number.isFinite(cartLimit) || cartLimit < 1) {
    cartLimit = 20;
  }
  cartLimit = Math.min(100, cartLimit);

  const hintsWithMeta = await loadHintsWithMetaForSubmittedCarts(
    supabase,
    storeId,
    rows,
  );
  const detail = buildBottleBacklogDetailFromHints(hintsWithMeta, bottleId, {
    cartLimit,
  });

  if (!detail) {
    return res.status(404).json({
      ok: false,
      store_id: storeId,
      bottle_id: bottleId,
      error: "Bottle backlog item not found",
    });
  }

  return res.json({
    ok: true,
    store_id: storeId,
    bottle_id: bottleId,
    detail,
  });
});

/** Read-only: single payload combining dashboard counts + backlog summary + top blocked carts/bottles. */
router.get("/:storeId/mlcc-operator-overview", async (req, res) => {
  const { storeId } = req.params;
  const result = await loadMlccOperatorOverview(supabase, storeId, req.query);

  if (!result.ok) {
    const emptySummary = buildBacklogSummaryFromItems([], 0);
    return res.status(500).json({
      ok: false,
      store_id: storeId,
      generated_at: new Date().toISOString(),
      error: result.error,
      limits: { cart_limit: 5, backlog_limit: 5 },
      readiness_dashboard: {
        counts: {
          total_carts: 0,
          blocked_carts: 0,
          ready_carts: 0,
          by_status_code: {},
        },
        filters: {
          blocked_only: false,
          status_code: null,
          description:
            "Counts are over the same evaluated cart set as GET mlcc-readiness-dashboard (no blocked_only/status_code filter).",
        },
        load_scope: { max_carts_evaluated: DASHBOARD_CANDIDATE_FETCH_LIMIT },
      },
      backlog_summary: emptySummary,
      top_blocked_carts: [],
      top_backlog_bottles: [],
    });
  }

  res.json(result.body);
});

router.get("/:storeId/history/:cartId/mlcc-blocking-hints", async (req, res) => {
  const { storeId, cartId } = req.params;

  if (!isUuid(cartId)) {
    return res.status(404).json({
      ok: false,
      blocked: true,
      error: "cart_not_found",
    });
  }

  try {
    const { statusCode, body } = await fetchMlccBlockingHintsPayload(
      supabase,
      storeId,
      cartId,
    );
    return res.status(statusCode).json(body);
  } catch {
    return res.status(404).json({
      ok: false,
      blocked: true,
      error: "cart_not_found",
    });
  }
});

router.get("/:storeId/history/:cartId", async (req, res) => {
    const { storeId, cartId } = req.params;

    if (!isUuid(cartId)) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: submittedCart, error: cartError } = await getSubmittedCartById(
      supabase,
      storeId,
      cartId,
    );

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!submittedCart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: items, error: itemsError } = await getCartItemsDetailed(
      supabase,
      submittedCart.id,
    );

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const readinessEval = await evaluateMlccExecutionReadinessForSubmittedCart(
      supabase,
      storeId,
      cartId,
    );
    const mlcc_execution_readiness = serializeMlccExecutionReadiness(readinessEval);

    res.json({
      success: true,
      cart: submittedCart,
      items,
      mlcc_execution_readiness,
    });
  });

router.post("/:storeId/validate", async (req, res) => {
    const { storeId } = req.params;

    const { statusCode, body } = await requestValidation(supabase, storeId);

    return res.status(statusCode).json(body);
  });

router.patch("/:storeId/history/:cartId/validation-result", async (req, res) => {
    const { storeId, cartId } = req.params;
    const { validationStatus, validationError } = req.body;

    const { statusCode, body } = await recordValidationResult(
      supabase,
      storeId,
      cartId,
      validationStatus,
      validationError,
    );

    return res.status(statusCode).json(body);
  });

router.post("/:storeId/execute", async (req, res) => {
    const { storeId } = req.params;

    const { statusCode, body } = await requestExecution(supabase, storeId);

    return res.status(statusCode).json(body);
  });

router.patch("/:storeId/history/:cartId/execution-result", async (req, res) => {
    const { storeId, cartId } = req.params;
    const {
      executionStatus,
      executionError,
      externalOrderRef,
      executionNotes,
      receiptSnapshot,
    } = req.body;

    const { statusCode, body } = await recordExecutionResult(
      supabase,
      storeId,
      cartId,
      executionStatus,
      executionError,
      externalOrderRef,
      executionNotes,
      receiptSnapshot,
    );

    return res.status(statusCode).json(body);
  });

export default router;
