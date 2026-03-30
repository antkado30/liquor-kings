import { buildExecutionPayloadForSubmittedCart } from "./cart-execution-payload.service.js";
import { verifyCartItemsBeforeExecution } from "./bottle-identity.service.js";
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
  { userId } = {},
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

  const identity = await verifyCartItemsBeforeExecution(supabase, {
    storeId,
    userId: userId ?? null,
    cartId,
  });

  if (!identity.ok) {
    return {
      statusCode: 400,
      body: {
        error: "CODE_MISMATCH",
        details: identity.details,
      },
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("execution_runs")
    .select("id")
    .eq("cart_id", cartId)
    .eq("store_id", storeId)
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

export const getExecutionRunById = async (supabase, runId, storeId) => {
  if (!isUuid(runId)) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  if (!storeId || !isUuid(storeId)) {
    return {
      statusCode: 400,
      body: { error: "Store context required" },
    };
  }

  const { data, error } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("id", runId)
    .eq("store_id", storeId)
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
  storeId,
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

  if (!storeId || !isUuid(storeId)) {
    return {
      statusCode: 400,
      body: { error: "Store context required" },
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
    .eq("store_id", storeId)
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

  if (status === "running") {
    patch.heartbeat_at = nowIso;
  }

  if (status === "succeeded") {
    patch.finished_at = nowIso;
    patch.error_message = null;
    patch.heartbeat_at = nowIso;
    patch.progress_stage = "completed";
  }

  if (status === "failed") {
    patch.finished_at = nowIso;
    patch.error_message = errorMessage ?? null;
    patch.heartbeat_at = nowIso;
    patch.progress_stage = "failed";
  }

  if (status === "canceled") {
    patch.finished_at = nowIso;
    patch.heartbeat_at = nowIso;
    patch.progress_stage = "canceled";
  }

  const { data: updatedRun, error: updateError } = await supabase
    .from("execution_runs")
    .update(patch)
    .eq("id", runId)
    .eq("store_id", storeId)
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

export const heartbeatExecutionRun = async (
  supabase,
  runId,
  storeId,
  workerId,
  progressStage,
  progressMessage,
  workerNotes,
) => {
  if (!isUuid(runId)) {
    return {
      statusCode: 404,
      body: { error: "Execution run not found" },
    };
  }

  if (!storeId || !isUuid(storeId)) {
    return {
      statusCode: 400,
      body: { error: "Store context required" },
    };
  }

  const { data: run, error: fetchError } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("id", runId)
    .eq("store_id", storeId)
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

  if (run.status !== "running") {
    return {
      statusCode: 400,
      body: {
        error: "Heartbeat can only be recorded for a running execution run",
      },
    };
  }

  if (
    run.worker_id != null &&
    workerId !== undefined &&
    run.worker_id !== workerId
  ) {
    return {
      statusCode: 400,
      body: { error: "Execution run is owned by a different worker" },
    };
  }

  const nowIso = new Date().toISOString();
  const patch = {
    heartbeat_at: nowIso,
    updated_at: nowIso,
  };

  if (workerId !== undefined && run.worker_id == null) {
    patch.worker_id = workerId;
  }

  if (progressStage !== undefined) {
    patch.progress_stage = progressStage;
  }

  if (progressMessage !== undefined) {
    patch.progress_message = progressMessage;
  }

  if (workerNotes !== undefined) {
    patch.worker_notes = workerNotes;
  }

  const { data: updatedRun, error: updateError } = await supabase
    .from("execution_runs")
    .update(patch)
    .eq("id", runId)
    .eq("store_id", storeId)
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

export const claimNextQueuedExecutionRun = async (
  supabase,
  workerId,
  workerNotes,
) => {
  const { data: candidates, error: listError } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(10);

  if (listError) {
    return serverError(listError.message);
  }

  const queue = candidates ?? [];

  if (queue.length === 0) {
    return {
      statusCode: 200,
      body: { success: true, data: null },
    };
  }

  for (const candidate of queue) {
    const now = new Date().toISOString();
    const startedAt = candidate.started_at ?? now;

    const patch = {
      status: "running",
      updated_at: now,
      started_at: startedAt,
      heartbeat_at: now,
    };

    if (workerId !== undefined) {
      patch.worker_id = workerId;
    }

    if (workerNotes !== undefined) {
      patch.worker_notes = workerNotes;
    }

    const { data: claimedRun, error: updateError } = await supabase
      .from("execution_runs")
      .update(patch)
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (updateError) {
      return serverError(updateError.message);
    }

    if (claimedRun) {
      return {
        statusCode: 200,
        body: {
          success: true,
          data: {
            run: claimedRun,
            payload: claimedRun.payload_snapshot,
          },
        },
      };
    }
  }

  return {
    statusCode: 200,
    body: { success: true, data: null },
  };
};

