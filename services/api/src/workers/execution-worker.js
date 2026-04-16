import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildMlccPreflightReport } from "./mlcc-adapter.js";
import { buildMlccDryRunPlan } from "./mlcc-dry-run.js";
import {
  FAILURE_TYPE,
  classifyFailureType,
  isRetryableFailureType,
} from "../services/execution-failure.service.js";

function joinApiPath(apiBaseUrl, pathname) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const pathPart = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return `${base}${pathPart}`;
}

async function readJsonResponse(res) {
  const text = await res.text();
  let body;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON response (HTTP ${res.status})`);
  }

  return body;
}

function httpErrorMessage(status, body) {
  if (body && typeof body.error === "string") {
    return body.error;
  }

  return `HTTP ${status}`;
}

function summarizeFailure(message, explicitType, details = {}) {
  const failureType = classifyFailureType({
    errorMessage: message,
    explicitType,
  });
  return {
    failureType,
    retryable: isRetryableFailureType(failureType),
    message,
    details,
  };
}

function buildEvidenceEntry({
  kind,
  stage,
  message,
  path = null,
  contentType = null,
  attributes = {},
}) {
  return {
    kind,
    stage,
    message,
    artifact_path: path,
    content_type: contentType,
    attributes,
    created_at: new Date().toISOString(),
  };
}

function buildNoSubmitAttestationEvidence(stage, mode) {
  return buildEvidenceEntry({
    kind: "no_submit_attestation",
    stage,
    message: "No live MLCC submission behavior executed in this worker flow",
    attributes: {
      mode,
      no_submit_policy: true,
      forbidden_actions: [
        "submit_order",
        "confirm_purchase",
        "final_place_order_click",
      ],
    },
  });
}

function buildWorkerStepEvidence(stage, message, attrs = {}) {
  return buildEvidenceEntry({
    kind: "worker_step_event",
    stage,
    message,
    attributes: attrs,
  });
}

export function assertDeterministicExecutionPayload(payload) {
  if (!payload || !Array.isArray(payload.items) || !payload.summary) {
    return {
      ok: false,
      code: FAILURE_TYPE.UNKNOWN,
      message: "Execution payload missing items or summary for deterministic assertions",
      details: { reason: "payload_shape_invalid" },
    };
  }

  const itemCount = payload.items.length;
  const expectedItemCount = Number(payload.summary.itemCount ?? -1);
  if (!Number.isInteger(expectedItemCount) || expectedItemCount !== itemCount) {
    return {
      ok: false,
      code: FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
      message: "Summary itemCount mismatch",
      details: { expectedItemCount, actualItemCount: itemCount },
    };
  }

  const totalQuantity = payload.items.reduce(
    (sum, item) => sum + Number(item?.quantity ?? 0),
    0,
  );
  const expectedTotalQuantity = Number(payload.summary.totalQuantity ?? -1);
  if (expectedTotalQuantity !== totalQuantity) {
    return {
      ok: false,
      code: FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
      message: "Summary totalQuantity mismatch",
      details: { expectedTotalQuantity, actualTotalQuantity: totalQuantity },
    };
  }

  const seenCartItemIds = new Set();
  for (const item of payload.items) {
    if (!item?.cartItemId || !item?.bottleId || !item?.bottle) {
      return {
        ok: false,
        code: FAILURE_TYPE.UNKNOWN,
        message: "Payload item missing identifiers",
        details: { item },
      };
    }

    if (seenCartItemIds.has(item.cartItemId)) {
      return {
        ok: false,
        code: FAILURE_TYPE.UNKNOWN,
        message: "Duplicate cartItemId detected",
        details: { cartItemId: item.cartItemId },
      };
    }
    seenCartItemIds.add(item.cartItemId);

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        ok: false,
        code: FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
        message: "Item quantity is not a positive integer",
        details: { cartItemId: item.cartItemId, quantity: item.quantity },
      };
    }

    const mlccCode = String(item.bottle.mlcc_code ?? "").trim();
    if (!mlccCode) {
      return {
        ok: false,
        code: FAILURE_TYPE.CODE_MISMATCH,
        message: "Item bottle is missing MLCC code",
        details: { cartItemId: item.cartItemId, bottleId: item.bottleId },
      };
    }

    // No substitution: the bottle embedded in payload must represent the same id.
    if (item.bottle.id && item.bottle.id !== item.bottleId) {
      return {
        ok: false,
        code: FAILURE_TYPE.CODE_MISMATCH,
        message: "Unexpected bottle substitution detected",
        details: {
          cartItemId: item.cartItemId,
          expectedBottleId: item.bottleId,
          actualBottleId: item.bottle.id,
        },
      };
    }
  }

  return { ok: true };
}

function serviceRoleHeaders(storeId) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for authenticated API worker calls",
    );
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };

  if (storeId) {
    headers["X-Store-Id"] = storeId;
  }

  return headers;
}

export async function claimNextRun({ apiBaseUrl, workerId, workerNotes }) {
  const url = joinApiPath(apiBaseUrl, "/execution-runs/claim-next");
  const res = await fetch(url, {
    method: "POST",
    headers: serviceRoleHeaders(),
    body: JSON.stringify({ workerId, workerNotes }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function heartbeatRun({
  apiBaseUrl,
  runId,
  storeId,
  workerId,
  progressStage,
  progressMessage,
  workerNotes,
}) {
  const url = joinApiPath(apiBaseUrl, `/execution-runs/${runId}/heartbeat`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: serviceRoleHeaders(storeId),
    body: JSON.stringify({
      workerId,
      progressStage,
      progressMessage,
      workerNotes,
    }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function finalizeRun({
  apiBaseUrl,
  runId,
  storeId,
  status,
  workerNotes,
  errorMessage,
  failureType,
  failureDetails,
  evidence,
}) {
  const url = joinApiPath(apiBaseUrl, `/execution-runs/${runId}/status`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: serviceRoleHeaders(storeId),
    body: JSON.stringify({
      status,
      workerNotes,
      errorMessage,
      failureType,
      failureDetails,
      evidence,
    }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function processOneRun({ apiBaseUrl, workerId }) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by local execution worker",
  });

  if (claimBody.data === null) {
    return {
      success: true,
      claimed: false,
    };
  }

  const { run, payload } = claimBody.data;
  const storeId = run.store_id;
  const stepEvidence = [];
  stepEvidence.push(
    buildWorkerStepEvidence("claimed", "Run claimed by local execution worker", {
      run_id: run.id,
      worker_id: workerId ?? null,
    }),
  );

  if (
    !payload ||
    !payload.cart ||
    !payload.store ||
    !Array.isArray(payload.items)
  ) {
    const failure = summarizeFailure(
      "Execution payload missing required fields",
      FAILURE_TYPE.UNKNOWN,
      { stage: "payload_loaded" },
    );
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "payload validation failed in local worker",
      errorMessage: failure.message,
      failureType: failure.failureType,
      failureDetails: failure.details,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "cart_verification_snapshot",
          stage: "payload_loaded",
          message: "Payload shape was invalid",
          attributes: { payload_present: !!payload },
        }),
        buildNoSubmitAttestationEvidence("payload_loaded", "local_execution"),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "add_by_code",
    progressMessage: "Execution payload loaded",
  });
  stepEvidence.push(
    buildWorkerStepEvidence("payload_loaded", "Execution payload loaded", {
      item_count: Array.isArray(payload?.items) ? payload.items.length : 0,
    }),
  );

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "validate",
    progressMessage: "Validating payload and quantity rules",
  });
  stepEvidence.push(
    buildWorkerStepEvidence(
      "validate",
      "Worker started deterministic payload assertions",
      {},
    ),
  );

  const deterministic = assertDeterministicExecutionPayload(payload);
  if (!deterministic.ok) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "deterministic assertion failed in local execution worker",
      errorMessage: deterministic.message,
      failureType: deterministic.code,
      failureDetails: {
        ...(deterministic.details && typeof deterministic.details === "object"
          ? deterministic.details
          : {}),
        stage: "validate",
      },
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "cart_verification_snapshot",
          stage: "validate",
          message: deterministic.message,
          attributes: deterministic.details ?? {},
        }),
        buildNoSubmitAttestationEvidence("validate", "local_execution"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "assertions_passed",
    progressMessage: "Deterministic assertions passed",
  });
  stepEvidence.push(
    buildWorkerStepEvidence(
      "assertions_passed",
      "Deterministic payload assertions passed",
      {},
    ),
  );

  await finalizeRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    status: "succeeded",
    workerNotes: "completed by local execution worker",
    errorMessage: undefined,
    evidence: [
      ...stepEvidence,
      buildNoSubmitAttestationEvidence("worker_completion", "local_execution"),
    ],
  });

  return {
    success: true,
    claimed: true,
    runId: run.id,
  };
}

export async function preflightClaimedRunPayload({ apiBaseUrl, workerId }) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by local execution worker",
  });

  if (claimBody.data === null) {
    return {
      success: true,
      claimed: false,
    };
  }

  const { run, payload } = claimBody.data;
  const storeId = run.store_id;
  const preflight = buildMlccPreflightReport(payload);
  const stepEvidence = [
    buildWorkerStepEvidence("claimed", "Run claimed for MLCC preflight", {
      run_id: run.id,
      worker_id: workerId ?? null,
    }),
  ];

  if (!preflight.ready) {
    const errorMessage = preflight.errors.map((e) => e.message).join("; ");
    const failure = summarizeFailure(
      errorMessage,
      FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
      {
        stage: "mlcc_preflight",
        preflightErrors: preflight.errors,
      },
    );

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "MLCC preflight failed in local execution worker",
      errorMessage: failure.message,
      failureType: failure.failureType,
      failureDetails: failure.details,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "learned_qty_rule_dump",
          stage: "mlcc_preflight",
          message: "MLCC preflight validation failed",
          attributes: { errors: preflight.errors },
        }),
        buildNoSubmitAttestationEvidence("mlcc_preflight", "mlcc_preflight"),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      preflight,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "mlcc_preflight_ready",
    progressMessage: "MLCC preflight completed successfully",
    workerNotes: "MLCC preflight passed in local execution worker",
  });
  stepEvidence.push(
    buildWorkerStepEvidence(
      "mlcc_preflight_ready",
      "MLCC preflight completed successfully",
      {
        plan_item_count: Array.isArray(preflight?.items) ? preflight.items.length : null,
      },
    ),
  );

  return {
    success: true,
    claimed: true,
    runId: run.id,
    preflight,
  };
}

export async function processOneMlccDryRun({ apiBaseUrl, workerId }) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by local MLCC dry-run worker",
  });

  if (claimBody.data === null) {
    return {
      success: true,
      claimed: false,
    };
  }

  const { run, payload } = claimBody.data;
  const storeId = run.store_id;
  const stepEvidence = [
    buildWorkerStepEvidence("claimed", "Run claimed for MLCC dry-run plan", {
      run_id: run.id,
      worker_id: workerId ?? null,
    }),
  ];
  const planResult = buildMlccDryRunPlan(payload);

  if (!planResult.ready) {
    const errorMessage = planResult.errors.map((e) => e.message).join("; ");
    const failure = summarizeFailure(
      errorMessage,
      FAILURE_TYPE.QUANTITY_RULE_VIOLATION,
      { stage: "mlcc_dry_run_plan", planErrors: planResult.errors },
    );

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "MLCC dry run failed during plan generation",
      errorMessage: failure.message,
      failureType: failure.failureType,
      failureDetails: failure.details,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "learned_qty_rule_dump",
          stage: "mlcc_dry_run_plan",
          message: "Dry-run plan generation failed",
          attributes: { errors: planResult.errors },
        }),
        buildNoSubmitAttestationEvidence("mlcc_dry_run_plan", "mlcc_dry_run"),
      ],
    });

    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      plan: null,
      errors: planResult.errors,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    workerId,
    progressStage: "mlcc_dry_run_plan_ready",
    progressMessage: "MLCC dry-run plan generated successfully",
    workerNotes: "MLCC dry-run plan ready",
  });
  stepEvidence.push(
    buildWorkerStepEvidence(
      "mlcc_dry_run_plan_ready",
      "MLCC dry-run plan generated successfully",
      {
        plan_item_count: Array.isArray(planResult?.plan?.items)
          ? planResult.plan.items.length
          : null,
      },
    ),
  );

  await finalizeRun({
    apiBaseUrl,
    runId: run.id,
    storeId,
    status: "succeeded",
    workerNotes:
      "MLCC dry run completed successfully; no live MLCC actions were performed",
    errorMessage: undefined,
    evidence: [
      ...stepEvidence,
      buildNoSubmitAttestationEvidence("mlcc_dry_run_done", "mlcc_dry_run"),
    ],
  });

  return {
    success: true,
    claimed: true,
    runId: run.id,
    plan: planResult.plan,
  };
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);

if (isMainModule) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const workerId = process.env.WORKER_ID ?? "local-worker-1";

  try {
    const result = await processOneRun({ apiBaseUrl, workerId });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
