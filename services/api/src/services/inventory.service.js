const INVENTORY_SELECT = `
  id,
  store_id,
  bottle_id,
  quantity,
  low_stock_threshold,
  updated_at,
  shelf_price,
  cost,
  par_level,
  location_note,
  is_active,
  created_at,
  reorder_point,
  reorder_quantity,
  last_counted_at,
  location,
  bottles!inventory_bottle_fk (
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
`;

const clampLimit = (raw, fallback = 50) => {
  const n = Number.parseInt(String(raw), 10);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(Math.max(1, base), 200);
};

export const getInventoryForStore = (supabase, storeId, options = {}) => {
  const limit = clampLimit(options.limit, 50);
  const q = options.q?.trim();

  let query = supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (q) {
    query = query.or(
      `location.ilike.%${q}%,location_note.ilike.%${q}%,bottles!inventory_bottle_fk.name.ilike.%${q}%,bottles!inventory_bottle_fk.mlcc_code.ilike.%${q}%,bottles!inventory_bottle_fk.upc.ilike.%${q}%`,
    );
  }

  return query;
};

export const getInventorySummaryForStore = async (supabase, storeId) => {
  const { data, error } = await supabase
    .from("inventory")
    .select("quantity")
    .eq("store_id", storeId);

  if (error) {
    return { data: null, error };
  }

  const rows = data ?? [];
  const totalRows = rows.length;
  const totalQuantity = rows.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );

  return {
    data: { totalRows, totalQuantity },
    error: null,
  };
};

export const getInventoryItemById = (supabase, storeId, inventoryId) =>
  supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .eq("id", inventoryId)
    .maybeSingle();
