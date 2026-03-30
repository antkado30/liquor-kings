import express from "express";
import supabase from "../config/supabase.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import { enforceCartItemStoreScope } from "../middleware/cart-item-scope.middleware.js";
import { resolveAndVerifyBottleIdentity } from "../services/bottle-identity.service.js";

const router = express.Router();

router.param("storeId", enforceParamStoreMatches);

router.patch(
  "/items/:itemId",
  enforceCartItemStoreScope,
  async (req, res) => {
    const { itemId } = req.params;
    const { quantity } = req.body;

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res
        .status(400)
        .json({ error: "quantity must be a positive integer" });
    }

    const { data: existingItem, error: fetchError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    if (!existingItem) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    const { data: updatedItem, error: updateError } = await supabase
      .from("cart_items")
      .update({
        quantity: qty,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      success: true,
      item: updatedItem,
    });
  },
);

router.delete(
  "/items/:itemId",
  enforceCartItemStoreScope,
  async (req, res) => {
    const { itemId } = req.params;

    const { data: existingItem, error: fetchError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    if (!existingItem) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    const { error: deleteError } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", itemId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.json({
      success: true,
      deletedItemId: itemId,
    });
  },
);

router.get("/:storeId", async (req, res) => {
  const storeId = req.store_id;

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
    return res.json({
      success: true,
      cart: null,
      items: [],
    });
  }

  const { data: items, error: itemsError } = await supabase
    .from("cart_items")
    .select(
      `
      id,
      cart_id,
      bottle_id,
      mlcc_item_id,
      quantity,
      created_at,
      updated_at,
      bottles (
        id,
        name,
        mlcc_code,
        upc,
        image_url,
        size,
        size_ml,
        category,
        subcategory,
        state_min_price,
        shelf_price,
        is_active
      )
    `,
    )
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return res.status(500).json({ error: itemsError.message });
  }

  res.json({
    success: true,
    cart,
    items,
  });
});

router.post("/:storeId/items", async (req, res) => {
  const storeId = req.store_id;
  const {
    bottleId,
    quantity,
    liquor_code,
    mlcc_code,
    name: requestedName,
    size_ml: requestedSizeMl,
    fingerprint: requestedFingerprint,
  } = req.body ?? {};

  if (!bottleId) {
    return res.status(400).json({ error: "bottleId is required" });
  }

  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    return res
      .status(400)
      .json({ error: "quantity must be a positive integer" });
  }

  const identity = await resolveAndVerifyBottleIdentity(supabase, {
    bottleId,
    liquorCode: liquor_code ?? mlcc_code,
    requestedName,
    requestedSizeMl,
    requestedFingerprint,
    storeId,
    userId: req.auth_user_id,
  });

  if (!identity.ok) {
    return res.status(400).json({
      error: "CODE_MISMATCH",
      details: identity.details,
    });
  }

  const { mlccItem } = identity;

  let { data: cart, error: cartError } = await supabase
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
    const { data: newCart, error: newCartError } = await supabase
      .from("carts")
      .insert({
        store_id: storeId,
        status: "active",
      })
      .select("*")
      .single();

    if (newCartError) {
      return res.status(500).json({ error: newCartError.message });
    }

    cart = newCart;
  }

  const { data: existingItem, error: existingItemError } = await supabase
    .from("cart_items")
    .select("*")
    .eq("cart_id", cart.id)
    .eq("bottle_id", bottleId)
    .maybeSingle();

  if (existingItemError) {
    return res.status(500).json({ error: existingItemError.message });
  }

  let savedItem;

  if (existingItem) {
    const newQuantity = existingItem.quantity + qty;

    const { data: updatedItem, error: updateError } = await supabase
      .from("cart_items")
      .update({
        quantity: newQuantity,
        mlcc_item_id: mlccItem.id,
        store_id: storeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingItem.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    savedItem = updatedItem;
  } else {
    const { data: newItem, error: insertError } = await supabase
      .from("cart_items")
      .insert({
        cart_id: cart.id,
        bottle_id: bottleId,
        mlcc_item_id: mlccItem.id,
        store_id: storeId,
        quantity: qty,
      })
      .select("*")
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    savedItem = newItem;
  }

  res.status(201).json({
    success: true,
    cart,
    item: savedItem,
  });
});

router.delete("/:storeId/items", async (req, res) => {
  const storeId = req.store_id;

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
    return res.json({
      success: true,
      clearedCount: 0,
    });
  }

  const { data: cartItems, error: itemsError } = await supabase
    .from("cart_items")
    .select("id")
    .eq("cart_id", cart.id);

  if (itemsError) {
    return res.status(500).json({ error: itemsError.message });
  }

  const ids = (cartItems ?? []).map((row) => row.id);

  if (ids.length === 0) {
    return res.json({
      success: true,
      clearedCount: 0,
    });
  }

  const { error: deleteError } = await supabase
    .from("cart_items")
    .delete()
    .eq("cart_id", cart.id);

  if (deleteError) {
    return res.status(500).json({ error: deleteError.message });
  }

  res.json({
    success: true,
    clearedCount: ids.length,
  });
});

export default router;
