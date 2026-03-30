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
const OPERATOR_ACTION = {
  ACKNOWLEDGE: "acknowledge",
  MARK_FOR_MANUAL_REVIEW: "mark_for_manual_review",
  RETRY_NOW: "retry_now",
  CANCEL: "cancel",
  RESOLVE_WITHOUT_RETRY: "resolve_without_retry",
};

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

const asOperatorActionsArray = (value) => {
  if (Array.isArray(value)) return value;
  return [];
};

const getLatestOperatorAction = (actions) => {
  const rows = asOperatorActionsArray(actions);
  if (!rows.length) return null;
  const [latest] = rows;
  return {
    action: latest.action ?? null,
    reason: latest.reason ?? null,
    note: latest.note ?? null,
    actor_id: latest.actor_id ?? null,
    created_at: latest.created_at ?? null,
  };
};

const buildRunSummary = (run, operatorActions = []) => {
  const evidence = asEvidenceArray(run?.evidence);
  const hasEvidence = evidence.length > 0;
  const status = run?.status ?? null;
  const retryCount = Number(run?.retry_count ?? 0);
  const maxRetries = Number(run?.max_retries ?? DEFAULT_MAX_RETRIES);
  const failureType = run?.failure_type ?? null;
  const failureMessage = run?.error_message ?? null;
  const retryAllowed =
    status === "failed" &&
    failureType != null &&
    isRetryableFailureType(failureType) &&
    retryCount < maxRetries;
  const latestOperatorAction = getLatestOperatorAction(operatorActions);
  const operatorStatus =
    latestOperatorAction?.action === OPERATOR_ACTION.MARK_FOR_MANUAL_REVIEW
      ? "manual_review"
      : latestOperatorAction?.action === OPERATOR_ACTION.RESOLVE_WITHOUT_RETRY
        ? "resolved_without_retry"
        : latestOperatorAction?.action === OPERATOR_ACTION.ACKNOWLEDGE
          ? "acknowledged"
          : latestOperatorAction?.action === OPERATOR_ACTION.CANCEL
            ? "canceled_by_operator"
            : "none";
  const pendingManualReview =
    latestOperatorAction?.action === OPERATOR_ACTION.MARK_FOR_MANUAL_REVIEW;
  const actionableNextStep = pendingManualReview
    ? "manual_review"
    : retryAllowed
      ? "retry_now_allowed"
      : status === "failed"
        ? "resolve_or_acknowledge"
        : status === "running"
          ? "monitor"
          : "none";

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
    operator_status: operatorStatus,
    latest_operator_action: latestOperatorAction,
    pending_manual_review: pendingManualReview,
    actionable_next_step: actionableNextStep,
  };
};

const getRunOperatorActions = async (supabase, runId, storeId) => {
  const { data, error } = await supabase
    .from("execution_run_operator_actions")
    .select("id, run_id, store_id, action, reason, note, actor_id, created_at")
    .eq("run_id", runId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
};

const buildOperatorReviewListItem = (summary) => ({
  run_id: summary.run_id,
  store_id: summary.store_id,
  cart_id: summary.cart_id,
  status: summary.status,
  failure_type: summary.failure_type,
  failure_message: summary.failure_message,
  retry_count: summary.retry_count,
  retry_allowed: summary.retry_allowed,
  progress_stage: summary.progress_stage,
  has_evidence: summary.has_evidence,
  operator_status: summary.operator_status,
  latest_operator_action: summary.latest_operator_action,
  pending_manual_review: summary.pending_manual_review,
  actionable_next_step: summary.actionable_next_step,
  manual_review_recommended: summary.manual_review_recommended,
  timestamps: summary.timestamps,
});

const mapLatestActionsByRunId = (rows) => {
  const latestByRun = new Map();
  for (const row of rows ?? []) {
    const runId = row.run_id ?? null;
    if (!runId) continue;
    const existing = latestByRun.get(runId);
    if (!existing) {
      latestByRun.set(runId, row);
      continue;
    }
    const existingAt = new Date(existing.created_at ?? 0).getTime();
    const currentAt = new Date(row.created_at ?? 0).getTime();
    if (currentAt > existingAt) {
      latestByRun.set(runId, row);
    }
  }
  return latestByRun;
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
  const withSummaries = [];
  for (const row of rows) {
    const { data: actions, error: actionErr } = await getRunOperatorActions(
      supabase,
      row.id,
      row.store_id,
    );
    if (actionErr) {
      return serverError(actionErr.message);
    }
    withSummaries.push(buildRunSummary(row, actions));
  }
  return {
    statusCode: 200,
    body: {
      success: true,
      count: withSummaries.length,
      data: withSummaries,
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
  const { data: actions, error: actionErr } = await getRunOperatorActions(
    supabase,
    runId,
    storeId,
  );
  if (actionErr) return serverError(actionErr.message);

  return {
    statusCode: 200,
    body: { success: true, data: buildRunSummary(result.body.data, actions) },
  };
};

export const listExecutionRunsForOperatorReview = async (
  supabase,
  storeId,
  {
    status,
    failureType,
    pendingManualReview,
    cartId,
    limit = 50,
    offset = 0,
  } = {},
) => {
  if (!storeId || !isUuid(storeId)) {
    return { statusCode: 400, body: { error: "Store context required" } };
  }

  let query = supabase
    .from("execution_runs")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }
  if (failureType) {
    query = query.eq("failure_type", failureType);
  }
  if (cartId) {
    query = query.eq("cart_id", cartId);
  }

  const { data, error } = await query;
  if (error) return serverError(error.message);

  const rows = data ?? [];
  const runIds = rows.map((row) => row.id).filter(Boolean);

  let actionsByRunId = new Map();
  if (runIds.length > 0) {
    const { data: actionRows, error: actionErr } = await supabase
      .from("execution_run_operator_actions")
      .select("id, run_id, store_id, action, reason, note, actor_id, created_at")
      .eq("store_id", storeId)
      .in("run_id", runIds)
      .order("created_at", { ascending: false });
    if (actionErr) return serverError(actionErr.message);
    actionsByRunId = mapLatestActionsByRunId(actionRows);
  }

  let items = rows.map((row) => {
    const latest = actionsByRunId.get(row.id);
    const summary = buildRunSummary(row, latest ? [latest] : []);
    return buildOperatorReviewListItem(summary);
  });

  if (pendingManualReview === true) {
    items = items.filter((item) => item.pending_manual_review === true);
  }
  if (pendingManualReview === false) {
    items = items.filter((item) => item.pending_manual_review === false);
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      count: items.length,
      data: items,
      page: {
        limit,
        offset,
      },
    },
  };
};

export const getExecutionRunOperatorReviewBundleById = async (
  supabase,
  runId,
  storeId,
) => {
  const summaryResult = await getExecutionRunSummaryById(supabase, runId, storeId);
  if (summaryResult.statusCode !== 200) return summaryResult;

  const evidenceResult = await getExecutionRunEvidenceById(supabase, runId, storeId);
  if (evidenceResult.statusCode !== 200) return evidenceResult;

  const actionsResult = await getExecutionRunOperatorActionsById(
    supabase,
    runId,
    storeId,
  );
  if (actionsResult.statusCode !== 200) return actionsResult;

  return {
    statusCode: 200,
    body: {
      success: true,
      data: {
        run_id: runId,
        store_id: storeId,
        summary: summaryResult.body.data,
        evidence: {
          has_evidence: evidenceResult.body.has_evidence,
          items: evidenceResult.body.evidence,
        },
        operator_actions: {
          count: actionsResult.body.count,
          items: actionsResult.body.data,
        },
      },
    },
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

export const getExecutionRunOperatorActionsById = async (
  supabase,
  runId,
  storeId,
) => {
  const runResult = await getExecutionRunById(supabase, runId, storeId);
  if (runResult.statusCode !== 200) return runResult;

  const { data, error } = await getRunOperatorActions(supabase, runId, storeId);
  if (error) return serverError(error.message);

  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: runId,
      store_id: storeId,
      count: data.length,
      data,
    },
  };
};

export const applyExecutionRunOperatorAction = async (
  supabase,
  runId,
  storeId,
  action,
  { reason, note, actorId } = {},
) => {
  const runResult = await getExecutionRunById(supabase, runId, storeId);
  if (runResult.statusCode !== 200) return runResult;
  const run = runResult.body.data;
  const summary = buildRunSummary(run);

  const allowed = new Set(Object.values(OPERATOR_ACTION));
  if (!allowed.has(action)) {
    return { statusCode: 400, body: { error: "Invalid operator action" } };
  }

  if (action === OPERATOR_ACTION.RETRY_NOW && !summary.retry_allowed) {
    return {
      statusCode: 400,
      body: { error: "retry_now is not allowed for this run" },
    };
  }

  const patch = {};
  const nowIso = new Date().toISOString();
  if (action === OPERATOR_ACTION.RETRY_NOW) {
    patch.status = "queued";
    patch.queued_at = nowIso;
    patch.progress_stage = "operator_retry_requested";
    patch.progress_message = "Operator requested immediate retry";
    patch.worker_id = null;
    patch.started_at = null;
    patch.finished_at = null;
  } else if (action === OPERATOR_ACTION.CANCEL) {
    if (run.status === "succeeded") {
      return { statusCode: 400, body: { error: "Cannot cancel a succeeded run" } };
    }
    patch.status = "canceled";
    patch.finished_at = nowIso;
    patch.progress_stage = "canceled";
    patch.progress_message = "Canceled by operator";
  } else if (action === OPERATOR_ACTION.MARK_FOR_MANUAL_REVIEW) {
    patch.progress_stage = "manual_review";
    patch.progress_message = "Marked for manual review by operator";
  } else if (action === OPERATOR_ACTION.RESOLVE_WITHOUT_RETRY) {
    if (run.status !== "failed") {
      return {
        statusCode: 400,
        body: { error: "resolve_without_retry requires a failed run" },
      };
    }
    patch.progress_stage = "resolved_without_retry";
    patch.progress_message = "Operator resolved without retry";
  } else if (action === OPERATOR_ACTION.ACKNOWLEDGE) {
    patch.progress_stage = run.progress_stage ?? "acknowledged";
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = nowIso;
    const { error: patchErr } = await applyExecutionRunPatch(
      supabase,
      runId,
      storeId,
      patch,
    );
    if (patchErr) return serverError(patchErr.message);
  }

  const { error: actionErr } = await supabase
    .from("execution_run_operator_actions")
    .insert({
      run_id: runId,
      store_id: storeId,
      action,
      reason: reason ?? null,
      note: note ?? null,
      actor_id: actorId ?? null,
    });

  if (actionErr) {
    return serverError(actionErr.message);
  }

  return getExecutionRunSummaryById(supabase, runId, storeId);
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

