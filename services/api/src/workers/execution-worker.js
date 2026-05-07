import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { buildMlccPreflightReport } from "./mlcc-adapter.js";
import { buildMlccDryRunPlan } from "./mlcc-dry-run.js";
import { loginToMilo } from "../rpa/stages/login.js";
import { navigateToProducts } from "../rpa/stages/navigate-to-products.js";
import { addItemsToCart } from "../rpa/stages/add-items-to-cart.js";
import { validateCartOnMilo } from "../rpa/stages/validate-cart.js";
import { checkoutOnMilo } from "../rpa/stages/checkout.js";
import {
  FAILURE_TYPE,
  classifyFailureType,
  isRetryableFailureType,
} from "../services/execution-failure.service.js";
import { loadDecryptedStoreMlccCredentials } from "../services/store-mlcc-credentials.service.js";

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

function normalizePayloadItemsForRpaStages(payloadItems) {
  if (!Array.isArray(payloadItems)) return [];
  return payloadItems.map((item) => ({
    code: item?.bottle?.mlcc_code ?? null,
    quantity: Number(item?.quantity ?? 0),
    bottle_size_ml: Number(item?.bottle?.size_ml ?? 0),
    expected_name: item?.bottle?.name ?? "",
  }));
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

export async function processOneRpaRun({ apiBaseUrl, workerId }) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by local RPA worker",
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
    buildWorkerStepEvidence("claimed", "Run claimed for RPA execution", {
      run_id: run.id,
      worker_id: workerId ?? null,
    }),
  ];

  if (payload?.metadata?.run_type !== "rpa_run") {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker rejected non-RPA payload",
      errorMessage: "Worker in RPA mode claimed a non-RPA run",
      failureType: FAILURE_TYPE.UNKNOWN,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "cart_verification_snapshot",
          stage: "rpa_run_dispatch",
          message: "Payload metadata run_type was not rpa_run",
          attributes: {
            run_type: payload?.metadata?.run_type ?? null,
          },
        }),
        buildNoSubmitAttestationEvidence("rpa_run_dispatch", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "non_rpa_run_claimed",
    };
  }

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
      workerNotes: "RPA payload validation failed in local worker",
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
        buildNoSubmitAttestationEvidence("payload_loaded", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "invalid_payload_shape",
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker missing Supabase environment for mlccLookup",
      errorMessage:
        "RPA worker missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars (required for credential lookup + mlccLookup)",
      failureType: FAILURE_TYPE.UNKNOWN,
      evidence: [
        ...stepEvidence,
        buildNoSubmitAttestationEvidence("rpa_dispatch", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "missing_supabase_env",
    };
  }
  const workerSupabase = createClient(supabaseUrl, supabaseServiceKey);

  // Resolve MLCC credentials with DB-first priority and env fallback.
  // Production: DB has encrypted creds (saved + verified via API endpoints)
  // Test fallback: MILO_USERNAME/MILO_PASSWORD env vars (preserves _test_*.js path)
  let username;
  let password;
  let loginUrl = process.env.MILO_LOGIN_URL || null;
  let credentialSource = null;

  const dbResult = await loadDecryptedStoreMlccCredentials(
    workerSupabase,
    storeId,
  );
  if (dbResult.ok) {
    username = dbResult.credentials.username;
    password = dbResult.credentials.password;
    // Service supplies a default loginUrl; prefer env override if set.
    loginUrl = loginUrl || dbResult.credentials.loginUrl;
    credentialSource = "db";
  } else if (dbResult.code === "LK_DECRYPT_FAILED") {
    // Hard fail — corrupted ciphertext or missing/wrong encryption key.
    // Never fall back to env in this case; the operator needs to know.
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker could not decrypt stored MLCC credentials",
      errorMessage: dbResult.error,
      failureType: FAILURE_TYPE.UNKNOWN,
      failureDetails: { code: "LK_DECRYPT_FAILED" },
      evidence: [
        ...stepEvidence,
        buildWorkerStepEvidence(
          "rpa_login",
          "Decryption of stored credentials failed",
          {
            credential_source_attempted: "db",
            error_code: "LK_DECRYPT_FAILED",
          },
        ),
        buildNoSubmitAttestationEvidence("rpa_login", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "credential_decrypt_failed",
    };
  } else {
    // No creds in DB — fall back to env vars (preserves test path)
    const envUser = process.env.MILO_USERNAME;
    const envPass = process.env.MILO_PASSWORD;
    if (envUser && envPass) {
      username = envUser;
      password = envPass;
      credentialSource = "env";
    }
  }

  if (!username || !password) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker has no MLCC credentials available (DB or env)",
      errorMessage:
        "No MLCC credentials available: stores.mlcc_password_encrypted is empty AND MILO_USERNAME/MILO_PASSWORD env vars are unset",
      failureType: FAILURE_TYPE.UNKNOWN,
      failureDetails: { code: "LK_NO_CREDENTIALS" },
      evidence: [
        ...stepEvidence,
        buildWorkerStepEvidence(
          "rpa_login",
          "No credentials available from DB or env",
          {
            db_lookup_status: dbResult.ok
              ? "ok"
              : (dbResult.code || "no_credentials_on_file"),
            env_username_present: !!process.env.MILO_USERNAME,
            env_password_present: !!process.env.MILO_PASSWORD,
          },
        ),
        buildNoSubmitAttestationEvidence("rpa_login", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "missing_credentials",
    };
  }

  // Trace which credential source was used (NEVER include username/password)
  stepEvidence.push(
    buildWorkerStepEvidence("rpa_login", "MLCC credential source resolved", {
      credential_source: credentialSource,
      has_loginurl_override: !!process.env.MILO_LOGIN_URL,
    }),
  );

  const normalizedItems = normalizePayloadItemsForRpaStages(payload.items);
  const invalidItems = normalizedItems.filter(
    (item) =>
      typeof item?.code !== "string" ||
      item.code.trim() === "" ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0,
  );
  if (invalidItems.length > 0) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker found invalid cart item mapping for stage 3",
      errorMessage:
        "Cart items have missing or invalid mlcc_code/quantity for RPA execution",
      failureType: FAILURE_TYPE.UNKNOWN,
      failureDetails: { invalid_items: invalidItems.length },
      evidence: [
        ...stepEvidence,
        buildNoSubmitAttestationEvidence("rpa_add_items", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "invalid_rpa_items",
    };
  }

  const licenseNumber =
    payload?.metadata?.license_number ??
    payload?.store?.liquor_license ??
    process.env.MILO_TEST_LICENSE ??
    null;
  const normalizedLicenseNumber = String(licenseNumber ?? "").trim();
  if (normalizedLicenseNumber === "") {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker missing license number",
      errorMessage:
        "RPA worker could not resolve license number from payload.store.liquor_license, payload.metadata.license_number, or MILO_TEST_LICENSE env",
      failureType: FAILURE_TYPE.UNKNOWN,
      evidence: [
        ...stepEvidence,
        buildNoSubmitAttestationEvidence("rpa_navigate", "rpa_run"),
      ],
    });
    return {
      success: false,
      claimed: true,
      failed: true,
      runId: run.id,
      reason: "missing_license_number",
    };
  }

  const mlccLookup = async (codes) => {
    if (!Array.isArray(codes) || codes.length === 0) return {};
    const { data, error } = await workerSupabase
      .from("mlcc_items")
      .select("code, ada_number")
      .in("code", codes);
    if (error) {
      throw new Error(`mlccLookup failed: ${error.message}`);
    }
    const result = {};
    for (const row of data ?? []) {
      if (row.code) {
        result[row.code] = { ada_number: row.ada_number ?? null };
      }
    }
    return result;
  };

  const requestedMode = payload?.metadata?.mode ?? "dry_run";
  const envAllow = process.env.LK_ALLOW_ORDER_SUBMISSION === "yes";
  const stage5Mode =
    requestedMode === "submit" && envAllow ? "submit" : "dry_run";
  const allowOrderSubmission = stage5Mode === "submit";

  let session;
  let checkedOut;
  try {
    await heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage: "rpa_login",
      progressMessage: "Starting RPA Stage 1: login",
    });
    stepEvidence.push(
      buildWorkerStepEvidence("rpa_login_started", "RPA Stage 1 started", {
        stage: 1,
      }),
    );

    try {
      session = await loginToMilo(
        {
          username,
          password,
          ...(loginUrl ? { loginUrl } : {}),
        },
        {
          headless: process.env.WORKER_HEADFUL !== "1",
          slowMo: process.env.WORKER_HEADFUL === "1" ? 250 : 0,
          captureArtifacts: true,
        },
      );
    } catch (loginError) {
      const failure = summarizeFailure(
        loginError?.message ?? "RPA Stage 1 login failed",
        loginError?.code ?? FAILURE_TYPE.UNKNOWN,
        {
          stage: "stage1_login",
          details:
            loginError?.details && typeof loginError.details === "object"
              ? loginError.details
              : {},
        },
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "RPA Stage 1 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: failure.details,
        evidence: [
          ...stepEvidence,
          buildNoSubmitAttestationEvidence("stage1_login", "rpa_run"),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: true,
        runId: run.id,
        stage: "stage1_login",
        error: loginError?.code ?? FAILURE_TYPE.UNKNOWN,
      };
    }

    stepEvidence.push(
      buildWorkerStepEvidence("rpa_login_complete", "Stage 1 login succeeded", {
        current_url: session?.page?.url?.() ?? session?.currentUrl ?? null,
      }),
    );

    await heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage: "rpa_navigate",
      progressMessage: "Starting RPA Stage 2: navigate to products",
    });
    stepEvidence.push(
      buildWorkerStepEvidence(
        "rpa_navigate_started",
        "RPA Stage 2 started",
        { stage: 2 },
      ),
    );

    try {
      session = await navigateToProducts(session, {
        licenseNumber: normalizedLicenseNumber,
        captureArtifacts: true,
      });
    } catch (stage2Error) {
      const failure = summarizeFailure(
        stage2Error?.message ?? "RPA Stage 2 navigation failed",
        stage2Error?.code ?? FAILURE_TYPE.UNKNOWN,
        {
          stage: "stage2_navigate",
          details:
            stage2Error?.details && typeof stage2Error.details === "object"
              ? stage2Error.details
              : {},
        },
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "RPA Stage 2 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: failure.details,
        evidence: [
          ...stepEvidence,
          buildNoSubmitAttestationEvidence("stage2_navigate", "rpa_run"),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: true,
        runId: run.id,
        stage: "stage2_navigate",
        error: stage2Error?.code ?? FAILURE_TYPE.UNKNOWN,
      };
    }

    stepEvidence.push(
      buildWorkerStepEvidence(
        "rpa_navigate_complete",
        "Stage 2 navigation succeeded",
        { current_url: session?.currentUrl ?? session?.page?.url?.() ?? null },
      ),
    );

    await heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage: "rpa_add_items",
      progressMessage: "Starting RPA Stage 3: add items to cart",
    });
    stepEvidence.push(
      buildWorkerStepEvidence(
        "rpa_add_items_started",
        "RPA Stage 3 started",
        { stage: 3, item_count: normalizedItems.length },
      ),
    );

    try {
      session = await addItemsToCart(session, normalizedItems, {
        captureArtifacts: true,
        mlccLookup,
      });
    } catch (stage3Error) {
      const failure = summarizeFailure(
        stage3Error?.message ?? "RPA Stage 3 add items failed",
        stage3Error?.code ?? FAILURE_TYPE.UNKNOWN,
        {
          stage: "stage3_add_items",
          details:
            stage3Error?.details && typeof stage3Error.details === "object"
              ? stage3Error.details
              : {},
        },
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "RPA Stage 3 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: failure.details,
        evidence: [
          ...stepEvidence,
          buildNoSubmitAttestationEvidence("stage3_add_items", "rpa_run"),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: true,
        runId: run.id,
        stage: "stage3_add_items",
        error: stage3Error?.code ?? FAILURE_TYPE.UNKNOWN,
      };
    }

    stepEvidence.push(
      buildWorkerStepEvidence("rpa_add_items_complete", "Stage 3 succeeded", {
        items_added: Array.isArray(session?.itemsAdded)
          ? session.itemsAdded.length
          : null,
        items_rejected: Array.isArray(session?.itemsRejected)
          ? session.itemsRejected.length
          : null,
      }),
    );

    await heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage: "rpa_validate",
      progressMessage: "Starting RPA Stage 4: validate cart",
    });
    stepEvidence.push(
      buildWorkerStepEvidence("rpa_validate_started", "RPA Stage 4 started", {
        stage: 4,
      }),
    );

    try {
      session = await validateCartOnMilo(session, {
        captureArtifacts: true,
      });
    } catch (stage4Error) {
      const failure = summarizeFailure(
        stage4Error?.message ?? "RPA Stage 4 validate cart failed",
        stage4Error?.code ?? FAILURE_TYPE.UNKNOWN,
        {
          stage: "stage4_validate",
          details:
            stage4Error?.details && typeof stage4Error.details === "object"
              ? stage4Error.details
              : {},
        },
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "RPA Stage 4 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: failure.details,
        evidence: [
          ...stepEvidence,
          buildNoSubmitAttestationEvidence("stage4_validate", "rpa_run"),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: true,
        runId: run.id,
        stage: "stage4_validate",
        error: stage4Error?.code ?? FAILURE_TYPE.UNKNOWN,
      };
    }

    stepEvidence.push(
      buildWorkerStepEvidence(
        "rpa_validate_complete",
        "Stage 4 validation succeeded",
        {
          can_checkout: session?.canCheckout ?? null,
          out_of_stock_count: Array.isArray(session?.outOfStockItems)
            ? session.outOfStockItems.length
            : null,
        },
      ),
    );

    await heartbeatRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      workerId,
      progressStage: "rpa_checkout",
      progressMessage: "Starting RPA Stage 5: checkout",
    });
    stepEvidence.push(
      buildWorkerStepEvidence("rpa_checkout_started", "RPA Stage 5 started", {
        stage: 5,
        mode: stage5Mode,
      }),
    );

    try {
      checkedOut = await checkoutOnMilo(session, {
        mode: stage5Mode,
        allowOrderSubmission,
        timeoutMs: 60_000,
      });
    } catch (stage5Error) {
      const failure = summarizeFailure(
        stage5Error?.message ?? "RPA Stage 5 checkout failed",
        stage5Error?.code ?? FAILURE_TYPE.UNKNOWN,
        {
          stage: "stage5_checkout",
          details:
            stage5Error?.details && typeof stage5Error.details === "object"
              ? stage5Error.details
              : {},
        },
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: "RPA Stage 5 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: failure.details,
        evidence: [
          ...stepEvidence,
          buildNoSubmitAttestationEvidence("stage5_checkout", "rpa_run"),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: true,
        runId: run.id,
        stage: "stage5_checkout",
        error: stage5Error?.code ?? FAILURE_TYPE.UNKNOWN,
      };
    }

    stepEvidence.push(
      buildWorkerStepEvidence(
        "rpa_checkout_complete",
        "Stage 5 checkout completed",
        {
          mode: checkedOut?.mode ?? stage5Mode,
          submitted: checkedOut?.submitted ?? false,
        },
      ),
    );

    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "succeeded",
      workerNotes:
        stage5Mode === "dry_run"
          ? "RPA run completed in dry_run mode; cart prepared but NOT submitted"
          : "RPA run completed with live submission",
      errorMessage: undefined,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "rpa_run_summary",
          stage: "rpa_complete",
          message:
            stage5Mode === "dry_run"
              ? "RPA pipeline completed in dry_run mode"
              : "RPA pipeline completed with submission",
          attributes: {
            mode: checkedOut?.mode,
            submitted: checkedOut?.submitted,
            confirmation_numbers: checkedOut?.confirmationNumbers,
            stage5_duration_ms: checkedOut?.stage5DurationMs,
            current_url: checkedOut?.currentUrl,
            output_dir: checkedOut?.outputDir,
            dry_run_reason: checkedOut?.dryRunReason ?? null,
          },
        }),
        ...(stage5Mode === "dry_run"
          ? [buildNoSubmitAttestationEvidence("rpa_complete", "rpa_run")]
          : []),
      ],
    });

    return {
      success: true,
      claimed: true,
      runId: run.id,
      mode: checkedOut?.mode,
      submitted: checkedOut?.submitted,
      confirmationNumbers: checkedOut?.confirmationNumbers ?? null,
      dryRunReason: checkedOut?.dryRunReason ?? null,
      stage5DurationMs: checkedOut?.stage5DurationMs,
    };
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);

if (isMainModule) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const workerId = process.env.WORKER_ID ?? "local-worker-1";
  const workerMode = process.env.WORKER_MODE ?? "generic";

  try {
    let result;
    if (workerMode === "rpa_run") {
      result = await processOneRpaRun({ apiBaseUrl, workerId });
    } else if (workerMode === "mlcc_dry_run") {
      result = await processOneMlccDryRun({ apiBaseUrl, workerId });
    } else {
      result = await processOneRun({ apiBaseUrl, workerId });
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
