import {
  getCartItemsDetailed,
  getLatestCartByStatus,
  getSubmittedCartById,
} from "./cart.service.js";
import {
  collectMissingMlccItemIdLines,
  MLCC_EXECUTION_ITEM_ID_MESSAGE,
} from "../utils/mlcc-execution-item-guard.js";
import { isUuid } from "../utils/validation.js";

const STORE_SELECT = `
  id,
  store_name,
  liquor_license,
  mlcc_store_number,
  mlcc_username
`;

const serverError = (message) => ({
  statusCode: 500,
  body: { error: message },
});

const mapBottleForPayload = (b) => ({
  id: b?.id ?? null,
  name: b?.name ?? null,
  mlcc_code: b?.mlcc_code ?? null,
  mlcc_item_id: b?.mlcc_item_id ?? null,
  upc: b?.upc ?? null,
  size_ml: b?.size_ml ?? null,
  category: b?.category ?? null,
  subcategory: b?.subcategory ?? null,
  is_active: b?.is_active ?? null,
});

const buildItemsAndSummary = (cartItems) => {
  const rows = cartItems ?? [];
  const itemCount = rows.length;
  const totalQuantity = rows.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const items = rows.map((cartItem) => {
    const b = cartItem.bottles;
    return {
      cartItemId: cartItem.id,
      bottleId: cartItem.bottle_id,
      mlcc_item_id: cartItem.mlcc_item_id ?? null,
      quantity: cartItem.quantity,
      bottle: mapBottleForPayload(b),
    };
  });
  return {
    items,
    summary: { itemCount, totalQuantity },
  };
};

export const buildExecutionPayloadForSubmittedCart = async (
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

  if (cart.validation_status !== "validated") {
    return {
      statusCode: 400,
      body: {
        error: "Cart must be validated before execution payload can be built",
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

  if (!cartItems?.length) {
    return {
      statusCode: 400,
      body: { error: "Cannot build execution payload for an empty cart" },
    };
  }

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select(STORE_SELECT)
    .eq("id", cart.store_id)
    .maybeSingle();

  if (storeError) {
    return serverError(storeError.message);
  }

  if (!store) {
    return {
      statusCode: 404,
      body: { error: "Store not found" },
    };
  }

  const { items, summary } = buildItemsAndSummary(cartItems);

  return {
    statusCode: 200,
    body: {
      success: true,
      payload: {
        cart: {
          id: cart.id,
          store_id: cart.store_id,
          status: cart.status,
          validation_status: cart.validation_status,
          execution_status: cart.execution_status,
          created_at: cart.created_at,
          updated_at: cart.updated_at,
          placed_at: cart.placed_at,
          external_order_ref: cart.external_order_ref,
          execution_notes: cart.execution_notes,
        },
        store: {
          id: store.id,
          store_name: store.store_name,
          liquor_license: store.liquor_license,
          mlcc_store_number: store.mlcc_store_number,
          mlcc_username: store.mlcc_username,
        },
        items,
        summary,
      },
    },
  };
};

export const buildLatestExecutionPayloadForStore = async (
  supabase,
  storeId,
) => {
  const { data: cart, error: cartError } = await getLatestCartByStatus(
    supabase,
    storeId,
    "submitted",
    "updated_at",
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

  return buildExecutionPayloadForSubmittedCart(supabase, storeId, cart.id);
};

/**
 * Read-only MLCC execution readiness (same payload build + collectMissingMlccItemIdLines as from-cart guard).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} storeId
 * @param {string} cartId
 * @returns {Promise<{ statusCode: number; body: Record<string, unknown> }>}
 */
export async function evaluateMlccExecutionReadinessForSubmittedCart(
  supabase,
  storeId,
  cartId,
) {
  const payloadResult = await buildExecutionPayloadForSubmittedCart(
    supabase,
    storeId,
    cartId,
  );

  if (payloadResult.statusCode !== 200) {
    const b = payloadResult.body ?? {};
    const err = b.error ?? "readiness_check_failed";
    const message =
      typeof b.error === "string"
        ? b.error
        : (typeof b.message === "string" ? b.message : "Cart cannot be evaluated for MLCC readiness.");
    return {
      statusCode: payloadResult.statusCode,
      body: {
        ok: false,
        ready: false,
        error: err,
        message,
        blocking_lines: [],
      },
    };
  }

  const blocking = collectMissingMlccItemIdLines(payloadResult.body.payload);
  if (blocking.length > 0) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ready: false,
        error: "MLCC_ITEM_ID_REQUIRED",
        message: MLCC_EXECUTION_ITEM_ID_MESSAGE,
        blocking_lines: blocking,
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      ready: true,
      blocking_lines: [],
    },
  };
}
