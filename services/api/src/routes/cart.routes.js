import express from "express";
import supabase from "../config/supabase.js";

const router = express.Router();

router.get("/:storeId", async (req, res) => {
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
    return res.json({
      success: true,
      cart: null,
      items: [],
    });
  }

  const { data: items, error: itemsError } = await supabase
    .from("cart_items")
    .select(`
      id,
      cart_id,
      bottle_id,
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
    `)
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
    const { storeId } = req.params;
    const { bottleId, quantity } = req.body;
  
    if (!bottleId) {
      return res.status(400).json({ error: "bottleId is required" });
    }
  
    const qty = Number(quantity);
  
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: "quantity must be a positive integer" });
    }
  
    const { data: bottle, error: bottleError } = await supabase
      .from("bottles")
      .select("id, name, is_active")
      .eq("id", bottleId)
      .single();
  
    if (bottleError || !bottle) {
      return res.status(404).json({ error: "Bottle not found" });
    }
  
    if (bottle.is_active === false) {
      return res.status(400).json({ error: "Bottle is inactive" });
    }
  
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
router.patch("/items/:itemId", async (req, res) => {
    const { itemId } = req.params;
    const { quantity } = req.body;

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: "quantity must be a positive integer" });
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
  });

  export default router;
