import express from "express";
import supabase from "../config/supabase.js";
import {
  getCartItemsDetailed,
  getSubmittedCartById,
  isUuid,
} from "../services/cart.service.js";
import {
  recordExecutionResult,
  recordValidationResult,
  requestExecution,
  requestValidation,
} from "../services/cart-state.service.js";

const router = express.Router();

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

    const { data: carts, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!carts || carts.length === 0) {
      return res.json({
        success: true,
        history: [],
      });
    }

    const cartIds = carts.map((c) => c.id);

    const { data: items, error: itemsError } = await supabase
      .from("cart_items")
      .select("id, cart_id")
      .in("cart_id", cartIds);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const itemCountByCartId = {};
    for (const row of items ?? []) {
      itemCountByCartId[row.cart_id] = (itemCountByCartId[row.cart_id] ?? 0) + 1;
    }

    const historyWithItemCounts = carts.map((cart) => ({
      ...cart,
      itemCount: itemCountByCartId[cart.id] ?? 0,
    }));

    res.json({
      success: true,
      history: historyWithItemCounts,
    });
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

    res.json({
      success: true,
      cart: submittedCart,
      items,
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
