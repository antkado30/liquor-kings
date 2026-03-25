import express from "express";
import supabase from "../config/supabase.js";
import {
  buildCartSummary,
  getCartItems,
  getLatestCartByStatus,
  getSubmittedCartById,
  isUuid,
} from "../services/cart.service.js";

const router = express.Router();

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
