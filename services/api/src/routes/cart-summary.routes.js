import express from "express";
import supabase from "../config/supabase.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import {
  buildCartSummary,
  getCartItems,
  getLatestCartByStatus,
  getSubmittedCartById,
} from "../services/cart.service.js";
import {
  getActiveCartAvailability,
  getSubmittedCartAvailability,
} from "../services/cart-availability.service.js";
import {
  buildExecutionPayloadForSubmittedCart,
  buildLatestExecutionPayloadForStore,
} from "../services/cart-execution-payload.service.js";
import { isUuid } from "../utils/validation.js";

const router = express.Router();

router.param("storeId", enforceParamStoreMatches);

router.get("/:storeId/active-summary", async (req, res) => {
    const { storeId } = req.params;

    const { data: cart, error: cartError } = await getLatestCartByStatus(
      supabase,
      storeId,
      "active",
    );

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.json({
        success: true,
        summary: null,
      });
    }

    const { data: cartItems, error: itemsError } = await getCartItems(supabase, cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    res.json({
      success: true,
      summary: buildCartSummary(cart, cartItems),
    });
  });

router.get("/:storeId/active-availability", async (req, res) => {
  const { storeId } = req.params;

  const { statusCode, body } = await getActiveCartAvailability(
    supabase,
    storeId,
  );

  return res.status(statusCode).json(body);
});


router.get("/:storeId/overview", async (req, res) => {
    const { storeId } = req.params;

    const { data: activeCart, error: activeCartError } = await getLatestCartByStatus(
      supabase,
      storeId,
      "active",
    );

    if (activeCartError) {
      return res.status(500).json({ error: activeCartError.message });
    }

    const { data: submittedCart, error: submittedCartError } = await getLatestCartByStatus(
      supabase,
      storeId,
      "submitted",
    );

    if (submittedCartError) {
      return res.status(500).json({ error: submittedCartError.message });
    }

    let activeSummaryOrNull = null;
    if (activeCart) {
      const { data: activeItems, error: activeItemsError } = await getCartItems(
        supabase,
        activeCart.id,
      );

      if (activeItemsError) {
        return res.status(500).json({ error: activeItemsError.message });
      }

      activeSummaryOrNull = buildCartSummary(activeCart, activeItems);
    }

    let submittedSummaryOrNull = null;
    if (submittedCart) {
      const { data: submittedItems, error: submittedItemsError } = await getCartItems(
        supabase,
        submittedCart.id,
      );

      if (submittedItemsError) {
        return res.status(500).json({ error: submittedItemsError.message });
      }

      submittedSummaryOrNull = buildCartSummary(submittedCart, submittedItems);
    }

    res.json({
      success: true,
      overview: {
        activeCart: activeSummaryOrNull,
        latestSubmittedCart: submittedSummaryOrNull,
      },
    });
  });


router.get("/:storeId/latest-submitted-summary", async (req, res) => {
    const { storeId } = req.params;

    const { data: cart, error: cartError } = await getLatestCartByStatus(
      supabase,
      storeId,
      "submitted",
    );

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: cartItems, error: itemsError } = await getCartItems(supabase, cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    res.json({
      success: true,
      summary: buildCartSummary(cart, cartItems),
    });
  });

router.get("/:storeId/execution-payload/latest", async (req, res) => {
  const { storeId } = req.params;

  const { statusCode, body } = await buildLatestExecutionPayloadForStore(
    supabase,
    storeId,
  );

  return res.status(statusCode).json(body);
});


router.get("/:storeId/history/:cartId/availability", async (req, res) => {
  const { storeId, cartId } = req.params;

  const { statusCode, body } = await getSubmittedCartAvailability(
    supabase,
    storeId,
    cartId,
  );

  return res.status(statusCode).json(body);
});


router.get("/:storeId/history/:cartId/execution-payload", async (req, res) => {
  const { storeId, cartId } = req.params;

  const { statusCode, body } = await buildExecutionPayloadForSubmittedCart(
    supabase,
    storeId,
    cartId,
  );

  return res.status(statusCode).json(body);
});


router.get("/:storeId/history/:cartId/summary", async (req, res) => {
    const { storeId, cartId } = req.params;

    if (!isUuid(cartId)) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: cart, error: cartError } = await getSubmittedCartById(
      supabase,
      storeId,
      cartId,
    );

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: cartItems, error: itemsError } = await getCartItems(supabase, cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    res.json({
      success: true,
      summary: buildCartSummary(cart, cartItems),
    });
  });

export default router;
