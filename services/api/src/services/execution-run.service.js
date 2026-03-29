import { buildExecutionPayloadForSubmittedCart } from "./cart-execution-payload.service.js";
import { isUuid } from "../utils/validation.js";

const ACTIVE_STATUSES = ["queued", "running"];

const ALLOWED_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
];

const TERMINAL_STATUSES = ["succeeded", "failed", "canceled"];

const serverError = (message) => ({
  statusCode: 500,
  body: { error: message },
});

export const createExecutionRunFromCart = async (
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

  const payloadResult = await buildExecutionPayloadForSubmittedCart(
    supabase,
    storeId,
    cartId,
  );

  if (payloadResult.statusCode !== 200) {
    return payloadResult;
  }

  const { data: existing, error: existingError } = await supabase
    .from("execution_runs")
    .select("id")
    .eq("cart_id", cartId)
    .in("status", ACTIVE_STATUSES)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return serverError(existingError.message);
  }

  if (existing) {
    return {
      statusCode: 400,
      body: { error: "An active execution run already exists for this cart" },
    };
  }

  const snapshot = payloadResult.body.payload;

  const { data: executionRun, error: insertError } = await supabase
    .from("execution_runs")
    .insert({
      cart_id: cartId,
      store_id: storeId,
      status: "queued",
      payload_snapshot: snapshot,
      worker_notes: null,
      error_message: null,
      started_at: null,
      finished_at: null,
    })
    .select("*")
    .single();

  if (insertError) {
    return serverError(insertError.message);
  }

  return {
    statusCode: 201,
    body: { success: true, data: executionRun },
  };
};

export const listExecutionRunsForCart = async (supabase, storeId, cartId) => {
  if (!isUuid(cartId)) {
    return {
      statusCode: 404,
      body: { error: "Submitted cart not found" },
    };
  }

  const { data, error } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("store_id", storeId)
    .eq("cart_id", cartId)
    .order("created_at", { ascending: false });

  if (error) {
    return serverError(error.message);
  }

  const rows = data ?? [];

  return {
    statusCode: 200,
    body: { success: true, count: rows.length, data: rows },
  };
};

export const getExecutionRunById = async (supabase, runId) => {
  if (!isUuid(runId)) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  const { data, error } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    return serverError(error.message);
  }

  if (!data) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  return {
    statusCode: 200,
    body: { success: true, data },
  };
};

export const updateExecutionRunStatus = async (
  supabase,
  runId,
  status,
  workerNotes,
  errorMessage,
) => {
  if (!isUuid(runId)) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  if (!ALLOWED_STATUSES.includes(status)) {
    return {
      statusCode: 400,
      body: {
        error:
          "Execution run status must be queued, running, succeeded, failed, or canceled",
      },
    };
  }

  const { data: run, error: fetchError } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (fetchError) {
    return serverError(fetchError.message);
  }

  if (!run) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  if (TERMINAL_STATUSES.includes(run.status)) {
    return {
      statusCode: 400,
      body: { error: "Execution run is already finalized" },
    };
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status,
    updated_at: nowIso,
  };

  if (workerNotes !== undefined) {
    patch.worker_notes = workerNotes;
  }

  if (status === "running" && !run.started_at) {
    patch.started_at = nowIso;
  }

  if (status === "succeeded") {
    patch.finished_at = nowIso;
    patch.error_message = null;
  }

  if (status === "failed") {
    patch.finished_at = nowIso;
    patch.error_message = errorMessage ?? null;
  }

  if (status === "canceled") {
    patch.finished_at = nowIso;
  }

  const { data: updatedRun, error: updateError } = await supabase
    .from("execution_runs")
    .update(patch)
    .eq("id", runId)
    .select("*")
    .single();

  if (updateError) {
    return serverError(updateError.message);
  }

  return {
    statusCode: 200,
    body: { success: true, data: updatedRun },
  };
};
