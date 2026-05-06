import {
  buildExecutionPayloadForSubmittedCart,
  evaluateMlccExecutionReadinessForSubmittedCart,
} from "./cart-execution-payload.service.js";
import { verifyCartItemsBeforeExecution } from "./bottle-identity.service.js";
import { assertMlccExecutionReadinessForEnqueue } from "../mlcc/assert-mlcc-execution-readiness-for-cart.js";
import {
  fetchAttemptsByRunIdsGrouped,
  listItemAttemptFields,
} from "./execution-attempt-aggregate.service.js";
import {
  classifyFailureType,
  isRetryableFailureType,
} from "./execution-failure.service.js";
import {
  deriveMlccOperatorContext,
  enrichFailureDetailsWithMlccSignal,
} from "./mlcc-operator-context.service.js";
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

/** Exported for tests and anti-drift — keep aligned with docs/lk/architecture/execution-state-machine.md */
export const EXECUTION_RUN_MODEL = {
  ACTIVE_STATUSES,
  ALLOWED_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_MAX_RETRIES,
  OPERATOR_ACTION,
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

const buildEvidenceMetadataSnapshot = (run) => {
  const ev = asEvidenceArray(run?.evidence);
  const kinds = [...new Set(ev.map((e) => e?.kind).filter(Boolean))];
  return {
    evidence_count: ev.length,
    evidence_kinds: kinds,
  };
};

const getOpenExecutionRunAttempt = async (supabase, runId, storeId) => {
  const { data, error } = await supabase
    .from("execution_run_attempts")
    .select("id")
    .eq("run_id", runId)
    .eq("store_id", storeId)
    .is("finished_at", null)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data, error: null };
};

const insertAttemptForClaimedRun = async (supabase, claimedRun) => {
  const runId = claimedRun.id;
  const storeId = claimedRun.store_id;

  const { data: maxRow, error: maxErr } = await supabase
    .from("execution_run_attempts")
    .select("attempt_number")
    .eq("run_id", runId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) return { error: maxErr };

  const attemptNumber = Number(maxRow?.attempt_number ?? 0) + 1;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("execution_run_attempts").insert({
    run_id: runId,
    store_id: storeId,
    attempt_number: attemptNumber,
    started_at: claimedRun.started_at ?? nowIso,
    status: "running",
    progress_stage: claimedRun.progress_stage ?? "running",
    progress_message: claimedRun.progress_message ?? null,
    worker_id: claimedRun.worker_id ?? null,
    updated_at: nowIso,
  });

  return { error };
};

const updateOpenAttemptFromRunningRow = async (supabase, runId, storeId, runRow) => {
  if (runRow.status !== "running") {
    return { error: null };
  }
  const open = await getOpenExecutionRunAttempt(supabase, runId, storeId);
  if (!open.data || open.error) return { error: open.error };
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("execution_run_attempts")
    .update({
      progress_stage: runRow.progress_stage ?? null,
      progress_message: runRow.progress_message ?? null,
      worker_id: runRow.worker_id ?? null,
      updated_at: nowIso,
    })
    .eq("id", open.data.id);
  return { error };
};

const finalizeOpenExecutionRunAttempt = async (
  supabase,
  runId,
  storeId,
  runRow,
  terminalStatus,
) => {
  const open = await getOpenExecutionRunAttempt(supabase, runId, storeId);
  if (!open.data) return { error: null };
  if (open.error) return { error: open.error };

  const nowIso = new Date().toISOString();
  const meta = buildEvidenceMetadataSnapshot(runRow);
  const patch = {
    finished_at: nowIso,
    status: terminalStatus,
    progress_stage: runRow.progress_stage ?? null,
    progress_message: runRow.progress_message ?? null,
    evidence_metadata: meta,
    worker_id: runRow.worker_id ?? null,
    updated_at: nowIso,
  };

  if (terminalStatus === "failed") {
    patch.failure_type = runRow.failure_type ?? null;
    patch.failure_message = runRow.error_message ?? null;
  } else {
    patch.failure_type = null;
    patch.failure_message = null;
  }

  const { error } = await supabase
    .from("execution_run_attempts")
    .update(patch)
    .eq("id", open.data.id);

  return { error };
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

  const mlccOperatorContext = deriveMlccOperatorContext(run);

  return {
    run_id: run?.id ?? null,
    store_id: run?.store_id ?? null,
    cart_id: run?.cart_id ?? null,
    status,
    retry_count: retryCount,
    max_retries: maxRetries,
    failure_type: failureType,
    failure_message: failureMessage,
    failure_details: run?.failure_details ?? null,
    mlcc_operator_context: mlccOperatorContext,
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

const buildOperatorReviewListItem = (summary, attemptFields = null) => {
  const base = {
    run_id: summary.run_id,
    store_id: summary.store_id,
    cart_id: summary.cart_id,
    status: summary.status,
    failure_type: summary.failure_type,
    failure_message: summary.failure_message,
    mlcc_operator_context: summary.mlcc_operator_context ?? null,
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
  };
  const af = attemptFields ?? listItemAttemptFields(null);
  return {
    ...base,
    stored_attempt_count: af.stored_attempt_count,
    has_multiple_stored_attempts: af.has_multiple_stored_attempts,
    repeated_same_stored_failure: af.repeated_same_stored_failure,
  };
};

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

/** Batch size when scanning execution_runs to count pending_manual_review matches. */
const OPERATOR_REVIEW_PENDING_COUNT_BATCH = 500;

const applyExecutionRunsSqlFilters = (query, { status, failureType, cartId }) => {
  let q = query;
  if (status) q = q.eq("status", status);
  if (failureType) q = q.eq("failure_type", failureType);
  if (cartId) q = q.eq("cart_id", cartId);
  return q;
};

/** Single PostgREST head count; cheap vs scanning rows. */
const countExecutionRunsSqlMatch = async (supabase, storeId, sqlFilters) => {
  let q = supabase
    .from("execution_runs")
    .select("*", { count: "exact", head: true })
    .eq("store_id", storeId);
  q = applyExecutionRunsSqlFilters(q, sqlFilters);
  const { count, error } = await q;
  if (error) return { error: error.message, total: null };
  return { error: null, total: count ?? 0 };
};

/**
 * Count runs whose list item matches pending_manual_review (same logic as list payload).
 * Scans all rows matching SQL filters in batches (needed because this filter uses operator actions).
 *
 * Expensive: O(n) batches over the full SQL-filtered set; each batch loads actions. Listed in parallel
 * with the paged list request in listExecutionRunsForOperatorReview to reduce wall-clock latency only.
 */
const countOperatorReviewPendingManualTotal = async (
  supabase,
  storeId,
  sqlFilters,
  pendingManualReview,
) => {
  let matchTotal = 0;
  let scanOffset = 0;
  for (;;) {
    let q = supabase
      .from("execution_runs")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .range(
        scanOffset,
        scanOffset + OPERATOR_REVIEW_PENDING_COUNT_BATCH - 1,
      );
    q = applyExecutionRunsSqlFilters(q, sqlFilters);
    const { data: rows, error } = await q;
    if (error) return { error: error.message, total: null };
    if (!rows?.length) break;

    const runIds = rows.map((row) => row.id).filter(Boolean);
    let actionsByRunId = new Map();
    if (runIds.length > 0) {
      const { data: actionRows, error: actionErr } = await supabase
        .from("execution_run_operator_actions")
        .select("id, run_id, store_id, action, reason, note, actor_id, created_at")
        .eq("store_id", storeId)
        .in("run_id", runIds)
        .order("created_at", { ascending: false });
      if (actionErr) return { error: actionErr.message, total: null };
      actionsByRunId = mapLatestActionsByRunId(actionRows);
    }

    for (const row of rows) {
      const latest = actionsByRunId.get(row.id);
      const summary = buildRunSummary(row, latest ? [latest] : []);
      const item = buildOperatorReviewListItem(summary);
      if (pendingManualReview === true && item.pending_manual_review === true) {
        matchTotal += 1;
      }
      if (pendingManualReview === false && item.pending_manual_review === false) {
        matchTotal += 1;
      }
    }

    scanOffset += OPERATOR_REVIEW_PENDING_COUNT_BATCH;
  }
  return { error: null, total: matchTotal };
};

export const createExecutionRunFromCart = async (
  supabase,
  storeId,
  cartId,
  { userId, mode } = {},
) => {
  if (!isUuid(cartId)) {
    return {
      statusCode: 404,
      body: { error: "Submitted cart not found" },
    };
  }

  const metadata =
    mode === "rpa_run"
      ? {
          run_type: "rpa_run",
          mode: "dry_run",
          requested_at: new Date().toISOString(),
          requested_by_user_id: userId ?? null,
        }
      : undefined;

  const payloadResult = await buildExecutionPayloadForSubmittedCart(
    supabase,
    storeId,
    cartId,
    metadata !== undefined ? { metadata } : undefined,
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

  const readinessEval = await evaluateMlccExecutionReadinessForSubmittedCart(
    supabase,
    storeId,
    cartId,
  );
  const gate = assertMlccExecutionReadinessForEnqueue(readinessEval);
  if (!gate.ok) {
    return { statusCode: gate.statusCode, body: gate.body };
  }

  const snapshot = payloadResult.body.payload;

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

  const sqlFilters = { status, failureType, cartId };

  const fetchPage = async () => {
    let query = supabase
      .from("execution_runs")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    query = applyExecutionRunsSqlFilters(query, sqlFilters);
    return query;
  };

  const totalPromise =
    pendingManualReview === undefined
      ? countExecutionRunsSqlMatch(supabase, storeId, sqlFilters)
      : countOperatorReviewPendingManualTotal(
          supabase,
          storeId,
          sqlFilters,
          pendingManualReview,
        );

  const [totalCountResult, pageResult] = await Promise.all([totalPromise, fetchPage()]);
  if (totalCountResult.error) {
    return serverError(totalCountResult.error);
  }
  const totalCount = totalCountResult.total;

  const { data, error } = pageResult;
  if (error) return serverError(error.message);

  const rows = data ?? [];
  const runIds = rows.map((row) => row.id).filter(Boolean);

  let actionsByRunId = new Map();
  let attemptsByRunId = new Map();
  if (runIds.length > 0) {
    const { data: actionRows, error: actionErr } = await supabase
      .from("execution_run_operator_actions")
      .select("id, run_id, store_id, action, reason, note, actor_id, created_at")
      .eq("store_id", storeId)
      .in("run_id", runIds)
      .order("created_at", { ascending: false });
    if (actionErr) return serverError(actionErr.message);
    actionsByRunId = mapLatestActionsByRunId(actionRows);

    const { byRunId, error: attErr } = await fetchAttemptsByRunIdsGrouped(
      supabase,
      storeId,
      runIds,
    );
    if (attErr) return serverError(attErr);
    attemptsByRunId = byRunId;
  }

  let items = rows.map((row) => {
    const latest = actionsByRunId.get(row.id);
    const summary = buildRunSummary(row, latest ? [latest] : []);
    const attFields = listItemAttemptFields(attemptsByRunId.get(row.id));
    return buildOperatorReviewListItem(summary, attFields);
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
      total_count: totalCount,
      data: items,
      page: {
        limit,
        offset,
        total_count: totalCount,
      },
    },
  };
};

export const getStorePilotRunsFeed = async (
  supabase,
  storeId,
  { limit = 20 } = {},
) => {
  if (!storeId || !isUuid(storeId)) {
    return {
      statusCode: 400,
      body: { error: "Store context required" },
    };
  }

  let n = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(n) || n < 1) n = 20;
  n = Math.min(n, 100);

  const { data: runs, error } = await supabase
    .from("execution_runs")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .range(0, n - 1);
  if (error) return serverError(error.message);

  const rows = runs ?? [];
  const runIds = rows.map((r) => r.id).filter(Boolean);
  const attemptsCountByRunId = new Map();
  if (runIds.length > 0) {
    const { data: attRows, error: attErr } = await supabase
      .from("execution_run_attempts")
      .select("run_id")
      .eq("store_id", storeId)
      .in("run_id", runIds);
    if (attErr) return serverError(attErr.message);
    for (const row of attRows ?? []) {
      const rid = String(row.run_id ?? "");
      if (!rid) continue;
      attemptsCountByRunId.set(rid, (attemptsCountByRunId.get(rid) ?? 0) + 1);
    }
  }

  const items = [];
  /** @type {Record<string, number>} */
  const by_status = {};
  /** @type {Record<string, number>} */
  const by_verdict_code = {};
  /** @type {Record<string, number>} */
  const by_triage_bucket = {};
  let pilot_complete_runs = 0;
  let runs_with_failed_checks = 0;

  for (const run of rows) {
    const summary = buildRunSummary(run, []);
    const attemptsCount = attemptsCountByRunId.get(String(run.id)) ?? 0;
    const evidenceKinds = summarizeEvidenceKinds(run.evidence);
    const stepEvidence = extractStepEvidence(run.evidence);
    const checks = evaluatePilotVerificationChecks(summary, {
      counts: { attempts: attemptsCount },
      evidence_kinds_tally: evidenceKinds,
    });
    const failedChecks = checks.filter((c) => c?.pass !== true);
    const overallPass = failedChecks.length === 0;
    const verdict = derivePilotVerdict({
      status: summary.status,
      overallPass,
      failedChecks,
    });
    const triageBucket = classifyPilotRunTriageBucket({
      summary,
      verdict,
      failedChecks,
    });

    const statusKey = String(run.status ?? "unknown");
    by_status[statusKey] = (by_status[statusKey] ?? 0) + 1;
    by_verdict_code[verdict.verdict_code] =
      (by_verdict_code[verdict.verdict_code] ?? 0) + 1;
    by_triage_bucket[triageBucket] = (by_triage_bucket[triageBucket] ?? 0) + 1;
    if (verdict.pilot_complete === true) pilot_complete_runs += 1;
    if (failedChecks.length > 0) runs_with_failed_checks += 1;

    items.push({
      run_id: run.id,
      cart_id: run.cart_id ?? null,
      created_at: run.created_at ?? null,
      updated_at: run.updated_at ?? null,
      status: run.status ?? null,
      pilot_verdict_code: verdict.verdict_code,
      triage_bucket: triageBucket,
      pilot_complete: verdict.pilot_complete,
      failed_check_count: failedChecks.length,
      no_submit_evidence_present:
        Number(evidenceKinds.no_submit_attestation ?? 0) > 0,
      worker_step_count: stepEvidence.length,
      latest_step: stepEvidence.length > 0 ? stepEvidence[stepEvidence.length - 1] : null,
    });
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      store_id: storeId,
      limit: n,
      counts: {
        total_runs: items.length,
        pilot_complete_runs,
        runs_with_failed_checks,
        by_status,
        by_verdict_code,
        by_triage_bucket,
      },
      items,
    },
  };
};

export const getStorePilotOverview = async (
  supabase,
  storeId,
  { limit = 20, failedLimit = 5 } = {},
) => {
  const feed = await getStorePilotRunsFeed(supabase, storeId, { limit });
  if (feed.statusCode !== 200) return feed;

  let failN = Number.parseInt(String(failedLimit), 10);
  if (!Number.isFinite(failN) || failN < 1) failN = 5;
  failN = Math.min(failN, 20);

  const items = Array.isArray(feed.body?.items) ? feed.body.items : [];
  const counts = feed.body?.counts ?? {};
  const totalRuns = Number(counts.total_runs ?? items.length ?? 0);
  const pilotCompleteRuns = Number(counts.pilot_complete_runs ?? 0);
  const runsWithFailedChecks = Number(counts.runs_with_failed_checks ?? 0);
  const completionRate =
    totalRuns > 0
      ? Number(((pilotCompleteRuns / totalRuns) * 100).toFixed(2))
      : 0;

  const byTriage = counts.by_triage_bucket ?? {};
  let mostCommonTriageBucket = {
    bucket: null,
    count: 0,
  };
  for (const [bucket, countRaw] of Object.entries(byTriage)) {
    const n = Number(countRaw) || 0;
    if (n > mostCommonTriageBucket.count) {
      mostCommonTriageBucket = { bucket, count: n };
    }
  }

  const recentFailedRuns = items
    .filter((r) => r?.pilot_complete !== true || Number(r?.failed_check_count ?? 0) > 0)
    .slice(0, failN)
    .map((r) => ({
      run_id: r.run_id,
      cart_id: r.cart_id ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
      status: r.status ?? null,
      pilot_verdict_code: r.pilot_verdict_code ?? null,
      triage_bucket: r.triage_bucket ?? null,
      failed_check_count: Number(r.failed_check_count ?? 0),
      no_submit_evidence_present: r.no_submit_evidence_present === true,
      worker_step_count: Number(r.worker_step_count ?? 0),
      latest_step: r.latest_step ?? null,
    }));

  const evaluateStorePilotHealth = ({
    totalRuns: total,
    completionRatePct,
    failedChecksRuns,
    triageCounts,
    completeRuns,
  }) => {
    const triggered_by = {
      low_completion_rate: false,
      repeated_failed_checks: false,
      repeated_same_triage_bucket: false,
      recent_failure_streak: false,
      no_recent_pilot_complete_runs: false,
    };
    /** @type {string[]} */
    const alert_reasons = [];

    if (total >= 3 && completionRatePct < 60) {
      triggered_by.low_completion_rate = true;
      alert_reasons.push("low_completion_rate");
    }

    if (failedChecksRuns >= 2) {
      triggered_by.repeated_failed_checks = true;
      alert_reasons.push("repeated_failed_checks");
    }

    const triageEntries = Object.entries(triageCounts ?? {});
    const dominantCount = triageEntries.reduce(
      (max, [, n]) => Math.max(max, Number(n) || 0),
      0,
    );
    if (dominantCount >= 3) {
      triggered_by.repeated_same_triage_bucket = true;
      alert_reasons.push("repeated_same_triage_bucket");
    }

    const streakWindow = items.slice(0, Math.min(3, items.length));
    if (
      streakWindow.length >= 3 &&
      streakWindow.every(
        (r) => r?.pilot_complete !== true || Number(r?.failed_check_count ?? 0) > 0,
      )
    ) {
      triggered_by.recent_failure_streak = true;
      alert_reasons.push("recent_failure_streak");
    }

    if (total >= 3 && completeRuns === 0) {
      triggered_by.no_recent_pilot_complete_runs = true;
      alert_reasons.push("no_recent_pilot_complete_runs");
    }

    const severeCount = [
      triggered_by.recent_failure_streak,
      triggered_by.no_recent_pilot_complete_runs,
      triggered_by.low_completion_rate,
    ].filter(Boolean).length;
    const any = alert_reasons.length > 0;
    const health_status =
      severeCount >= 2
        ? "needs_attention"
        : any
          ? "degraded"
          : "healthy";

    const firstAttentionCandidateMs = items
      .filter((r) => r?.pilot_complete !== true || Number(r?.failed_check_count ?? 0) > 0)
      .map((r) => new Date(r?.updated_at ?? r?.created_at ?? "").getTime())
      .filter((n) => Number.isFinite(n))
      .reduce((min, n) => (min == null ? n : Math.min(min, n)), null);

    const needs_attention_since =
      health_status === "needs_attention" && firstAttentionCandidateMs != null
        ? new Date(firstAttentionCandidateMs).toISOString()
        : null;

    return {
      health_status,
      needs_attention_since,
      alert_reasons,
      triggered_by,
    };
  };

  const health = evaluateStorePilotHealth({
    totalRuns,
    completionRatePct: completionRate,
    failedChecksRuns: runsWithFailedChecks,
    triageCounts: byTriage,
    completeRuns: pilotCompleteRuns,
  });
  const minimumDataWindowMet = totalRuns >= 3;
  const healthWithWindow = {
    ...health,
    minimum_data_window_met: minimumDataWindowMet,
  };

  return {
    statusCode: 200,
    body: {
      success: true,
      store_id: feed.body.store_id,
      generated_at: new Date().toISOString(),
      window: {
        run_limit: feed.body.limit,
        failed_runs_limit: failN,
      },
      summary: {
        total_recent_runs: totalRuns,
        pilot_complete_runs: pilotCompleteRuns,
        completion_rate_pct: completionRate,
        runs_with_failed_checks: runsWithFailedChecks,
        by_status: counts.by_status ?? {},
        by_verdict: counts.by_verdict_code ?? {},
        by_triage_bucket: byTriage,
        most_common_triage_bucket: mostCommonTriageBucket,
      },
      health: healthWithWindow,
      recent_failed_runs: recentFailedRuns,
    },
  };
};

export const getExecutionRunAttemptsById = async (supabase, runId, storeId) => {
  const runResult = await getExecutionRunById(supabase, runId, storeId);
  if (runResult.statusCode !== 200) return runResult;

  const { data, error } = await supabase
    .from("execution_run_attempts")
    .select(
      "id, attempt_number, started_at, finished_at, status, failure_type, failure_message, progress_stage, progress_message, evidence_metadata, worker_id, created_at, updated_at",
    )
    .eq("run_id", runId)
    .eq("store_id", storeId)
    .order("attempt_number", { ascending: true });

  if (error) {
    return serverError(error.message);
  }

  const rows = data ?? [];
  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: runId,
      store_id: storeId,
      count: rows.length,
      data: rows,
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

  const attemptsResult = await getExecutionRunAttemptsById(supabase, runId, storeId);
  if (attemptsResult.statusCode !== 200) return attemptsResult;

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
        attempt_history: {
          count: attemptsResult.body.count,
          items: attemptsResult.body.data,
        },
      },
    },
  };
};

const pushLifecycleEvent = (events, kind, at, details = {}) => {
  if (!at) return;
  events.push({
    kind,
    at,
    details,
  });
};

const summarizeEvidenceKinds = (evidence) => {
  const tally = {};
  for (const row of asEvidenceArray(evidence)) {
    const k = typeof row?.kind === "string" ? row.kind : "unknown";
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return tally;
};

const extractStepEvidence = (evidence, limit = 50) =>
  asEvidenceArray(evidence)
    .filter((e) => e?.kind === "worker_step_event")
    .sort((a, b) =>
      String(a?.created_at ?? "").localeCompare(String(b?.created_at ?? "")),
    )
    .slice(0, limit)
    .map((e) => ({
      stage: e?.stage ?? null,
      message: e?.message ?? null,
      created_at: e?.created_at ?? null,
      attributes:
        e?.attributes && typeof e.attributes === "object" ? e.attributes : {},
    }));

const sortLifecycleEvents = (events) =>
  [...events].sort((a, b) => {
    const cmp = String(a.at ?? "").localeCompare(String(b.at ?? ""));
    if (cmp !== 0) return cmp;
    return String(a.kind ?? "").localeCompare(String(b.kind ?? ""));
  });

export const getExecutionRunLifecycleById = async (supabase, runId, storeId) => {
  const runResult = await getExecutionRunById(supabase, runId, storeId);
  if (runResult.statusCode !== 200) return runResult;
  const run = runResult.body.data;

  const actionsResult = await getRunOperatorActions(supabase, runId, storeId);
  if (actionsResult.error) return serverError(actionsResult.error.message);
  const actions = actionsResult.data ?? [];

  const attemptsResult = await getExecutionRunAttemptsById(supabase, runId, storeId);
  if (attemptsResult.statusCode !== 200) return attemptsResult;
  const attempts = attemptsResult.body.data ?? [];

  const summary = buildRunSummary(run, actions);
  const events = [];
  pushLifecycleEvent(events, "run_queued", summary.timestamps?.queued_at, {
    status: "queued",
  });
  pushLifecycleEvent(events, "run_started", summary.timestamps?.started_at, {
    status: "running",
    worker_id: run.worker_id ?? null,
  });
  pushLifecycleEvent(events, "run_heartbeat", summary.timestamps?.heartbeat_at, {
    progress_stage: summary.progress_stage,
    progress_message: summary.progress_message,
  });
  pushLifecycleEvent(events, "run_finished", summary.timestamps?.finished_at, {
    status: summary.status,
    failure_type: summary.failure_type,
  });

  for (const att of attempts) {
    pushLifecycleEvent(events, "attempt_started", att.started_at, {
      attempt_number: att.attempt_number,
      worker_id: att.worker_id ?? null,
    });
    pushLifecycleEvent(events, "attempt_finished", att.finished_at, {
      attempt_number: att.attempt_number,
      status: att.status ?? null,
      failure_type: att.failure_type ?? null,
    });
  }

  for (const act of actions) {
    pushLifecycleEvent(events, "operator_action", act.created_at, {
      action: act.action ?? null,
      reason: act.reason ?? null,
      actor_id: act.actor_id ?? null,
    });
  }

  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: run.id,
      store_id: run.store_id,
      cart_id: run.cart_id,
      status: run.status,
      lifecycle: {
        summary,
        counts: {
          attempts: attempts.length,
          operator_actions: actions.length,
          evidence_entries: asEvidenceArray(run.evidence).length,
          step_evidence_entries: extractStepEvidence(run.evidence).length,
        },
        evidence_kinds_tally: summarizeEvidenceKinds(run.evidence),
        step_evidence: extractStepEvidence(run.evidence),
        events: sortLifecycleEvents(events),
      },
    },
  };
};

const evaluatePilotVerificationChecks = (summary, lifecycle) => {
  const checks = [];
  const status = summary?.status ?? null;
  const ts = summary?.timestamps ?? {};

  checks.push({
    key: "queue_timestamp_present",
    pass: !!ts.queued_at,
    details: { queued_at: ts.queued_at ?? null },
  });

  checks.push({
    key: "run_started_when_expected",
    pass:
      status === "queued"
        ? true
        : !!ts.started_at,
    details: { status, started_at: ts.started_at ?? null },
  });

  checks.push({
    key: "heartbeat_present_for_running_or_terminal",
    pass:
      status === "queued"
        ? true
        : !!ts.heartbeat_at,
    details: { status, heartbeat_at: ts.heartbeat_at ?? null },
  });

  checks.push({
    key: "terminal_runs_have_finished_at",
    pass:
      status === "succeeded" || status === "failed" || status === "canceled"
        ? !!ts.finished_at
        : true,
    details: { status, finished_at: ts.finished_at ?? null },
  });

  checks.push({
    key: "failed_runs_have_failure_type",
    pass: status === "failed" ? !!summary.failure_type : true,
    details: { status, failure_type: summary.failure_type ?? null },
  });

  checks.push({
    key: "succeeded_runs_mark_completed_stage",
    pass:
      status === "succeeded"
        ? summary.progress_stage === "completed"
        : true,
    details: { status, progress_stage: summary.progress_stage ?? null },
  });

  checks.push({
    key: "attempt_history_present_after_start",
    pass:
      status === "queued"
        ? true
        : Number(lifecycle?.counts?.attempts ?? 0) > 0,
    details: {
      status,
      attempts: Number(lifecycle?.counts?.attempts ?? 0),
    },
  });

  const noSubmitEvidenceCount = Number(
    lifecycle?.evidence_kinds_tally?.no_submit_attestation ?? 0,
  );
  const workerStepEvidenceCount = Number(
    lifecycle?.evidence_kinds_tally?.worker_step_event ?? 0,
  );
  checks.push({
    key: "no_submit_attestation_present_for_succeeded_runs",
    pass: status === "succeeded" ? noSubmitEvidenceCount > 0 : true,
    details: {
      status,
      no_submit_attestation_count: noSubmitEvidenceCount,
    },
  });
  checks.push({
    key: "worker_step_evidence_present_for_succeeded_runs",
    pass: status === "succeeded" ? workerStepEvidenceCount > 0 : true,
    details: {
      status,
      worker_step_event_count: workerStepEvidenceCount,
    },
  });

  return checks;
};

export const getExecutionRunPilotVerificationById = async (
  supabase,
  runId,
  storeId,
) => {
  const lifecycleResult = await getExecutionRunLifecycleById(supabase, runId, storeId);
  if (lifecycleResult.statusCode !== 200) return lifecycleResult;

  const data = lifecycleResult.body;
  const lifecycle = data.lifecycle ?? {};
  const summary = lifecycle.summary ?? {};
  const checks = evaluatePilotVerificationChecks(summary, lifecycle);
  const failed = checks.filter((c) => c.pass !== true);
  const overall_pass = failed.length === 0;

  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: data.run_id,
      store_id: data.store_id,
      cart_id: data.cart_id,
      status: data.status,
      pilot_verification: {
        overall_pass,
        failed_check_count: failed.length,
        checks,
      },
      lifecycle,
    },
  };
};

const derivePilotVerdict = ({ status, overallPass, failedChecks }) => {
  if (overallPass === true && status === "succeeded") {
    return {
      pilot_complete: true,
      verdict_code: "pilot_complete_succeeded",
      next_action: "run_passed_no_submit_pilot_checks",
    };
  }
  if (overallPass === true && status !== "succeeded") {
    return {
      pilot_complete: false,
      verdict_code: "checks_passed_but_not_succeeded",
      next_action: "wait_for_terminal_success_or_finish_run",
    };
  }
  return {
    pilot_complete: false,
    verdict_code: "pilot_verification_failed",
    next_action:
      failedChecks.length > 0
        ? "fix_failed_checks_then_reverify"
        : "inspect_run_and_reverify",
  };
};

export const classifyPilotRunTriageBucket = ({
  summary,
  verdict,
  failedChecks,
}) => {
  if (verdict?.pilot_complete === true) return "pilot_complete";

  const failureType = String(summary?.failure_type ?? "");
  const stage = String(summary?.progress_stage ?? "");
  const failed = Array.isArray(failedChecks) ? failedChecks : [];
  const keys = new Set(failed.map((c) => String(c?.key ?? "")));

  if (failureType === "CODE_MISMATCH" || failureType === "OUT_OF_STOCK") {
    return "mapping_blocked";
  }
  if (
    stage === "validate" ||
    failureType === "QUANTITY_RULE_VIOLATION" ||
    keys.has("attempt_history_present_after_start")
  ) {
    return "worker_validation_failed";
  }
  if (stage === "mlcc_preflight" || failureType === "PRECHECK_FAILED") {
    return "preflight_failed";
  }
  if (stage === "mlcc_dry_run_plan" || failureType === "PLAN_BUILD_FAILED") {
    return "dry_run_plan_failed";
  }
  return "pilot_checks_failed";
};

export const getExecutionRunPilotVerdictById = async (supabase, runId, storeId) => {
  const pv = await getExecutionRunPilotVerificationById(supabase, runId, storeId);
  if (pv.statusCode !== 200) return pv;

  const status = pv.body.status ?? null;
  const checks = Array.isArray(pv.body?.pilot_verification?.checks)
    ? pv.body.pilot_verification.checks
    : [];
  const failed_checks = checks.filter((c) => c?.pass !== true);
  const overall_pass = pv.body?.pilot_verification?.overall_pass === true;

  const verdict = derivePilotVerdict({
    status,
    overallPass: overall_pass,
    failedChecks: failed_checks,
  });
  const triage_bucket = classifyPilotRunTriageBucket({
    summary: pv.body?.lifecycle?.summary ?? {},
    verdict,
    failedChecks: failed_checks,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: pv.body.run_id,
      store_id: pv.body.store_id,
      cart_id: pv.body.cart_id,
      status,
      generated_at: new Date().toISOString(),
      verdict,
      triage_bucket,
      failed_checks: failed_checks.map((c) => ({
        key: c.key ?? "unknown",
        details: c.details ?? {},
      })),
      checks_total: checks.length,
      checks_passed: checks.length - failed_checks.length,
    },
  };
};

const compactFailedCheck = (row) => ({
  key: row?.key ?? "unknown",
  details: row?.details && typeof row.details === "object" ? row.details : {},
});

const pickKeyLifecycleHighlights = (lifecycle) => {
  const summary = lifecycle?.summary ?? {};
  const ts = summary?.timestamps ?? {};
  return {
    status: summary?.status ?? null,
    progress_stage: summary?.progress_stage ?? null,
    retry_count: summary?.retry_count ?? 0,
    failure_type: summary?.failure_type ?? null,
    queued_at: ts.queued_at ?? null,
    started_at: ts.started_at ?? null,
    heartbeat_at: ts.heartbeat_at ?? null,
    finished_at: ts.finished_at ?? null,
  };
};

export const getExecutionRunPilotReviewPacketById = async (
  supabase,
  runId,
  storeId,
) => {
  const verdictResult = await getExecutionRunPilotVerdictById(
    supabase,
    runId,
    storeId,
  );
  if (verdictResult.statusCode !== 200) return verdictResult;

  const verificationResult = await getExecutionRunPilotVerificationById(
    supabase,
    runId,
    storeId,
  );
  if (verificationResult.statusCode !== 200) return verificationResult;

  const lifecycle = verificationResult.body.lifecycle ?? {};
  const stepEvidence = Array.isArray(lifecycle?.step_evidence)
    ? lifecycle.step_evidence
    : [];
  const latestStep = stepEvidence.length > 0 ? stepEvidence[stepEvidence.length - 1] : null;
  const noSubmitCount = Number(
    lifecycle?.evidence_kinds_tally?.no_submit_attestation ?? 0,
  );

  const failedChecks = Array.isArray(verdictResult.body?.failed_checks)
    ? verdictResult.body.failed_checks
    : [];

  return {
    statusCode: 200,
    body: {
      success: true,
      run_id: verdictResult.body.run_id,
      store_id: verdictResult.body.store_id,
      cart_id: verdictResult.body.cart_id,
      generated_at: new Date().toISOString(),
      pilot_review_packet: {
        verdict: verdictResult.body.verdict,
        triage_bucket: verdictResult.body.triage_bucket ?? "pilot_checks_failed",
        checks: {
          total: verdictResult.body.checks_total ?? 0,
          passed: verdictResult.body.checks_passed ?? 0,
          failed: failedChecks.length,
        },
        failed_checks: failedChecks.map((r) => compactFailedCheck(r)),
        lifecycle_highlights: pickKeyLifecycleHighlights(lifecycle),
        no_submit_evidence: {
          present: noSubmitCount > 0,
          count: noSubmitCount,
        },
        worker_step_trace: {
          step_count: stepEvidence.length,
          latest_step: latestStep,
          latest_steps: stepEvidence.slice(-5),
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
    patch.failure_details = enrichFailureDetailsWithMlccSignal({
      failureDetails: {
        ...(failureDetails && typeof failureDetails === "object" ? failureDetails : {}),
        classified_type: classifiedType,
        retryable,
        retry_count_before: retryCount,
        max_retries: maxRetries,
        failed_at: nowIso,
      },
      errorMessage: patch.error_message,
      failureType: classifiedType,
    });
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

  if (status === "succeeded") {
    const fin = await finalizeOpenExecutionRunAttempt(
      supabase,
      runId,
      storeId,
      updatedRun,
      "succeeded",
    );
    if (fin.error) return serverError(fin.error.message);
  } else if (status === "failed") {
    const fin = await finalizeOpenExecutionRunAttempt(
      supabase,
      runId,
      storeId,
      updatedRun,
      "failed",
    );
    if (fin.error) return serverError(fin.error.message);
  } else if (status === "canceled") {
    const fin = await finalizeOpenExecutionRunAttempt(
      supabase,
      runId,
      storeId,
      updatedRun,
      "canceled",
    );
    if (fin.error) return serverError(fin.error.message);
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

  const wasRunning = run.status === "running";

  if (Object.keys(patch).length > 0) {
    patch.updated_at = nowIso;
    const { error: patchErr } = await applyExecutionRunPatch(
      supabase,
      runId,
      storeId,
      patch,
    );
    if (patchErr) return serverError(patchErr.message);

    const refreshed = await getExecutionRunById(supabase, runId, storeId);
    if (refreshed.statusCode === 200) {
      const r = refreshed.body.data;
      if (action === OPERATOR_ACTION.CANCEL && wasRunning) {
        const fin = await finalizeOpenExecutionRunAttempt(
          supabase,
          runId,
          storeId,
          r,
          "canceled",
        );
        if (fin.error) return serverError(fin.error.message);
      } else if (r.status === "running") {
        const syncErr = await updateOpenAttemptFromRunningRow(
          supabase,
          runId,
          storeId,
          r,
        );
        if (syncErr.error) return serverError(syncErr.error.message);
      }
    }
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

  const syncErr = await updateOpenAttemptFromRunningRow(
    supabase,
    runId,
    storeId,
    updatedRun,
  );
  if (syncErr.error) {
    return serverError(syncErr.error.message);
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
      const ins = await insertAttemptForClaimedRun(supabase, claimedRun);
      if (ins.error) {
        return serverError(ins.error.message);
      }
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

