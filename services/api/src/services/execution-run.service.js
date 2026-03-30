import { buildExecutionPayloadForSubmittedCart } from "./cart-execution-payload.service.js";
import { verifyCartItemsBeforeExecution } from "./bottle-identity.service.js";
import {
  classifyFailureType,
  isRetryableFailureType,
} from "./execution-failure.service.js";
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
const DEFAULT_MAX_RETRIES = 2;

const serverError = (message) => ({
  statusCode: 500,
  body: { error: message },
});

const isMissingColumnError = (error, columnName) =>
  String(error?.message ?? "").toLowerCase().includes(
    String(columnName).toLowerCase(),
  );

const applyExecutionRunPatch = async (supabase, runId, storeId, patch) => {
  const runUpdate = async (candidatePatch) =>
    supabase
      .from("execution_runs")
      .update(candidatePatch)
      .eq("id", runId)
      .eq("store_id", storeId)
      .select("*")
      .single();

  const optionalColumns = [
    "queued_at",
    "retry_count",
    "max_retries",
    "failure_type",
    "failure_details",
    "evidence",
  ];
  let retryPatch = { ...patch };
  let result = await runUpdate(retryPatch);

  while (result.error) {
    let removed = false;
    for (const col of optionalColumns) {
      if (
        Object.prototype.hasOwnProperty.call(retryPatch, col) &&
        isMissingColumnError(result.error, col)
      ) {
        delete retryPatch[col];
        removed = true;
      }
    }
    if (!removed) break;
    result = await runUpdate(retryPatch);
  }

  return result;
};

const asEvidenceArray = (value) => {
  if (Array.isArray(value)) return value;
  return [];
};

const buildRunSummary = (run) => {
  const evidence = asEvidenceArray(run?.evidence);
  const hasEvidence = evidence.length > 0;
  const status = run?.status ?? null;
  const retryCount = Number(run?.retry_count ?? 0);
  const maxRetries = Number(run?.max_retries ?? DEFAULT_MAX_RETRIES);
  const failureType = run?.failure_type ?? null;
  const failureMessage = run?.error_message ?? null;
  const isTerminal = TERMINAL_STATUSES.includes(status);
  const retryAllowed =
    status === "failed" &&
    failureType != null &&
    isRetryableFailureType(failureType) &&
    retryCount < maxRetries;

  const manualReviewRecommended =
    status === "failed" &&
    (failureType === "UNKNOWN" ||
      failureType === "CODE_MISMATCH" ||
      failureType === "OUT_OF_STOCK" ||
      hasEvidence);

  return {
    run_id: run?.id ?? null,
    store_id: run?.store_id ?? null,
    cart_id: run?.cart_id ?? null,
    status,
    retry_count: retryCount,
    max_retries: maxRetries,
    failure_type: failureType,
    failure_message: failureMessage,
    progress_stage: run?.progress_stage ?? null,
    progress_message: run?.progress_message ?? null,
    timestamps: {
      queued_at: run?.queued_at ?? run?.created_at ?? null,
      started_at: run?.started_at ?? null,
      heartbeat_at: run?.heartbeat_at ?? null,
      finished_at: run?.finished_at ?? null,
      created_at: run?.created_at ?? null,
      updated_at: run?.updated_at ?? null,
    },
    has_evidence: hasEvidence,
    manual_review_recommended: manualReviewRecommended,
    retry_allowed: retryAllowed,
  };
};

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
      queued_at: new Date().toISOString(),
      payload_snapshot: snapshot,
      worker_notes: null,
      error_message: null,
      retry_count: 0,
      max_retries: DEFAULT_MAX_RETRIES,
      failure_type: null,
      failure_details: null,
      started_at: null,
      finished_at: null,
    })
    .select("*")
    .single();

  if (insertError) {
    // Compatibility fallback for DBs that haven't applied reliability columns yet.
    if (
      isMissingColumnError(insertError, "queued_at") ||
      isMissingColumnError(insertError, "retry_count") ||
      isMissingColumnError(insertError, "max_retries") ||
      isMissingColumnError(insertError, "failure_type") ||
      isMissingColumnError(insertError, "failure_details")
    ) {
      const { data: fallbackRun, error: fallbackErr } = await supabase
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

      if (fallbackErr) {
        return serverError(fallbackErr.message);
      }

      return {
        statusCode: 201,
        body: { success: true, data: fallbackRun },
      };
    }
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

export const listExecutionRunSummariesForCart = async (
  supabase,
  storeId,
  cartId,
) => {
  const result = await listExecutionRunsForCart(supabase, storeId, cartId);
  if (result.statusCode !== 200) return result;

  const rows = result.body.data ?? [];
  return {
    statusCode: 200,
    body: {
      success: true,
      count: rows.length,
      data: rows.map(buildRunSummary),
    },
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

export const getExecutionRunSummaryById = async (supabase, runId, storeId) => {
  const result = await getExecutionRunById(supabase, runId, storeId);
  if (result.statusCode !== 200) return result;

  return {
    statusCode: 200,
    body: { success: true, data: buildRunSummary(result.body.data) },
  };
};

export const getExecutionRunEvidenceById = async (supabase, runId, storeId) => {
  const result = await getExecutionRunById(supabase, runId, storeId);
  if (result.statusCode !== 200) return result;

  const row = result.body.data;
  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: row.id,
      store_id: row.store_id,
      cart_id: row.cart_id,
      evidence: asEvidenceArray(row.evidence),
      has_evidence: asEvidenceArray(row.evidence).length > 0,
    },
  };
};

export const updateExecutionRunStatus = async (
  supabase,
  runId,
  storeId,
  status,
  workerNotes,
  errorMessage,
  failureType,
  failureDetails,
  evidence,
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
  if (evidence !== undefined) {
    const existingEvidence = asEvidenceArray(run.evidence);
    patch.evidence = [
      ...existingEvidence,
      ...asEvidenceArray(evidence),
    ];
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
    patch.failure_type = null;
    patch.failure_details = null;
    patch.heartbeat_at = nowIso;
    patch.progress_stage = "completed";
    patch.progress_message = "Execution completed successfully";
  }

  if (status === "failed") {
    const classifiedType = classifyFailureType({
      errorMessage,
      explicitType: failureType,
    });
    const retryable = isRetryableFailureType(classifiedType);
    const retryCount = Number(run.retry_count ?? 0);
    const maxRetries = Number(run.max_retries ?? DEFAULT_MAX_RETRIES);
    const shouldRetry = retryable && retryCount < maxRetries;

    patch.error_message = errorMessage ?? null;
    patch.failure_type = classifiedType;
    patch.failure_details = {
      ...(failureDetails && typeof failureDetails === "object" ? failureDetails : {}),
      classified_type: classifiedType,
      retryable,
      retry_count_before: retryCount,
      max_retries: maxRetries,
      failed_at: nowIso,
    };
    patch.heartbeat_at = nowIso;

    if (shouldRetry) {
      patch.status = "queued";
      patch.retry_count = retryCount + 1;
      patch.queued_at = nowIso;
      patch.progress_stage = "retry_scheduled";
      patch.progress_message = `Retry scheduled (${retryCount + 1}/${maxRetries})`;
      patch.worker_id = null;
      patch.started_at = null;
      patch.finished_at = null;
    } else {
      patch.finished_at = nowIso;
      patch.progress_stage = "failed";
      patch.progress_message = "Execution failed";
    }
  }

  if (status === "canceled") {
    patch.finished_at = nowIso;
    patch.heartbeat_at = nowIso;
    patch.progress_stage = "canceled";
  }

  const { data: updatedRun, error: updateError } = await applyExecutionRunPatch(
    supabase,
    runId,
    storeId,
    patch,
  );

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
      progress_stage: "running",
      progress_message: "Execution run claimed by worker",
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

