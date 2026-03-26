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

const clampLookupLimit = (raw, fallback = 25) => {
  const n = Number.parseInt(String(raw), 10);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(Math.max(1, base), 100);
};

const clampLowStockLimit = (raw, fallback = 100) => {
  const n = Number.parseInt(String(raw), 10);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(Math.max(1, base), 200);
};

export const getInventoryByBottleId = (supabase, storeId, bottleId) =>
  supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .eq("bottle_id", bottleId)
    .order("updated_at", { ascending: false });

export const lookupInventoryForStore = async (
  supabase,
  storeId,
  query,
  limit = 25,
) => {
  const capped = clampLookupLimit(limit, 25);
  const like = `%${query}%`;

  const [locationRes, locationNoteRes, nameRes, mlccRes, upcRes] = await Promise.all(
    [
      supabase
        .from("inventory")
        .select(INVENTORY_SELECT)
        .eq("store_id", storeId)
        .ilike("location", like),
      supabase
        .from("inventory")
        .select(INVENTORY_SELECT)
        .eq("store_id", storeId)
        .ilike("location_note", like),
      supabase
        .from("bottles")
        .select("id")
        .ilike("name", like),
      supabase
        .from("bottles")
        .select("id")
        .ilike("mlcc_code", like),
      supabase
        .from("bottles")
        .select("id")
        .ilike("upc", like),
    ].map((p) => p),
  );

  const bottleIdSet = new Set([
    ...(nameRes.data ?? []),
    ...(mlccRes.data ?? []),
    ...(upcRes.data ?? []),
  ].map((r) => r.id));

  const inventoryBottleMatches =
    bottleIdSet.size > 0
      ? await supabase
          .from("inventory")
          .select(INVENTORY_SELECT)
          .eq("store_id", storeId)
          .in("bottle_id", [...bottleIdSet])
      : { data: [], error: null };

  const allRows = [
    ...(locationRes.data ?? []),
    ...(locationNoteRes.data ?? []),
    ...(inventoryBottleMatches.data ?? []),
  ];

  const error =
    locationRes.error ??
    locationNoteRes.error ??
    nameRes.error ??
    mlccRes.error ??
    upcRes.error ??
    inventoryBottleMatches.error ??
    null;

  if (error) {
    return { data: null, error };
  }

  const dedupedById = new Map();
  for (const row of allRows) {
    dedupedById.set(row.id, row);
  }

  const sorted = Array.from(dedupedById.values()).sort((a, b) => {
    const at = new Date(a.updated_at).getTime();
    const bt = new Date(b.updated_at).getTime();
    return bt - at;
  });

  return { data: sorted.slice(0, capped), error: null };
};

export const getLowStockInventoryForStore = async (
  supabase,
  storeId,
  limit = 100,
) => {
  const capped = clampLowStockLimit(limit, 100);

  const { data, error } = await supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(capped);

  if (error) {
    return { data: null, error };
  }

  const filtered = (data ?? []).filter((row) => {
    const qty = Number(row.quantity ?? 0);
    const low = row.low_stock_threshold;
    const reorder = row.reorder_point;

    const lowStockCondition =
      low !== null && low !== undefined && qty <= Number(low);

    const reorderCondition =
      reorder !== null && reorder !== undefined && qty <= Number(reorder);

    return lowStockCondition || reorderCondition;
  });

  return { data: filtered.slice(0, capped), error: null };
};

const clampOperationalLimit = (raw, fallback = 100) => {
  const n = Number.parseInt(String(raw), 10);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(Math.max(1, base), 200);
};

export const getOutOfStockInventoryForStore = (supabase, storeId, limit = 100) =>
  supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .lte("quantity", 0)
    .order("updated_at", { ascending: false })
    .limit(clampOperationalLimit(limit, 100));

export const getReorderCandidatesForStore = async (
  supabase,
  storeId,
  limit = 100,
) => {
  const capped = clampOperationalLimit(limit, 100);

  const { data, error } = await supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(capped);

  if (error) {
    return { data: null, error };
  }

  const filtered = (data ?? []).filter((row) => {
    const qty = Number(row.quantity ?? 0);
    const low = row.low_stock_threshold;
    const reorder = row.reorder_point;

    const lowStockCondition =
      low !== null && low !== undefined && qty <= Number(low);

    const reorderCondition =
      reorder !== null && reorder !== undefined && qty <= Number(reorder);

    return lowStockCondition || reorderCondition;
  });

  return { data: filtered, error: null };
};

export const getInventoryForStoreByLocation = (
  supabase,
  storeId,
  location,
  limit = 100,
) => {
  const capped = clampOperationalLimit(limit, 100);

  return supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .ilike("location", `%${location}%`)
    .order("updated_at", { ascending: false })
    .limit(capped);
};
