import { isUuid } from "../utils/validation.js";

export const requestValidation = async (supabase, storeId) => {
  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cartError) {
    return { statusCode: 500, body: { error: cartError.message } };
  }

  if (!cart) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  if (cart.execution_status === "pending" || cart.execution_status === "executed") {
    return {
      statusCode: 400,
      body: { error: "Cannot request validation after execution has been requested" },
    };
  }

  if (cart.validation_status === "pending" || cart.validation_status === "validated") {
    return {
      statusCode: 400,
      body: { error: "Validation has already been requested for this cart" },
    };
  }

  const { data: cartItems, error: itemsError } = await supabase
    .from("cart_items")
    .select("id")
    .eq("cart_id", cart.id);

  if (itemsError) {
    return { statusCode: 500, body: { error: itemsError.message } };
  }

  const itemCount = (cartItems ?? []).length;

  if (itemCount === 0) {
    return {
      statusCode: 400,
      body: { error: "Cannot validate an empty submitted cart" },
    };
  }

  const { data: updatedCart, error: updateError } = await supabase
    .from("carts")
    .update({
      validation_status: "pending",
      validation_requested_at: new Date().toISOString(),
      validation_completed_at: null,
      validation_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cart.id)
    .select("*")
    .single();

  if (updateError) {
    return { statusCode: 500, body: { error: updateError.message } };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      cart: updatedCart,
      itemCount,
    },
  };
};

export const recordValidationResult = async (
  supabase,
  storeId,
  cartId,
  validationStatus,
  validationError,
) => {
  if (validationStatus !== "validated" && validationStatus !== "failed") {
    return {
      statusCode: 400,
      body: { error: "validationStatus must be either validated or failed" },
    };
  }

  if (!isUuid(cartId)) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  const { data: submittedCart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("id", cartId)
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .maybeSingle();

  if (cartError) {
    return { statusCode: 500, body: { error: cartError.message } };
  }

  if (!submittedCart) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  if (submittedCart.validation_status !== "pending") {
    return {
      statusCode: 400,
      body: {
        error: "Validation result can only be recorded after validation has been requested",
      },
    };
  }

  if (
    submittedCart.execution_status === "pending" ||
    submittedCart.execution_status === "executed"
  ) {
    return {
      statusCode: 400,
      body: { error: "Cannot change validation result after execution has been requested" },
    };
  }

  const completedAt = new Date().toISOString();
  const { data: updatedCart, error: updateError } = await supabase
    .from("carts")
    .update({
      validation_status: validationStatus,
      validation_completed_at: completedAt,
      updated_at: completedAt,
      validation_error:
        validationStatus === "validated" ? null : (validationError ?? null),
    })
    .eq("id", submittedCart.id)
    .select("*")
    .single();

  if (updateError) {
    return { statusCode: 500, body: { error: updateError.message } };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      cart: updatedCart,
    },
  };
};

export const requestExecution = async (supabase, storeId) => {
  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cartError) {
    return { statusCode: 500, body: { error: cartError.message } };
  }

  if (!cart) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  if (cart.execution_status === "pending" || cart.execution_status === "executed") {
    return {
      statusCode: 400,
      body: { error: "Execution has already been requested for this cart" },
    };
  }

  if (cart.validation_status !== "validated") {
    return {
      statusCode: 400,
      body: { error: "Cart must be validated before execution" },
    };
  }

  const { data: cartItems, error: itemsError } = await supabase
    .from("cart_items")
    .select("id")
    .eq("cart_id", cart.id);

  if (itemsError) {
    return { statusCode: 500, body: { error: itemsError.message } };
  }

  const itemCount = (cartItems ?? []).length;

  if (itemCount === 0) {
    return {
      statusCode: 400,
      body: { error: "Cannot execute an empty submitted cart" },
    };
  }

  const { data: updatedCart, error: updateError } = await supabase
    .from("carts")
    .update({
      execution_status: "pending",
      execution_requested_at: new Date().toISOString(),
      execution_completed_at: null,
      execution_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cart.id)
    .select("*")
    .single();

  if (updateError) {
    return { statusCode: 500, body: { error: updateError.message } };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      cart: updatedCart,
      itemCount,
    },
  };
};

export const recordExecutionResult = async (
  supabase,
  storeId,
  cartId,
  executionStatus,
  executionError,
  externalOrderRef,
  executionNotes,
  receiptSnapshot,
) => {
  if (executionStatus !== "executed" && executionStatus !== "failed") {
    return {
      statusCode: 400,
      body: { error: "executionStatus must be either executed or failed" },
    };
  }

  if (!isUuid(cartId)) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  const { data: submittedCart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("id", cartId)
    .eq("store_id", storeId)
    .eq("status", "submitted")
    .maybeSingle();

  if (cartError) {
    return { statusCode: 500, body: { error: cartError.message } };
  }

  if (!submittedCart) {
    return { statusCode: 404, body: { error: "Submitted cart not found" } };
  }

  if (submittedCart.execution_status !== "pending") {
    return {
      statusCode: 400,
      body: {
        error: "Execution result can only be recorded after execution has been requested",
      },
    };
  }

  const completedAt = new Date().toISOString();
  const updatePayload = {
    execution_status: executionStatus,
    execution_completed_at: completedAt,
    updated_at: completedAt,
  };

  if (executionStatus === "executed") {
    Object.assign(updatePayload, {
      placed_at: completedAt,
      external_order_ref: externalOrderRef ?? null,
      execution_notes: executionNotes ?? null,
      receipt_snapshot: receiptSnapshot ?? null,
      execution_error: null,
    });
  } else {
    Object.assign(updatePayload, {
      execution_error: executionError ?? null,
      execution_notes: executionNotes ?? null,
    });
    if (externalOrderRef !== undefined) {
      updatePayload.external_order_ref = externalOrderRef;
    }
    if (receiptSnapshot !== undefined) {
      updatePayload.receipt_snapshot = receiptSnapshot;
    }
  }

  const { data: updatedCart, error: updateError } = await supabase
    .from("carts")
    .update(updatePayload)
    .eq("id", submittedCart.id)
    .select("*")
    .single();

  if (updateError) {
    return { statusCode: 500, body: { error: updateError.message } };
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      cart: updatedCart,
    },
  };
};
