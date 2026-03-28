import {
  getCartItemsDetailed,
  getLatestCartByStatus,
  getSubmittedCartById,
} from "./cart.service.js";
import { isUuid } from "../utils/validation.js";

const INVENTORY_SELECT = `
  id,
  store_id,
  bottle_id,
  quantity,
  is_active,
  low_stock_threshold,
  reorder_point,
  location,
  location_note,
  updated_at
`;

const serverError = (message) => ({
  statusCode: 500,
  body: { error: message },
});

const mapInventoryRowToMatch = (inventory) => ({
  id: inventory.id,
  store_id: inventory.store_id,
  bottle_id: inventory.bottle_id,
  quantity: inventory.quantity,
  is_active: inventory.is_active,
  low_stock_threshold: inventory.low_stock_threshold,
  reorder_point: inventory.reorder_point,
  location: inventory.location,
  location_note: inventory.location_note,
  updated_at: inventory.updated_at,
});

const computeAvailability = (matches) => {
  const hasInventoryMatch = matches.length > 0;
  const totalInventoryQuantity = matches.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const hasOutOfStockMatch = matches.some(
    (row) => Number(row.quantity ?? 0) <= 0,
  );
  const hasLowStockMatch = matches.some((row) => {
    const q = Number(row.quantity ?? 0);
    const lst = row.low_stock_threshold;
    const rp = row.reorder_point;
    if (lst != null && q <= Number(lst)) {
      return true;
    }
    if (rp != null && q <= Number(rp)) {
      return true;
    }
    return false;
  });

  return {
    hasInventoryMatch,
    totalInventoryQuantity,
    hasOutOfStockMatch,
    hasLowStockMatch,
  };
};

const groupInventoryByBottleId = (rows) => {
  const map = new Map();
  for (const row of rows ?? []) {
    const bid = row.bottle_id;
    if (!map.has(bid)) {
      map.set(bid, []);
    }
    map.get(bid).push(row);
  }
  return map;
};

const buildEnrichedItems = (cartItems, inventoryByBottle) => {
  return (cartItems ?? []).map((cartItem) => {
    const matches = inventoryByBottle.get(cartItem.bottle_id) ?? [];
    const inventoryMatches = matches.map(mapInventoryRowToMatch);

    return {
      cartItemId: cartItem.id,
      cartId: cartItem.cart_id,
      bottleId: cartItem.bottle_id,
      cartQuantity: cartItem.quantity,
      bottle: cartItem.bottles ?? null,
      inventoryMatches,
      availability: computeAvailability(matches),
    };
  });
};

const loadInventoryForStoreAndBottles = async (supabase, storeId, bottleIds) => {
  const unique = [...new Set((bottleIds ?? []).filter(Boolean))];
  if (unique.length === 0) {
    return { data: [], error: null };
  }

  return supabase
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("store_id", storeId)
    .in("bottle_id", unique);
};

export const getActiveCartAvailability = async (supabase, storeId) => {
  const { data: cart, error: cartError } = await getLatestCartByStatus(
    supabase,
    storeId,
    "active",
  );

  if (cartError) {
    return serverError(cartError.message);
  }

  if (!cart) {
    return {
      statusCode: 200,
      body: {
        success: true,
        cart: null,
        items: [],
      },
    };
  }

  const { data: cartItems, error: itemsError } = await getCartItemsDetailed(
    supabase,
    cart.id,
  );

  if (itemsError) {
    return serverError(itemsError.message);
  }

  const bottleIds = (cartItems ?? []).map((row) => row.bottle_id);
  const { data: inventoryRows, error: invError } =
    await loadInventoryForStoreAndBottles(supabase, storeId, bottleIds);

  if (invError) {
    return serverError(invError.message);
  }

  const inventoryByBottle = groupInventoryByBottleId(inventoryRows);
  const items = buildEnrichedItems(cartItems, inventoryByBottle);

  return {
    statusCode: 200,
    body: {
      success: true,
      cart,
      items,
    },
  };
};

export const getSubmittedCartAvailability = async (
  supabase,
  storeId,
  cartId,
) => {
  if (!isUuid(cartId)) {
    return {
      statusCode: 404,
      body: { error: "Submitted cart not found" },
    };
  }

  const { data: cart, error: cartError } = await getSubmittedCartById(
    supabase,
    storeId,
    cartId,
  );

  if (cartError) {
    return serverError(cartError.message);
  }

  if (!cart) {
    return {
      statusCode: 404,
      body: { error: "Submitted cart not found" },
    };
  }

  const { data: cartItems, error: itemsError } = await getCartItemsDetailed(
    supabase,
    cart.id,
  );

  if (itemsError) {
    return serverError(itemsError.message);
  }

  const bottleIds = (cartItems ?? []).map((row) => row.bottle_id);
  const { data: inventoryRows, error: invError } =
    await loadInventoryForStoreAndBottles(supabase, storeId, bottleIds);

  if (invError) {
    return serverError(invError.message);
  }

  const inventoryByBottle = groupInventoryByBottleId(inventoryRows);
  const items = buildEnrichedItems(cartItems, inventoryByBottle);

  return {
    statusCode: 200,
    body: {
      success: true,
      cart,
      items,
    },
  };
};
