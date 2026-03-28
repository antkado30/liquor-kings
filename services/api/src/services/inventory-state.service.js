import { isUuid } from "./cart.service.js";

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

const notFound = () => ({
  statusCode: 404,
  body: { error: "Inventory item not found" },
});

const isNonNegativeInteger = (value) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return false;
  }
  return true;
};

export const updateInventoryQuantity = async (
  supabase,
  storeId,
  inventoryId,
  quantity,
) => {
  if (!isUuid(inventoryId)) {
    return notFound();
  }

  if (quantity === undefined || quantity === null) {
    return {
      statusCode: 400,
      body: { error: "Quantity must be a non-negative integer" },
    };
  }

  const q = Number(quantity);
  if (!Number.isInteger(q) || q < 0) {
    return {
      statusCode: 400,
      body: { error: "Quantity must be a non-negative integer" },
    };
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("inventory")
    .update({ quantity: q, updated_at: updatedAt })
    .eq("id", inventoryId)
    .eq("store_id", storeId)
    .select(INVENTORY_SELECT);

  if (error) {
    return { statusCode: 500, body: { error: error.message } };
  }

  if (!data?.length) {
    return notFound();
  }

  return {
    statusCode: 200,
    body: { success: true, data: data[0] },
  };
};

export const updateInventoryLocation = async (
  supabase,
  storeId,
  inventoryId,
  location,
  locationNote,
) => {
  if (!isUuid(inventoryId)) {
    return notFound();
  }

  const trimmed = typeof location === "string" ? location.trim() : "";
  if (!trimmed) {
    return {
      statusCode: 400,
      body: { error: "Location is required" },
    };
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("inventory")
    .update({
      location: trimmed,
      location_note: locationNote ?? null,
      updated_at: updatedAt,
    })
    .eq("id", inventoryId)
    .eq("store_id", storeId)
    .select(INVENTORY_SELECT);

  if (error) {
    return { statusCode: 500, body: { error: error.message } };
  }

  if (!data?.length) {
    return notFound();
  }

  return {
    statusCode: 200,
    body: { success: true, data: data[0] },
  };
};

export const updateInventoryReorderSettings = async (
  supabase,
  storeId,
  inventoryId,
  lowStockThreshold,
  reorderPoint,
) => {
  if (!isUuid(inventoryId)) {
    return notFound();
  }

  if (lowStockThreshold === undefined && reorderPoint === undefined) {
    return {
      statusCode: 400,
      body: { error: "At least one reorder setting is required" },
    };
  }

  const validateValue = (value) => {
    if (value === null) {
      return true;
    }
    return isNonNegativeInteger(value);
  };

  if (lowStockThreshold !== undefined && !validateValue(lowStockThreshold)) {
    return {
      statusCode: 400,
      body: { error: "Reorder settings must be non-negative integers or null" },
    };
  }

  if (reorderPoint !== undefined && !validateValue(reorderPoint)) {
    return {
      statusCode: 400,
      body: { error: "Reorder settings must be non-negative integers or null" },
    };
  }

  const patch = { updated_at: new Date().toISOString() };
  if (lowStockThreshold !== undefined) {
    patch.low_stock_threshold = lowStockThreshold;
  }
  if (reorderPoint !== undefined) {
    patch.reorder_point = reorderPoint;
  }

  const { data, error } = await supabase
    .from("inventory")
    .update(patch)
    .eq("id", inventoryId)
    .eq("store_id", storeId)
    .select(INVENTORY_SELECT);

  if (error) {
    return { statusCode: 500, body: { error: error.message } };
  }

  if (!data?.length) {
    return notFound();
  }

  return {
    statusCode: 200,
    body: { success: true, data: data[0] },
  };
};
