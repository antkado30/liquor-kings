export const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const getLatestCartByStatus = (
  supabase,
  storeId,
  status,
  orderColumn = "updated_at",
) =>
  supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", status)
    .order(orderColumn, { ascending: false })
    .limit(1)
    .maybeSingle();

export const getSubmittedCartById = (supabase, storeId, cartId) =>
  supabase
    .from("carts")
    .select("*")
    .eq("id", cartId)
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .maybeSingle();

export const getCartItems = (supabase, cartId, selectClause = "id, quantity") =>
  supabase.from("cart_items").select(selectClause).eq("cart_id", cartId);

export const getCartItemsDetailed = (supabase, cartId) =>
  supabase
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
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });

export const buildCartSummary = (cart, items) => {
  const rows = items ?? [];
  const itemCount = rows.length;
  let totalQuantity = 0;
  for (const row of rows) {
    totalQuantity += Number(row.quantity ?? 0);
  }

  return {
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
  };
};
