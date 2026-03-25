import express from "express";
import supabase from "../config/supabase.js";
import {
  getCartItemsDetailed,
  getSubmittedCartById,
  isUuid,
} from "../services/cart.service.js";

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

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    if (
      cart.execution_status === "pending" ||
      cart.execution_status === "executed"
    ) {
      return res.status(400).json({
        error: "Cannot request validation after execution has been requested",
      });
    }

    if (cart.validation_status === "pending" || cart.validation_status === "validated") {
      return res.status(400).json({
        error: "Validation has already been requested for this cart",
      });
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
      return res.status(400).json({ error: "Cannot validate an empty submitted cart" });
    }

    const { data: updatedCart, error: updateError } = await supabase
      .from("carts")
      .update({
        validation_status: "pending",
        validation_requested_at: new Date().toISOString(),
        validation_completed_at: null,
        validation_error: null,
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

router.patch("/:storeId/history/:cartId/validation-result", async (req, res) => {
    const { storeId, cartId } = req.params;
    const { validationStatus, validationError } = req.body;

    if (validationStatus !== "validated" && validationStatus !== "failed") {
      return res.status(400).json({
        error: "validationStatus must be either validated or failed",
      });
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(cartId)) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: submittedCart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cartId)
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!submittedCart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    if (submittedCart.validation_status !== "pending") {
      return res.status(400).json({
        error: "Validation result can only be recorded after validation has been requested",
      });
    }

    if (
      submittedCart.execution_status === "pending" ||
      submittedCart.execution_status === "executed"
    ) {
      return res.status(400).json({
        error: "Cannot change validation result after execution has been requested",
      });
    }

    const completedAt = new Date().toISOString();
    const updatePayload = {
      validation_status: validationStatus,
      validation_completed_at: completedAt,
      updated_at: completedAt,
      validation_error:
        validationStatus === "validated" ? null : (validationError ?? null),
    };

    const { data: updatedCart, error: updateError } = await supabase
      .from("carts")
      .update(updatePayload)
      .eq("id", submittedCart.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      success: true,
      cart: updatedCart,
    });
  });

router.post("/:storeId/execute", async (req, res) => {
    const { storeId } = req.params;

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    if (
      cart.execution_status === "pending" ||
      cart.execution_status === "executed"
    ) {
      return res.status(400).json({
        error: "Execution has already been requested for this cart",
      });
    }

    if (cart.validation_status !== "validated") {
      return res.status(400).json({ error: "Cart must be validated before execution" });
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
      return res.status(400).json({ error: "Cannot execute an empty submitted cart" });
    }

    const { data: updatedCart, error: updateError } = await supabase
      .from("carts")
      .update({
        execution_status: "pending",
        execution_requested_at: new Date().toISOString(),
        execution_completed_at: null,
        execution_error: null,
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

router.patch("/:storeId/history/:cartId/execution-result", async (req, res) => {
    const { storeId, cartId } = req.params;
    const {
      executionStatus,
      executionError,
      externalOrderRef,
      executionNotes,
      receiptSnapshot,
    } = req.body;

    if (executionStatus !== "executed" && executionStatus !== "failed") {
      return res.status(400).json({
        error: "executionStatus must be either executed or failed",
      });
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(cartId)) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: submittedCart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cartId)
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!submittedCart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    if (submittedCart.execution_status !== "pending") {
      return res.status(400).json({
        error: "Execution result can only be recorded after execution has been requested",
      });
    }

    const completedAt = new Date().toISOString();
    const updatePayload = {
      execution_status: executionStatus,
      execution_completed_at: completedAt,
      updated_at: completedAt,
    };

    if (executionStatus === "executed") {
      Object.assign(updatePayload, {
        placed_at: completedAt,
        external_order_ref: externalOrderRef ?? null,
        execution_notes: executionNotes ?? null,
        receipt_snapshot: receiptSnapshot ?? null,
        execution_error: null,
      });
    } else {
      Object.assign(updatePayload, {
        execution_error: executionError ?? null,
        execution_notes: executionNotes ?? null,
      });
      if (externalOrderRef !== undefined) {
        updatePayload.external_order_ref = externalOrderRef;
      }
      if (receiptSnapshot !== undefined) {
        updatePayload.receipt_snapshot = receiptSnapshot;
      }
    }

    const { data: updatedCart, error: updateError } = await supabase
      .from("carts")
      .update(updatePayload)
      .eq("id", submittedCart.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      success: true,
      cart: updatedCart,
    });
  });

export default router;
