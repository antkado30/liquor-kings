import supabase from "../config/supabase.js";
import { logSystemDiagnostic, DIAGNOSTIC_KIND } from "../services/diagnostics.service.js";

export async function enforceCartItemStoreScope(req, res, next) {
  const { itemId } = req.params;

  const { data: row, error } = await supabase
    .from("cart_items")
    .select("id, cart_id")
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!row) {
    return res.status(404).json({ error: "Cart item not found" });
  }

  const { data: cart, error: cartErr } = await supabase
    .from("carts")
    .select("store_id")
    .eq("id", row.cart_id)
    .maybeSingle();

  if (cartErr) {
    return res.status(500).json({ error: cartErr.message });
  }

  const cartStoreId = cart?.store_id;
  if (cartStoreId !== req.store_id) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.STORE_MISMATCH,
      storeId: req.store_id,
      userId: req.auth_user_id,
      payload: {
        reason: "cart_item_store_mismatch",
        cart_item_id: itemId,
        cart_store_id: cartStoreId,
      },
    });
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
