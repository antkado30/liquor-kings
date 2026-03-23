import express from "express";
import supabase from "../config/supabase.js";

const router = express.Router();

router.get("/:storeId/active-summary", async (req, res) => {
    const { storeId } = req.params;

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.json({
        success: true,
        summary: null,
      });
    }

    const { data: cartItems, error: itemsError } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const rows = cartItems ?? [];
    const itemCount = rows.length;
    let totalQuantity = 0;
    for (const row of rows) {
      totalQuantity += Number(row.quantity ?? 0);
    }

    res.json({
      success: true,
      summary: {
        id: cart.id,
        store_id: cart.store_id,
        status: cart.status,
        validation_status: cart.validation_status,
        execution_status: cart.execution_status,
        placed_at: cart.placed_at,
        external_order_ref: cart.external_order_ref,
        execution_notes: cart.execution_notes,
        receipt_snapshot: cart.receipt_snapshot,
        created_at: cart.created_at,
        updated_at: cart.updated_at,
        itemCount,
        totalQuantity,
      },
    });
  });


router.get("/:storeId/overview", async (req, res) => {
    const { storeId } = req.params;

    const { data: activeCart, error: activeCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeCartError) {
      return res.status(500).json({ error: activeCartError.message });
    }

    const { data: submittedCart, error: submittedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (submittedCartError) {
      return res.status(500).json({ error: submittedCartError.message });
    }

    let activeSummaryOrNull = null;
    if (activeCart) {
      const { data: activeItems, error: activeItemsError } = await supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("cart_id", activeCart.id);

      if (activeItemsError) {
        return res.status(500).json({ error: activeItemsError.message });
      }

      const activeRows = activeItems ?? [];
      const activeItemCount = activeRows.length;
      let activeTotalQuantity = 0;
      for (const row of activeRows) {
        activeTotalQuantity += Number(row.quantity ?? 0);
      }

      activeSummaryOrNull = {
        id: activeCart.id,
        store_id: activeCart.store_id,
        status: activeCart.status,
        validation_status: activeCart.validation_status,
        execution_status: activeCart.execution_status,
        placed_at: activeCart.placed_at,
        external_order_ref: activeCart.external_order_ref,
        execution_notes: activeCart.execution_notes,
        receipt_snapshot: activeCart.receipt_snapshot,
        created_at: activeCart.created_at,
        updated_at: activeCart.updated_at,
        itemCount: activeItemCount,
        totalQuantity: activeTotalQuantity,
      };
    }

    let submittedSummaryOrNull = null;
    if (submittedCart) {
      const { data: submittedItems, error: submittedItemsError } = await supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("cart_id", submittedCart.id);

      if (submittedItemsError) {
        return res.status(500).json({ error: submittedItemsError.message });
      }

      const submittedRows = submittedItems ?? [];
      const submittedItemCount = submittedRows.length;
      let submittedTotalQuantity = 0;
      for (const row of submittedRows) {
        submittedTotalQuantity += Number(row.quantity ?? 0);
      }

      submittedSummaryOrNull = {
        id: submittedCart.id,
        store_id: submittedCart.store_id,
        status: submittedCart.status,
        validation_status: submittedCart.validation_status,
        execution_status: submittedCart.execution_status,
        placed_at: submittedCart.placed_at,
        external_order_ref: submittedCart.external_order_ref,
        execution_notes: submittedCart.execution_notes,
        receipt_snapshot: submittedCart.receipt_snapshot,
        created_at: submittedCart.created_at,
        updated_at: submittedCart.updated_at,
        itemCount: submittedItemCount,
        totalQuantity: submittedTotalQuantity,
      };
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

    const { data: cartItems, error: itemsError } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const rows = cartItems ?? [];
    const itemCount = rows.length;
    let totalQuantity = 0;
    for (const row of rows) {
      totalQuantity += Number(row.quantity ?? 0);
    }

    res.json({
      success: true,
      summary: {
        id: cart.id,
        store_id: cart.store_id,
        status: cart.status,
        validation_status: cart.validation_status,
        execution_status: cart.execution_status,
        placed_at: cart.placed_at,
        external_order_ref: cart.external_order_ref,
        execution_notes: cart.execution_notes,
        receipt_snapshot: cart.receipt_snapshot,
        created_at: cart.created_at,
        updated_at: cart.updated_at,
        itemCount,
        totalQuantity,
      },
    });
  });


router.get("/:storeId/history/:cartId/summary", async (req, res) => {
    const { storeId, cartId } = req.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(cartId)) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cartId)
      .eq("store_id", storeId)
      .eq("status", "submitted")
      .maybeSingle();

    if (cartError) {
      return res.status(500).json({ error: cartError.message });
    }

    if (!cart) {
      return res.status(404).json({ error: "Submitted cart not found" });
    }

    const { data: cartItems, error: itemsError } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cart.id);

    if (itemsError) {
      return res.status(500).json({ error: itemsError.message });
    }

    const rows = cartItems ?? [];
    const itemCount = rows.length;
    let totalQuantity = 0;
    for (const row of rows) {
      totalQuantity += Number(row.quantity ?? 0);
    }

    res.json({
      success: true,
      summary: {
        id: cart.id,
        store_id: cart.store_id,
        status: cart.status,
        validation_status: cart.validation_status,
        execution_status: cart.execution_status,
        placed_at: cart.placed_at,
        external_order_ref: cart.external_order_ref,
        execution_notes: cart.execution_notes,
        receipt_snapshot: cart.receipt_snapshot,
        created_at: cart.created_at,
        updated_at: cart.updated_at,
        itemCount,
        totalQuantity,
      },
    });
  });

export default router;
