import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { makeBoundedFetch, resolveDbFetchTimeoutMs } from "../lib/bounded-fetch.js";

import { buildMlccPreflightReport } from "./mlcc-adapter.js";
import { buildMlccDryRunPlan } from "./mlcc-dry-run.js";
import { uploadRunArtifacts, formatUploadSummary } from "../lib/run-artifacts-storage.js";
import { captureRunFailure, captureSubmittedUnconfirmed } from "../lib/sentry.js";
import { loginToMilo } from "../rpa/stages/login.js";
import { navigateToProducts } from "../rpa/stages/navigate-to-products.js";
import { addItemsToCart, clearMiloCart } from "../rpa/stages/add-items-to-cart.js";
import { validateCartOnMilo } from "../rpa/stages/validate-cart.js";
import { checkoutOnMilo, navigateToOrdersAndCapture } from "../rpa/stages/checkout.js";
import { buildAndValidateViaApi, submitCartViaApi } from "../rpa/engine/engine-api.js";
import { attachMiloProductCache } from "../rpa/engine/attach-product-cache.js";
import {
  getNodeMiloSession,
  invalidateNodeMiloSession,
  MiloNodeLoginError,
} from "../rpa/engine/milo-node-session.js";
import {
  fetchMiloOrders,
  normalizeMiloApiOrder,
  selectOrdersForSubmit,
  buildConfirmationMapFromOrders,
} from "../rpa/engine/engine-orders.js";
import { assertSubmitMachineryAllowed } from "./submit-guard.js";
import {
  acquireSession,
  attachFreshSession,
  releaseSession,
} from "./rpa-session-manager.js";
import { persistMiloOrderConfirmations } from "../services/milo-order-confirmations.service.js";
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

// P0 (2026-06-14): claimNextRun/heartbeatRun/finalizeRun's fetch() calls had
// NO timeout. On 2026-06-14 16:03 UTC the worker→API connection went bad and
// every fetch() hung for 2-15 MINUTES before finally throwing "fetch failed"
// — for 4.5+ hours straight. During that window a real $4000 validate run sat
// at zero stage progress for the full 5-minute client poll and timed out,
// because the worker couldn't even CLAIM it in bounded time. "fetch failed"
// doesn't match isTransientUpstreamError's HTTP-5xx regex either, so it also
// got the slow 30s ERROR_BACKOFF_MS instead of the fast transient path.
// Bounding every API call to API_FETCH_TIMEOUT_MS turns "hang for minutes" —
// or hours — into "fail in 20s and retry on the fast path" (see
// run-rpa-worker.js's updated isTransientUpstreamError).
const API_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`Fetch timeout after ${API_FETCH_TIMEOUT_MS / 1000}s: ${url}`);
    }
    throw err;
  }
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
  const res = await fetchWithTimeout(url, {
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
  const res = await fetchWithTimeout(url, {
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
  const res = await fetchWithTimeout(url, {
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

/*
 * Duplicate-submit tripwire query (AUDIT #20, extracted 2026-07-22 so the
 * node engine-submit branch and the browser Stage-5 path share ONE
 * definition of "a recent ambiguous checkout death"). Failure types in the
 * safe set are DEFINITIVE no-order outcomes; anything else that died at
 * rpa_checkout inside the window might have placed an order.
 */
const SAFE_CHECKOUT_FAILURE_TYPES = new Set([
  "MILO_STAGE5_ERROR_TOAST",
  "MILO_STAGE5_SAFETY_GATE_VIOLATION",
  "MLCC_CART_MISMATCH_BEFORE_SUBMIT",
]);

async function fetchAmbiguousCheckoutDeaths(workerSupabase, storeId, windowMinutes = 30) {
  const cutoffIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data, error } = await workerSupabase
    .from("execution_runs")
    .select("id, finished_at, progress_stage, failure_type")
    .eq("store_id", storeId)
    .eq("status", "failed")
    .gte("finished_at", cutoffIso)
    .eq("progress_stage", "rpa_checkout");
  if (error) {
    return { error: error.message, ambiguousDeaths: null };
  }
  const ambiguousDeaths = (data ?? []).filter(
    (r) => !SAFE_CHECKOUT_FAILURE_TYPES.has(String(r.failure_type ?? "")),
  );
  return { error: null, ambiguousDeaths };
}

/**
 * Pre-map: attach cached MILO productIds (mlcc_items.milo_product_id /
 * milo_distributor) so the engine skips the per-code /products/code resolves
 * (~1.3s each). PURE OPTIMIZATION — any lookup failure logs and returns the
 * items unchanged, so the order still runs identically via live resolve
 * (never blocked). Extracted 2026-07-18 so the node-direct and browser
 * engine branches share one implementation.
 */
async function attachProductCacheOrFallback(workerSupabase, normalizedItems) {
  try {
    const cartCodes = normalizedItems.map((i) => String(i.code));
    const { data: cacheRows, error: cacheErr } = await workerSupabase
      .from("mlcc_items")
      .select("code, milo_product_id, milo_distributor")
      .in("code", cartCodes)
      .not("milo_product_id", "is", null);
    if (cacheErr) {
      console.warn(`[engine] productId cache lookup failed — live resolve fallback: ${cacheErr.message}`);
      return normalizedItems;
    }
    const merged = attachMiloProductCache(normalizedItems, cacheRows);
    console.log(`[engine] productId cache: ${merged.hits}/${normalizedItems.length} cart codes pre-mapped`);
    return merged.items;
  } catch (cacheLookupError) {
    console.warn(`[engine] productId cache lookup threw — live resolve fallback: ${cacheLookupError?.message ?? cacheLookupError}`);
    return normalizedItems;
  }
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

  /*
   * Timing instrumentation (2026-07-18, speed dig).
   *
   * A warm-session validate showed ~5s between the Stage-5 arming log and
   * the first engine call, and the whole claim→arming stretch (payload
   * fetch, credential decrypt, readiness checks) was never measured at
   * all — so "where does the time go" was guesswork. These marks attribute
   * every phase, so the next optimization pass cuts what the numbers name.
   *
   * Measured floor for reference (run a88bd06f, warm, 2026-07-18): MILO's
   * own API critical path is ~2.4s, of which GET /validate alone is 1.87s.
   * Anything we shave has to come from OUR overhead, not theirs.
   *
   * Log-only — no control flow reads these values.
   */
  const tClaimed = Date.now();
  const msSince = () => Date.now() - tClaimed;

  const stepEvidence = [
    buildWorkerStepEvidence("claimed", "Run claimed for RPA execution", {
      run_id: run.id,
      worker_id: workerId ?? null,
    }),
  ];

  // Both "rpa_run" and "validate_only" are accepted by this worker path.
  // validate_only is the scanner's "Validate against MLCC" button — runs
  // Stages 1-4 and stops; Stage 5 is never invoked. (Phase 1 Week 1 of
  // the V1 roadmap, 2026-05-30.)
  const acceptedRunTypes = new Set([
    "rpa_run",
    "validate_only",
    "cart_reset_only",
  ]);
  const runType = payload?.metadata?.run_type ?? null;
  const isValidateOnly = runType === "validate_only";
  const orderEngine = (process.env.LK_ORDER_ENGINE || "rpa").toLowerCase();
  const isCartResetOnly = runType === "cart_reset_only";
  if (!acceptedRunTypes.has(runType)) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      storeId,
      status: "failed",
      workerNotes: "RPA worker rejected unrecognized run_type payload",
      errorMessage: `Worker accepts rpa_run | validate_only; got ${runType}`,
      failureType: FAILURE_TYPE.UNKNOWN,
      evidence: [
        ...stepEvidence,
        buildEvidenceEntry({
          kind: "cart_verification_snapshot",
          stage: "rpa_run_dispatch",
          message: "Payload metadata run_type was not in accepted set",
          attributes: {
            run_type: runType,
            accepted: [...acceptedRunTypes],
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
      reason: "unrecognized_run_type",
    };
  }

  /*
   * Payload shape guard. cart_reset_only intentionally has no cart/items
   * payload — its payload_snapshot is just { metadata, items: [] } — so
   * we skip this check for that run type. The cart-reset branch below
   * loads everything it needs (creds, license) from storeId directly.
   */
  if (
    !isCartResetOnly &&
    (!payload ||
      !payload.cart ||
      !payload.store ||
      !Array.isArray(payload.items))
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
  // Bounded DB calls (2026-07-11): same wedge-class protection as the API's
  // shared client — a hung socket to Supabase fails loud in ≤15s instead of
  // stalling the run. Failures here already fall back to live resolve.
  const workerSupabase = createClient(supabaseUrl, supabaseServiceKey, {
    global: { fetch: makeBoundedFetch(resolveDbFetchTimeoutMs(process.env.LK_DB_FETCH_TIMEOUT_MS)) },
  });

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
      // Precise code (audit 2026-06-12): the classifier preserves typed
      // codes now — UNKNOWN here hid an actionable "re-enter credentials".
      failureType: "LK_DECRYPT_FAILED",
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
      failureType: "LK_NO_CREDENTIALS",
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
      failureType: "LK_INVALID_RPA_ITEMS",
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
      failureType: "LK_MISSING_LICENSE_NUMBER",
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
      .select("code, ada_number, case_size")
      .in("code", codes);
    if (error) {
      throw new Error(`mlccLookup failed: ${error.message}`);
    }
    const result = {};
    for (const row of data ?? []) {
      if (row.code) {
        result[row.code] = {
          ada_number: row.ada_number ?? null,
          case_size: row.case_size ?? null,
        };
      }
    }
    return result;
  };

  // Stage 5 arming (2026-07-23 — env retired from a required arm to a
  // break-glass KILL; see docs/lk/architecture/submit-arming-model.md):
  //   1. Caller must request mode='submit' in execution run metadata (only
  //      set after the deliberate check → place-gate → confirm flow).
  //   2. The store row must have allow_order_submission=true ("this is a real
  //      store, not a demo" — set once per store, the real gate).
  //   3. env LK_ALLOW_ORDER_SUBMISSION must NOT equal "no" — it is now an
  //      EMERGENCY BREAK-GLASS kill only. Absent/anything-but-"no" permits;
  //      set it to "no" on Fly to instantly hard-disable ALL submission fleet-
  //      wide with no deploy. You never need it to arm; you can hit it to kill.
  //
  // Bias stays toward dry_run: any ambiguity (mode not submit, store not
  // enabled, or the kill set) falls back to a harmless practice run.
  const requestedMode = payload?.metadata?.mode ?? "dry_run";
  const envKilled = process.env.LK_ALLOW_ORDER_SUBMISSION === "no";

  // Per-store check. If the column read fails (network error, RLS
  // surprise, table not migrated yet), default to disarmed — safest
  // behavior is to refuse submission rather than risk a stale-read
  // false-positive.
  let storeAllowsSubmission = false;
  try {
    const { data: storeRow, error: storeErr } = await workerSupabase
      .from("stores")
      .select("allow_order_submission")
      .eq("id", storeId)
      .maybeSingle();
    if (storeErr) {
      console.warn(
        `[worker] could not read stores.allow_order_submission for store ${storeId}: ${storeErr.message} — defaulting to disarmed (dry_run only)`,
      );
    } else if (storeRow?.allow_order_submission === true) {
      storeAllowsSubmission = true;
    }
  } catch (e) {
    console.warn(
      `[worker] unexpected error reading stores.allow_order_submission: ${e?.message || e} — defaulting to disarmed (dry_run only)`,
    );
  }

  const stage5Mode =
    requestedMode === "submit" && !envKilled && storeAllowsSubmission
      ? "submit"
      : "dry_run";
  const allowOrderSubmission = stage5Mode === "submit";

  // Loud log line so the audit trail in Fly logs makes the decision obvious.
  console.log(
    `[worker] Stage 5 arming: requestedMode=${requestedMode}, envKilled=${envKilled}, storeAllowsSubmission=${storeAllowsSubmission}, finalMode=${stage5Mode}`,
  );
  console.log(
    `[timing] run ${run.id}: claim→arming ${msSince()}ms (payload + credentials + readiness)`,
  );

  let session;
  let checkedOut;
  // Persistent session bookkeeping (task #46 Phase A, 2026-05-31).
  //   - persistEnabled: env-gated kill switch; when "no"/unset the worker
  //     behaves exactly like before (cold pipeline every run + close on
  //     finally). Default off until Tony validates against real MILO.
  //   - sessionId: assigned by the session manager on acquire/attach.
  //     Null in the cold path.
  //   - sessionWasReused: true iff acquireSession returned reused=true.
  //     Drives the "skip Stages 1+2" branch below.
  //   - runSucceeded: tracked across all stages. Set true ONLY on the
  //     successful-completion returns. Reads in the finally block to
  //     decide whether to hold the session for reuse (healthy) or tear
  //     it down (poisoned). Any early-return from a stage's catch leaves
  //     this false, so failed runs always tear down.
  const persistEnabled = process.env.LK_RPA_PERSIST_SESSION === "yes";
  let sessionId = null;
  let sessionWasReused = false;
  let runSucceeded = false;
  let runUnhealthyReason = null;
  try {
    /*
     * ─── NODE-DIRECT ENGINE (2026-07-18, the speed dig's verdict) ────────
     *
     * The probe (scripts/probe-milo-node-direct.mjs, run ON this worker)
     * proved MILO answers pure Node with no browser and no cf_clearance:
     * login 200 (~160ms), GET /account 200 (329ms), token exp 30 min. So a
     * validate check no longer pays the ~31s Stage-1 Chromium login — the
     * whole check runs as direct fetch calls at the MILO floor (~2.7s),
     * cold, every time.
     *
     * Routing rules:
     *   - Only validate_only runs with LK_ORDER_ENGINE=api take this path.
     *   - LK_MILO_TRANSPORT=browser is the kill switch back to the proven
     *     browser engine (default: node).
     *   - Login classified invalid_credentials → fail the run LOUD here.
     *     NEVER fall back to the browser on bad creds — loginToMilo would
     *     burn a second bad-password attempt and MLCC can lock the account.
     *   - Login classified blocked_or_down (Cloudflare challenge, network
     *     death) → warn LOUD and fall through to the unchanged browser
     *     pipeline below. Honest degradation, never silent.
     *   - ANY engine failure invalidates the cached node session (poisoned
     *     cache < fresh ~500ms login) and finalizes failed through the
     *     normal retry machinery; the retry re-classifies from scratch.
     */
    const miloTransportChoice = (process.env.LK_MILO_TRANSPORT || "node").toLowerCase();
    if (orderEngine === "api" && isValidateOnly && miloTransportChoice === "node") {
      const nodeKeepalive = setInterval(() => {
        void heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_validate",
          progressMessage: "Confirming your cart with MLCC",
        }).catch(() => {});
      }, 15_000);
      try {
        await heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_validate",
          progressMessage: "Confirming your cart with MLCC",
        });

        const engineItems = await attachProductCacheOrFallback(workerSupabase, normalizedItems);

        let nodeSession = null;
        const tNodeAuth = Date.now();
        try {
          nodeSession = await getNodeMiloSession({ storeId, username, password });
        } catch (nodeLoginErr) {
          const classification =
            nodeLoginErr instanceof MiloNodeLoginError
              ? nodeLoginErr.classification
              : "blocked_or_down";
          if (classification === "invalid_credentials") {
            console.error(
              `[node-engine] FAILED run ${run.id}: MILO rejected the stored credentials (status ${nodeLoginErr?.status ?? "?"})`,
            );
            captureRunFailure(nodeLoginErr, { stage: "engine_validate", runId: run.id, storeId });
            const failure = summarizeFailure(
              "MILO rejected the stored MLCC credentials (node login)",
              "MILO_LOGIN_INVALID_CREDENTIALS",
              { stage: "engine_validate", transport: "node", status: nodeLoginErr?.status ?? null },
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "Node-direct MILO login failed: invalid credentials",
              errorMessage: failure.message,
              failureType: failure.failureType,
              failureDetails: failure.details,
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_validate", "validate_only"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_validate",
              error: "MILO_LOGIN_INVALID_CREDENTIALS",
            };
          }
          // Cloudflare / network shaped → the browser path below still works.
          console.warn(
            `[node-engine] run ${run.id}: node transport blocked pre-engine ` +
              `(status ${nodeLoginErr?.status ?? "?"}: ${nodeLoginErr?.message ?? nodeLoginErr}) — ` +
              `FALLING BACK to the browser engine for this run (slow path, ~34s). ` +
              `If this repeats, MILO/Cloudflare posture changed — re-run the probe.`,
          );
          stepEvidence.push(
            buildWorkerStepEvidence(
              "node_transport_fallback",
              "Node-direct MILO transport failed before the engine; using the browser engine for this run",
              { classification, status: nodeLoginErr?.status ?? null },
            ),
          );
        }

        if (nodeSession) {
          console.log(
            `[timing] run ${run.id}: node auth ${Date.now() - tNodeAuth}ms ` +
              `(fromCache=${nodeSession.fromCache}) · +${msSince()}ms from claim`,
          );
          console.log(
            `[timing] run ${run.id}: engine START (node) · +${msSince()}ms from claim ` +
              `(everything before this is OUR overhead)`,
          );
          const tEngineStart = Date.now();
          let engineResult;
          try {
            engineResult = await buildAndValidateViaApi(
              { transport: nodeSession.transport },
              engineItems,
              {
                username,
                password,
                preauth: {
                  token: nodeSession.token,
                  groupId: nodeSession.groupId,
                  subscriptionId: nodeSession.subscriptionId,
                },
              },
            );
          } catch (engineError) {
            invalidateNodeMiloSession(storeId, "engine_failure");
            console.error(
              `[node-engine] FAILED run ${run.id}: ${engineError?.code ?? "UNKNOWN"} — ${engineError?.message ?? "no message"}`,
            );
            captureRunFailure(engineError, { stage: "engine_validate", runId: run.id, storeId });
            const failure = summarizeFailure(
              engineError?.message ?? "API engine validate failed",
              engineError?.code ?? FAILURE_TYPE.UNKNOWN,
              {
                stage: "engine_validate",
                transport: "node",
                details:
                  engineError?.details && typeof engineError.details === "object"
                    ? engineError.details
                    : {},
              },
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "API engine validate failed (node transport)",
              errorMessage: failure.message,
              failureType: failure.failureType,
              failureDetails: failure.details,
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_validate", "validate_only"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_validate",
              error: engineError?.code ?? FAILURE_TYPE.UNKNOWN,
            };
          }
          console.log(
            `[timing] run ${run.id}: engine DONE ${Date.now() - tEngineStart}ms ` +
              `(MILO round trips) · +${msSince()}ms from claim`,
          );

          const validateOnlySummary = {
            validated: engineResult.validated ?? null,
            can_checkout: engineResult.canCheckout ?? null,
            ada_breakdown: engineResult.adaOrders ?? null,
            order_summary: engineResult.orderSummary ?? null,
            items_added: null,
            items_rejected: null,
            out_of_stock_items: Array.isArray(engineResult.outOfStockItems)
              ? engineResult.outOfStockItems
              : null,
            validate_messages: Array.isArray(engineResult.validationMessages)
              ? engineResult.validationMessages
              : null,
            validate_errors: null,
            current_url: null,
          };

          stepEvidence.push(
            buildWorkerStepEvidence(
              "engine_validate_complete",
              "API engine validate succeeded (node transport — no browser)",
              {
                can_checkout: validateOnlySummary.can_checkout,
                out_of_stock_count: Array.isArray(engineResult.outOfStockItems)
                  ? engineResult.outOfStockItems.length
                  : null,
                engine_timings: engineResult.engineTimings ?? null,
                transport: "node",
              },
            ),
          );
          stepEvidence.push(
            buildWorkerStepEvidence(
              "validate_only_complete",
              "validate_only pipeline complete; Stage 5 deliberately skipped",
              { ...validateOnlySummary, stage_5_invoked: false },
            ),
          );

          await finalizeRun({
            apiBaseUrl,
            runId: run.id,
            storeId,
            status: "succeeded",
            workerNotes:
              "validate_only complete — Stages 1-4 ran successfully; Stage 5 was not reachable",
            evidence: [
              ...stepEvidence,
              buildEvidenceEntry({
                kind: "validate_only_summary",
                stage: "validate_only_complete",
                message:
                  "Live MILO cart state for the scanner's Validate-against-MLCC UI",
                attributes: validateOnlySummary,
              }),
              buildNoSubmitAttestationEvidence(
                "validate_only_complete",
                "validate_only",
              ),
            ],
          });
          console.log(
            `[worker] validate_only run ${run.id} finalized succeeded (canCheckout=${validateOnlySummary.can_checkout}, oos=${Array.isArray(engineResult.outOfStockItems) ? engineResult.outOfStockItems.length : "?"}, transport=node)`,
          );
          runSucceeded = true;
          return {
            success: true,
            claimed: true,
            failed: false,
            runId: run.id,
            runType: "validate_only",
            canCheckout: validateOnlySummary.can_checkout,
            outOfStockCount: Array.isArray(engineResult.outOfStockItems)
              ? engineResult.outOfStockItems.length
              : null,
            sessionReused: false,
            transport: "node",
          };
        }
      } finally {
        clearInterval(nodeKeepalive);
      }
    }
    // ─── END NODE-DIRECT ENGINE (fallthrough = browser pipeline below) ────

    /*
     * ─── NODE ENGINE SUBMIT (2026-07-22 — the second half of the mission) ──
     *
     * Replaces browser Stage 5's minutes-long checkout crawl with ONE POST
     * to /users/cart/checkout (contract: docs/lk/milo-checkout-endpoint.md,
     * decompiled from MILO's own bundle) + a structured confirmations read
     * from GET /users/orders (shape probed live 2026-07-22 — both 7/16
     * confirmation numbers verified present, ADA number structured in
     * distributor.referenceNumber).
     *
     * ARMING — nothing changes until BOTH are true:
     *   - LK_SUBMIT_ENGINE=api  (NEW flag, default "browser" = this branch
     *     is dead code until deliberately flipped)
     *   - the existing triple gate (mode==="submit" + env allow + store
     *     flag) for a LIVE fire; without it this branch runs the full
     *     sequence as a dry-run SHADOW: validate + payload build + gate
     *     refusal, no POST ever issued (submitCartViaApi enforces).
     *
     * TRUTH RULE (2026-07-16 P0-1), engine edition: dispatchedAt is stamped
     * the moment the POST fires. Past that line NOTHING may finalize as
     * "failed" or re-queue — confirmations found → succeeded; anything
     * else (POST error, orders-read failure, crash) → submitted_unconfirmed,
     * terminal, human verifies against MLCC email / MILO Orders page.
     * Every pre-dispatch refusal (gates, tripwire, bad payload) is still an
     * honest retryable failure — refusing is always safe before the POST.
     *
     * Fallbacks: node login blocked_or_down → LOUD fallthrough to the
     * browser pipeline below (Stages 1-5, proven on 7/16). Kill switch:
     * unset LK_SUBMIT_ENGINE (or =browser) — one secret, no deploy.
     */
    const submitEngineChoice = (process.env.LK_SUBMIT_ENGINE || "browser").toLowerCase();
    if (
      runType === "rpa_run" &&
      orderEngine === "api" &&
      miloTransportChoice === "node" &&
      submitEngineChoice === "api"
    ) {
      const submitKeepalive = setInterval(() => {
        void heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: stage5Mode === "submit" ? "rpa_checkout" : "rpa_validate",
          progressMessage:
            stage5Mode === "submit"
              ? "Placing your order with MLCC"
              : "Confirming your cart with MLCC",
        }).catch(() => {});
      }, 15_000);
      try {
        await heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_validate",
          progressMessage: "Confirming your cart with MLCC",
        });

        const engineItems = await attachProductCacheOrFallback(workerSupabase, normalizedItems);

        // ── Auth (same classification contract as the validate branch) ──
        let nodeSession = null;
        const tNodeAuth = Date.now();
        try {
          nodeSession = await getNodeMiloSession({ storeId, username, password });
        } catch (nodeLoginErr) {
          const classification =
            nodeLoginErr instanceof MiloNodeLoginError
              ? nodeLoginErr.classification
              : "blocked_or_down";
          if (classification === "invalid_credentials") {
            console.error(
              `[node-submit] FAILED run ${run.id}: MILO rejected the stored credentials (status ${nodeLoginErr?.status ?? "?"})`,
            );
            captureRunFailure(nodeLoginErr, { stage: "engine_submit", runId: run.id, storeId });
            const failure = summarizeFailure(
              "MILO rejected the stored MLCC credentials (node login)",
              "MILO_LOGIN_INVALID_CREDENTIALS",
              { stage: "engine_submit", transport: "node", status: nodeLoginErr?.status ?? null },
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "Node engine submit: MILO login failed (invalid credentials)",
              errorMessage: failure.message,
              failureType: failure.failureType,
              failureDetails: failure.details,
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_submit", "rpa_run"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_submit",
              error: "MILO_LOGIN_INVALID_CREDENTIALS",
            };
          }
          console.warn(
            `[node-submit] run ${run.id}: node transport blocked pre-engine ` +
              `(status ${nodeLoginErr?.status ?? "?"}: ${nodeLoginErr?.message ?? nodeLoginErr}) — ` +
              `FALLING BACK to the browser pipeline for this run (Stage 5 browser checkout).`,
          );
          stepEvidence.push(
            buildWorkerStepEvidence(
              "node_transport_fallback",
              "Node-direct MILO transport failed before engine submit; using the browser pipeline for this run",
              { classification, status: nodeLoginErr?.status ?? null },
            ),
          );
        }

        if (nodeSession) {
          console.log(
            `[timing] run ${run.id}: node auth ${Date.now() - tNodeAuth}ms ` +
              `(fromCache=${nodeSession.fromCache}) · +${msSince()}ms from claim`,
          );

          // ── Fresh validate of the EXACT cart (boundary gate inside) ──
          const tSubmitPhaseStart = Date.now();
          let engineResult;
          try {
            engineResult = await buildAndValidateViaApi(
              { transport: nodeSession.transport },
              engineItems,
              {
                username,
                password,
                preauth: {
                  token: nodeSession.token,
                  groupId: nodeSession.groupId,
                  subscriptionId: nodeSession.subscriptionId,
                },
                includeRaw: true,
              },
            );
          } catch (engineError) {
            invalidateNodeMiloSession(storeId, "engine_failure");
            console.error(
              `[node-submit] FAILED run ${run.id} (pre-dispatch validate): ${engineError?.code ?? "UNKNOWN"} — ${engineError?.message ?? "no message"}`,
            );
            captureRunFailure(engineError, { stage: "engine_submit", runId: run.id, storeId });
            const failure = summarizeFailure(
              engineError?.message ?? "Engine validate before submit failed",
              engineError?.code ?? FAILURE_TYPE.UNKNOWN,
              { stage: "engine_submit", transport: "node", phase: "pre_dispatch_validate" },
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "Node engine submit: pre-dispatch validate failed (nothing submitted)",
              errorMessage: failure.message,
              failureType: failure.failureType,
              failureDetails: failure.details,
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_submit", "rpa_run"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_submit",
              error: engineError?.code ?? FAILURE_TYPE.UNKNOWN,
            };
          }

          // ── Hard gate: MILO must bless the cart RIGHT NOW ──
          if (engineResult.canCheckout !== true) {
            const oosCount = Array.isArray(engineResult.outOfStockItems)
              ? engineResult.outOfStockItems.length
              : null;
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "Node engine submit refused: MILO did not bless the cart (canCheckout false) — nothing submitted",
              errorMessage: `Refusing submit: MILO validate returned canCheckout=false (${oosCount ?? "?"} out-of-stock line(s))`,
              failureType: "MILO_STAGE5_CART_NOT_CHECKOUTABLE",
              failureDetails: {
                stage: "engine_submit",
                transport: "node",
                can_checkout: engineResult.canCheckout ?? null,
                out_of_stock_count: oosCount,
              },
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_submit", "rpa_run"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_submit",
              error: "MILO_STAGE5_CART_NOT_CHECKOUTABLE",
            };
          }

          // ── Duplicate-submit tripwire (same helper as the browser path) ──
          if (allowOrderSubmission) {
            const { error: tripErr, ambiguousDeaths } = await fetchAmbiguousCheckoutDeaths(
              workerSupabase,
              storeId,
            );
            if (tripErr || (ambiguousDeaths ?? []).length > 0) {
              const refusalMsg = tripErr
                ? `Could not check recent submit history before live submission: ${tripErr}`
                : `Refusing live submit: ${ambiguousDeaths.length} submit attempt(s) for this store died at checkout within the last 30 minutes with an ambiguous outcome. Check MILO's order history — the order may already exist.`;
              await finalizeRun({
                apiBaseUrl,
                runId: run.id,
                storeId,
                status: "failed",
                workerNotes: "Node engine submit refused by duplicate-submit tripwire",
                errorMessage: refusalMsg,
                failureType: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
                failureDetails: {
                  stage: "engine_submit",
                  tripwire_error: tripErr ?? null,
                  ambiguous_runs: (ambiguousDeaths ?? []).map((r) => ({
                    run_id: r.id,
                    finished_at: r.finished_at,
                    failure_type: r.failure_type,
                  })),
                  window_minutes: 30,
                },
                evidence: [
                  ...stepEvidence,
                  buildNoSubmitAttestationEvidence("engine_submit", "rpa_run"),
                ],
              });
              return {
                success: false,
                claimed: true,
                failed: true,
                runId: run.id,
                stage: "engine_submit",
                error: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
              };
            }
          }

          // ── THE POST (or the gate-refused dry-run shadow) ──
          await heartbeatRun({
            apiBaseUrl,
            runId: run.id,
            storeId,
            workerId,
            progressStage: "rpa_checkout",
            progressMessage:
              stage5Mode === "submit" ? "Placing your order with MLCC" : "Practice checkout (no order will be placed)",
          });
          stepEvidence.push(
            buildWorkerStepEvidence("rpa_checkout_started", "Engine submit started (node transport)", {
              stage: 5,
              mode: stage5Mode,
              transport: "node",
            }),
          );

          const dispatchedAtIso = new Date().toISOString();
          let submitResult;
          try {
            // Fail-closed: a check/preview can never reach the submit machinery.
            assertSubmitMachineryAllowed({ runType, site: "engine_submit(node)" });
            submitResult = await submitCartViaApi(
              { transport: nodeSession.transport },
              {
                token: nodeSession.token,
                groupId: nodeSession.groupId,
                pricedCart: engineResult.raw.pricedCart,
                deliveries: engineResult.raw.deliveries,
                allowLiveSubmission: allowOrderSubmission === true,
              },
            );
          } catch (payloadError) {
            // Thrown ONLY pre-dispatch (payload build fails closed before any
            // network write) — safe, honest failure.
            console.error(
              `[node-submit] FAILED run ${run.id} (payload build, nothing dispatched): ${payloadError?.message ?? payloadError}`,
            );
            captureRunFailure(payloadError, { stage: "engine_submit", runId: run.id, storeId });
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "failed",
              workerNotes: "Node engine submit: checkout payload failed closed (nothing dispatched)",
              errorMessage: String(payloadError?.message ?? payloadError),
              failureType: "MLCC_SUBMIT_PAYLOAD_INVALID",
              failureDetails: { stage: "engine_submit", transport: "node" },
              evidence: [
                ...stepEvidence,
                buildNoSubmitAttestationEvidence("engine_submit", "rpa_run"),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: true,
              runId: run.id,
              stage: "engine_submit",
              error: "MLCC_SUBMIT_PAYLOAD_INVALID",
            };
          }

          // ── Dry-run shadow outcome: full rehearsal, no POST issued ──
          if (submitResult.dispatched !== true) {
            stepEvidence.push(
              buildWorkerStepEvidence("rpa_checkout_complete", "Engine submit dry-run complete (no POST issued)", {
                mode: "dry_run",
                submitted: false,
                transport: "node",
                reason: submitResult.reason ?? null,
              }),
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "succeeded",
              workerNotes: "RPA run completed in dry_run mode; cart prepared but NOT submitted",
              evidence: [
                ...stepEvidence,
                buildEvidenceEntry({
                  kind: "rpa_run_summary",
                  stage: "rpa_complete",
                  message: "Engine submit pipeline completed in dry_run mode (node transport)",
                  attributes: {
                    mode: "dry_run",
                    submitted: false,
                    transport: "node",
                    dry_run_reason: submitResult.reason ?? null,
                    engine_timings: engineResult.engineTimings ?? null,
                    stage5_duration_ms: Date.now() - tSubmitPhaseStart,
                  },
                }),
                buildNoSubmitAttestationEvidence("rpa_complete", "rpa_run"),
              ],
            });
            console.log(
              `[node-submit] run ${run.id} dry-run shadow complete — validate green, payload built, POST refused by gate (correct)`,
            );
            runSucceeded = true;
            return {
              success: true,
              claimed: true,
              runId: run.id,
              mode: "dry_run",
              submitted: false,
              confirmationNumbers: null,
              dryRunReason: submitResult.reason ?? null,
              stage5DurationMs: Date.now() - tSubmitPhaseStart,
              sessionReused: false,
              transport: "node",
            };
          }

          /*
           * ── POINT OF NO RETURN CROSSED — dispatched === true ──
           * Everything below runs inside its own catch-all: NO exception may
           * escape into a "failed" finalize past this line (truth rule).
           */
          console.log(
            `[node-submit] run ${run.id}: checkout POST dispatched at ${dispatchedAtIso} (status ${submitResult.status ?? "?"})`,
          );
          try {
            const inlineNumbers = Array.isArray(submitResult.confirmationNumbers)
              ? submitResult.confirmationNumbers
              : [];

            /*
             * Confirmations from GET /users/orders. On 7/16 MILO stamped
             * placedOn ~40s AFTER the submit click, so early polls will
             * legitimately miss — the schedule stretches to ~2 min before
             * settling at unconfirmed. expectedCount = ADAs that actually
             * carry items in the validated cart.
             */
            const expectedCount = Math.max(
              1,
              (Array.isArray(engineResult.adaOrders) ? engineResult.adaOrders : []).filter(
                (a) => (a?.items?.length ?? 0) > 0,
              ).length || 1,
            );
            const POLL_DELAYS_MS = [3_000, 5_000, 8_000, 10_000, 12_000, 15_000, 15_000, 15_000, 15_000, 15_000];
            let selected = [];
            let lastOrdersStatus = null;
            for (const delayMs of POLL_DELAYS_MS) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              const ordersRes = await fetchMiloOrders(nodeSession.transport, {
                token: nodeSession.token,
                groupId: nodeSession.groupId,
              });
              lastOrdersStatus = ordersRes.status ?? null;
              if (!ordersRes.ok || !Array.isArray(ordersRes.body)) continue;
              const normalized = ordersRes.body
                .map((o) => normalizeMiloApiOrder(o))
                .filter(Boolean);
              selected = selectOrdersForSubmit(normalized, {
                dispatchedAtIso,
                expectedCount,
                licenseNumber: normalizedLicenseNumber,
              });
              if (selected.length >= expectedCount) break;
            }

            const confirmationMap = buildConfirmationMapFromOrders(selected);
            const haveOrderConfirmations = selected.length > 0 && Object.keys(confirmationMap).length > 0;
            const confirmed = haveOrderConfirmations || inlineNumbers.length > 0;

            if (confirmed) {
              const checkedOutLike = {
                submitted: true,
                mode: "submit",
                confirmationNumbers: haveOrderConfirmations ? confirmationMap : {},
                historyOrders: selected,
                submittedTimestamp: selected[0]?.placedIso ?? dispatchedAtIso,
              };
              // Persist — same service, same best-effort law as the browser path.
              try {
                const persistResult = await persistMiloOrderConfirmations({
                  supabase: workerSupabase,
                  storeId,
                  executionRunId: run.id,
                  checkedOut: checkedOutLike,
                  sessionAdaOrders: engineResult.adaOrders,
                });
                stepEvidence.push(
                  buildWorkerStepEvidence(
                    "milo_confirmations_persisted",
                    persistResult.error
                      ? `Confirmation persist completed with note: ${persistResult.error}`
                      : `Persisted ${persistResult.persisted} confirmation row(s) to milo_order_confirmations`,
                    {
                      persisted: persistResult.persisted,
                      skipped: persistResult.skipped,
                      error: persistResult.error,
                    },
                  ),
                );
              } catch (persistErr) {
                const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
                console.warn(`[node-submit] confirmation persist threw (continuing): ${msg}`);
                stepEvidence.push(
                  buildWorkerStepEvidence(
                    "milo_confirmations_persist_failed",
                    "Confirmation persist threw — run still succeeds, evidence has the raw data",
                    { error: msg },
                  ),
                );
              }

              const partial = haveOrderConfirmations && selected.length < expectedCount;
              if (partial) {
                console.error(
                  `[node-submit] run ${run.id}: PARTIAL confirmations — found ${selected.length}/${expectedCount} expected ADA order(s). Verify the missing ADA on MILO.`,
                );
              }
              stepEvidence.push(
                buildEvidenceEntry({
                  kind: "submit_click_attestation",
                  stage: "engine_submit",
                  message: partial
                    ? `Checkout POST dispatched and PARTIALLY confirmed (${selected.length}/${expectedCount} ADA orders found) — verify the remainder on MILO`
                    : "Checkout POST dispatched and confirmed via /users/orders",
                  attributes: {
                    submit_clicked: true,
                    submit_clicked_at: dispatchedAtIso,
                    transport: "node",
                    post_status: submitResult.status ?? null,
                    confirmations_found: selected.length,
                    confirmations_expected: expectedCount,
                    inline_confirmation_numbers: inlineNumbers,
                  },
                }),
              );
              await finalizeRun({
                apiBaseUrl,
                runId: run.id,
                storeId,
                status: "succeeded",
                workerNotes: "RPA run completed with live submission",
                evidence: [
                  ...stepEvidence,
                  buildEvidenceEntry({
                    kind: "rpa_run_summary",
                    stage: "rpa_complete",
                    message: "Engine submit completed with live submission (node transport)",
                    attributes: {
                      mode: "submit",
                      submitted: true,
                      confirmation_numbers: haveOrderConfirmations ? confirmationMap : inlineNumbers,
                      history_orders: selected,
                      stage5_duration_ms: Date.now() - tSubmitPhaseStart,
                      transport: "node",
                      partial_confirmations: partial,
                      engine_timings: engineResult.engineTimings ?? null,
                    },
                  }),
                ],
              });
              console.log(
                `[node-submit] run ${run.id} finalized succeeded — confirmations: ${JSON.stringify(confirmationMap)}${inlineNumbers.length ? ` inline: ${inlineNumbers.join(",")}` : ""}`,
              );
              runSucceeded = true;
              return {
                success: true,
                claimed: true,
                runId: run.id,
                mode: "submit",
                submitted: true,
                confirmationNumbers: haveOrderConfirmations ? confirmationMap : inlineNumbers,
                dryRunReason: null,
                stage5DurationMs: Date.now() - tSubmitPhaseStart,
                sessionReused: false,
                transport: "node",
              };
            }

            // ── No confirmation captured → THE TRUTH RULE settles it ──
            captureSubmittedUnconfirmed({
              runId: run.id,
              storeId,
              submitClickedAt: dispatchedAtIso,
              stage5ErrorCode: "ENGINE_SUBMIT_CONFIRMATION_PENDING",
            });
            console.error(
              `[node-submit] UNCONFIRMED run ${run.id}: POST dispatched (status ${submitResult.status ?? "?"}); ` +
                `no confirmation on /users/orders within the poll budget (last read status ${lastOrdersStatus ?? "?"}). ` +
                `NOT failed, NOT retryable — verify MILO Orders / MLCC email.`,
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "submitted_unconfirmed",
              workerNotes:
                "Engine submit POST dispatched; confirmation not captured before the poll budget ended. Verify MILO Orders page / MLCC email. Never auto-retried.",
              errorMessage:
                submitResult.submitted === false
                  ? `checkout POST returned ${submitResult.status ?? "?"} and no order appeared on /users/orders yet`
                  : undefined,
              failureDetails: {
                submit_clicked: true,
                submit_clicked_at: dispatchedAtIso,
                stage5_error_code: "ENGINE_SUBMIT_CONFIRMATION_PENDING",
                post_status: submitResult.status ?? null,
                last_orders_read_status: lastOrdersStatus,
                transport: "node",
              },
              evidence: [
                ...stepEvidence,
                buildEvidenceEntry({
                  kind: "submit_click_attestation",
                  stage: "engine_submit",
                  message:
                    "Checkout POST DISPATCHED in submit mode; no confirmation captured from the POST response or /users/orders before the run ended",
                  attributes: {
                    submit_clicked: true,
                    submit_clicked_at: dispatchedAtIso,
                    transport: "node",
                    post_status: submitResult.status ?? null,
                    last_orders_read_status: lastOrdersStatus,
                  },
                }),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: false,
              runId: run.id,
              stage: "engine_submit",
              submittedUnconfirmed: true,
              transport: "node",
            };
          } catch (postDispatchError) {
            // ANY unexpected error after dispatch resolves to unconfirmed —
            // never a plain failure, never a retry (truth rule, worker half).
            captureSubmittedUnconfirmed({
              runId: run.id,
              storeId,
              submitClickedAt: dispatchedAtIso,
              stage5ErrorCode: postDispatchError?.code ?? "ENGINE_SUBMIT_POST_DISPATCH_ERROR",
            });
            console.error(
              `[node-submit] UNCONFIRMED run ${run.id} (post-dispatch error): ${postDispatchError?.message ?? postDispatchError} — settling as submitted_unconfirmed`,
            );
            await finalizeRun({
              apiBaseUrl,
              runId: run.id,
              storeId,
              status: "submitted_unconfirmed",
              workerNotes:
                "Engine submit POST dispatched; an error interrupted confirmation capture. Verify MILO Orders page / MLCC email. Never auto-retried.",
              errorMessage: String(postDispatchError?.message ?? postDispatchError),
              failureDetails: {
                submit_clicked: true,
                submit_clicked_at: dispatchedAtIso,
                stage5_error_code: postDispatchError?.code ?? "ENGINE_SUBMIT_POST_DISPATCH_ERROR",
                transport: "node",
              },
              evidence: [
                ...stepEvidence,
                buildEvidenceEntry({
                  kind: "submit_click_attestation",
                  stage: "engine_submit",
                  message:
                    "Checkout POST DISPATCHED in submit mode; confirmation capture was interrupted by an error before completing",
                  attributes: {
                    submit_clicked: true,
                    submit_clicked_at: dispatchedAtIso,
                    transport: "node",
                    error_code: postDispatchError?.code ?? null,
                  },
                }),
              ],
            });
            return {
              success: false,
              claimed: true,
              failed: false,
              runId: run.id,
              stage: "engine_submit",
              submittedUnconfirmed: true,
              transport: "node",
            };
          }
        }
      } finally {
        clearInterval(submitKeepalive);
      }
    }
    // ─── END NODE ENGINE SUBMIT (fallthrough = browser pipeline below) ────

    // ─── Phase A reuse path ──────────────────────────────────────────
    // If persist is enabled AND we have a warm session for THIS store
    // with THIS license, skip Stages 1 + 2 entirely. The session
    // manager's idle-timeout + liveness probe guarantees that any
    // session we get back here is still alive and usable. Stage 3
    // always runs, and its existing auto-clear-cart pre-flight (task #9)
    // handles any cart state left behind by the previous run.
    if (persistEnabled) {
      const tAcquireStart = Date.now();
      const acq = await acquireSession({
        storeId,
        licenseNumber: normalizedLicenseNumber,
      });
      console.log(
        `[timing] run ${run.id}: session acquire ${Date.now() - tAcquireStart}ms ` +
          `(reused=${acq.reused === true}${acq.reused ? "" : `, reason=${acq.reason}`}) ` +
          `· +${msSince()}ms from claim`,
      );
      if (acq.reused) {
        session = acq.session;
        sessionId = acq.sessionId;
        sessionWasReused = true;
        await heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_add_items",
          progressMessage:
            "Reusing warm MILO session — skipping login + navigate",
        });
        stepEvidence.push(
          buildWorkerStepEvidence(
            "rpa_session_reused",
            "Reusing held MILO session; Stages 1+2 skipped",
            {
              session_id: sessionId,
              current_url:
                session?.page?.url?.() ?? session?.currentUrl ?? null,
            },
          ),
        );
      } else {
        stepEvidence.push(
          buildWorkerStepEvidence(
            "rpa_session_cold",
            "No reusable session — running full pipeline from Stage 1",
            { reason: acq.reason },
          ),
        );
      }
    }

    if (!sessionWasReused) {
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

      // Keepalive: login can run up to ~7.5 min (150s x 3 attempts) and is
      // otherwise SILENT — no heartbeat. Beat every 20s so heartbeat_at stays
      // fresh during a healthy-but-slow login. This is what makes "stale
      // heartbeat" reliably mean DEAD (so the reaper + the user Start-over
      // recovery can act fast without ever killing a live login). Cleared in
      // the finally below. Fire-and-forget — a missed beat never affects the run.
      const loginKeepalive = setInterval(() => {
        void heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_login",
          progressMessage: "Logging into MLCC",
        }).catch(() => {});
      }, 20_000);
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
      // P0-3 (2026-07-16 postmortem F2): every stage death prints to stdout.
      console.error(
        `[stage1] FAILED run ${run.id}: ${loginError?.code ?? "UNKNOWN"} — ${loginError?.message ?? "no message"}`,
      );
      captureRunFailure(loginError, { stage: "stage1_login", runId: run.id, storeId });
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
    } finally {
      clearInterval(loginKeepalive);
    }

    stepEvidence.push(
      buildWorkerStepEvidence("rpa_login_complete", "Stage 1 login succeeded", {
        current_url: session?.page?.url?.() ?? session?.currentUrl ?? null,
      }),
    );
    } // end if (!sessionWasReused) — Stage 1 login is COLD-ONLY

    /*
     * ═══ BUG FIX 2026-07-18 — the engine must run WARM *or* COLD ═══
     *
     * The API ENGINE block below used to sit INSIDE `if (!sessionWasReused)`.
     * So when a session WAS reused, the engine was skipped entirely: the run
     * did no work, completed nothing, and the session manager tore the
     * session down as `run_did_not_complete` — then the run got re-claimed
     * and ran cold from scratch.
     *
     * Measured 2026-07-18 (run ed2359a7): warm acquire at 22:27:16, session
     * closed `run_did_not_complete` in the SAME second, re-claimed at
     * 22:27:20, cold engine at +5331ms. On run adc38c07 the cold retry took
     * 141,860ms. That made warm reuse architecturally impossible and turned
     * every check into a coin flip between 0.3s and 2min21s.
     *
     * Login is the ONLY thing that should be conditional on session reuse.
     * The engine runs every time. Stage 2 navigate re-enters a cold-only
     * guard below, so a cold engine run still skips navigate exactly as it
     * did before — cold stays as fast as it was, warm finally works.
     */

    // ─── API ENGINE PATH (opt-in, validate-only) ──────────────────────────
    // When LK_ORDER_ENGINE=api AND this is a validate_only run, replace RPA
    // Stages 2-4 with direct MILO API calls (no DOM typing). Self-contained:
    // own keepalive, own failure finalize, own validate-only finalize+return.
    // A submit run NEVER uses this path (the engine cannot submit). Flag off
    // (default "rpa") => this block is skipped and behavior is unchanged.
    if (orderEngine === "api" && isValidateOnly) {
      const engineKeepalive = setInterval(() => {
        void heartbeatRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          workerId,
          progressStage: "rpa_validate",
          progressMessage: "Confirming your cart with MLCC",
        }).catch(() => {});
      }, 15_000);

      // Pre-map via the shared helper (extracted 2026-07-18 for the node
      // branch; behavior + log lines identical to the old inline block).
      const engineItems = await attachProductCacheOrFallback(workerSupabase, normalizedItems);

      try {
        console.log(
          `[timing] run ${run.id}: engine START · +${msSince()}ms from claim ` +
            `(everything before this is OUR overhead)`,
        );
        const tEngineStart = Date.now();
        const engineResult = await buildAndValidateViaApi(session, engineItems, { username, password });
        console.log(
          `[timing] run ${run.id}: engine DONE ${Date.now() - tEngineStart}ms ` +
            `(MILO round trips) · +${msSince()}ms from claim`,
        );

        /*
         * Hold this session for reuse — BUG FIX, 2026-07-18.
         *
         * attachFreshSession() lives at the end of the OLD stage-by-stage
         * path (right after Stage 2 navigate). The API engine added later
         * returns from this function long before reaching it — so with
         * LK_RPA_PERSIST_SESSION=yes, sessionId stayed null forever, the
         * manager was never handed a session, and EVERY run reported
         * `no_held_session` and paid a full browser login.
         *
         * Measured 2026-07-18 (runs 0ee6ce58 + 73b5b5ce): two back-to-back
         * validates BOTH logged reused=false. What looked like warm reuse
         * (31s → 5.6s) was only Chromium/OS warm-start, not session reuse.
         * Login+navigate was 31,248ms cold and 5,476ms "warm" — while setup
         * was just ~199ms. That login is the entire cost of a check.
         *
         * Attaching here is what makes reuse actually happen on the path
         * production takes. This point is correct-by-construction: the
         * engine just completed a full MILO round trip on this session, so
         * it is provably alive. Non-fatal — if the manager declines we run
         * as a one-shot and finally{} closes the browser exactly as before.
         * If the run fails after this, runSucceeded stays false and the
         * finally block tears the session down rather than holding it.
         */
        if (persistEnabled && !sessionWasReused && !sessionId) {
          try {
            const att = await attachFreshSession({
              storeId,
              licenseNumber: normalizedLicenseNumber,
              session,
            });
            if (att.ok) {
              sessionId = att.sessionId;
              console.log(
                `[timing] run ${run.id}: session ATTACHED for reuse (${sessionId}) — next run should skip login`,
              );
              stepEvidence.push(
                buildWorkerStepEvidence(
                  "rpa_session_attached",
                  "Fresh MILO session attached for future reuse (engine path)",
                  { session_id: sessionId },
                ),
              );
            } else {
              console.warn(
                `[worker] attachFreshSession declined (non-fatal): ${att.reason ?? "unknown"}`,
              );
            }
          } catch (attachError) {
            console.warn(
              `[worker] attachFreshSession threw (non-fatal): ${attachError?.message ?? attachError}`,
            );
          }
        }
        session.validated = engineResult.validated;
        session.canCheckout = engineResult.canCheckout;
        session.adaOrders = engineResult.adaOrders;
        session.orderSummary = engineResult.orderSummary;
        session.outOfStockItems = engineResult.outOfStockItems;
        session.validationMessages = engineResult.validationMessages;
        session.deliveryDates = engineResult.deliveryDates;
        session.currentUrl = session?.page?.url?.() ?? session?.currentUrl ?? null;
        stepEvidence.push(
          buildWorkerStepEvidence(
            "engine_validate_complete",
            "API engine validate succeeded (Stages 2-4 via direct API)",
            {
              can_checkout: session.canCheckout,
              out_of_stock_count: Array.isArray(session.outOfStockItems) ? session.outOfStockItems.length : null,
              engine_timings: engineResult.engineTimings ?? null,
            },
          ),
        );
      } catch (engineError) {
        clearInterval(engineKeepalive);
        const failure = summarizeFailure(
          engineError?.message ?? "API engine validate failed",
          engineError?.code ?? FAILURE_TYPE.UNKNOWN,
          {
            stage: "engine_validate",
            details:
              engineError?.details && typeof engineError.details === "object"
                ? engineError.details
                : {},
          },
        );
        await finalizeRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          status: "failed",
          workerNotes: "API engine validate failed",
          errorMessage: failure.message,
          failureType: failure.failureType,
          failureDetails: failure.details,
          evidence: [
            ...stepEvidence,
            buildNoSubmitAttestationEvidence("engine_validate", "validate_only"),
          ],
        });
        return {
          success: false,
          claimed: true,
          failed: true,
          runId: run.id,
          stage: "engine_validate",
          error: engineError?.code ?? FAILURE_TYPE.UNKNOWN,
        };
      } finally {
        clearInterval(engineKeepalive);
      }

      // Validate-only finalize — copied verbatim from the isValidateOnly
      // block below (build validateOnlySummary from session.*, push
      // validate_only_complete + validate_only_summary + no-submit attestation
      // evidence, finalizeRun(status:"succeeded"), set runSucceeded = true,
      // and return the same validate_only result object). Identical strings/shape.
      const validateOnlySummary = {
        validated: session?.validated ?? null,
        can_checkout: session?.canCheckout ?? null,
        ada_breakdown: session?.adaOrders ?? null,
        order_summary: session?.orderSummary ?? null,
        items_added: Array.isArray(session?.itemsAdded)
          ? session.itemsAdded
          : null,
        items_rejected: Array.isArray(session?.itemsRejected)
          ? session.itemsRejected
          : null,
        out_of_stock_items: Array.isArray(session?.outOfStockItems)
          ? session.outOfStockItems
          : null,
        validate_messages: Array.isArray(session?.validationMessages)
          ? session.validationMessages
          : null,
        validate_errors: Array.isArray(session?.validationErrors)
          ? session.validationErrors
          : null,
        current_url: session?.currentUrl ?? null,
      };

      stepEvidence.push(
        buildWorkerStepEvidence(
          "validate_only_complete",
          "validate_only pipeline complete; Stage 5 deliberately skipped",
          { ...validateOnlySummary, stage_5_invoked: false },
        ),
      );

      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "succeeded",
        workerNotes:
          "validate_only complete — Stages 1-4 ran successfully; Stage 5 was not reachable",
        evidence: [
          ...stepEvidence,
          buildEvidenceEntry({
            kind: "validate_only_summary",
            stage: "validate_only_complete",
            message:
              "Live MILO cart state for the scanner's Validate-against-MLCC UI",
            attributes: validateOnlySummary,
          }),
          buildNoSubmitAttestationEvidence(
            "validate_only_complete",
            "validate_only",
          ),
        ],
      });
      console.log(
        `[worker] validate_only run ${run.id} finalized succeeded (canCheckout=${session?.canCheckout}, oos=${Array.isArray(session?.outOfStockItems) ? session.outOfStockItems.length : "?"})`,
      );
      runSucceeded = true;
      return {
        success: true,
        claimed: true,
        failed: false,
        runId: run.id,
        runType: "validate_only",
        canCheckout: session?.canCheckout ?? null,
        outOfStockCount: Array.isArray(session?.outOfStockItems)
          ? session.outOfStockItems.length
          : null,
        sessionReused: sessionWasReused,
      };
    }
    // ─── END API ENGINE PATH ──────────────────────────────────────────────

    // Stage 2 navigate + the cold-path session attach are COLD-ONLY. A reused
    // session is already logged in AND navigated (it was attached after a
    // completed run), so re-entering the guard here keeps warm runs skipping
    // straight past. Reached only when the engine is off (LK_ORDER_ENGINE=rpa)
    // or this is a submit run — the engine returns before this point.
    if (!sessionWasReused) {
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

    // Keepalive: navigate can also stall on a slow MILO. Same pattern as login.
    const navKeepalive = setInterval(() => {
      void heartbeatRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        workerId,
        progressStage: "rpa_navigate",
        progressMessage: "Loading MLCC products",
      }).catch(() => {});
    }, 20_000);
    try {
      session = await navigateToProducts(session, {
        licenseNumber: normalizedLicenseNumber,
        captureArtifacts: true,
      });
    } catch (stage2Error) {
      // P0-3 (2026-07-16 postmortem F2): every stage death prints to stdout.
      console.error(
        `[stage2] FAILED run ${run.id}: ${stage2Error?.code ?? "UNKNOWN"} — ${stage2Error?.message ?? "no message"}`,
      );
      captureRunFailure(stage2Error, { stage: "stage2_navigate", runId: run.id, storeId });
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
    } finally {
      clearInterval(navKeepalive);
    }

      stepEvidence.push(
        buildWorkerStepEvidence(
          "rpa_navigate_complete",
          "Stage 2 navigation succeeded",
          { current_url: session?.currentUrl ?? session?.page?.url?.() ?? null },
        ),
      );

      // After a cold Stage 1+2, put the session under management so the
      // next run for this store can skip straight to Stage 3. Attach
      // failure is non-fatal — if the manager refuses (invalid args
      // somehow), we just run this one as a one-shot and close the
      // browser in finally as before.
      if (persistEnabled) {
        const att = await attachFreshSession({
          storeId,
          licenseNumber: normalizedLicenseNumber,
          session,
        });
        if (att.ok) {
          sessionId = att.sessionId;
          stepEvidence.push(
            buildWorkerStepEvidence(
              "rpa_session_attached",
              "Fresh MILO session attached for future reuse",
              { session_id: sessionId },
            ),
          );
        }
      }
    } // end if (!sessionWasReused) — Stages 1+2 either ran or were skipped

    /*
     * cart_reset_only branch (task #57, 2026-06-04).
     *
     * Session is logged in and at /milo/products. Skip Stages 3-5
     * entirely; just clear the MILO cart and finalize. This is the
     * "Reset MLCC cart" scanner button — fixes the lie where the old
     * local-only clear left items lingering in MILO.
     *
     * We still release the session to the manager (or close it)
     * through the existing finally — no special teardown.
     */
    if (isCartResetOnly) {
      await heartbeatRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        workerId,
        progressStage: "rpa_cart_reset",
        progressMessage: "Clearing MILO cart...",
      });
      stepEvidence.push(
        buildWorkerStepEvidence(
          "rpa_cart_reset_started",
          "Cart-reset clearMiloCart starting",
          { current_url: session?.page?.url?.() ?? null },
        ),
      );

      let clearResult;
      try {
        clearResult = await clearMiloCart(session.page);
      } catch (clearError) {
        const failure = summarizeFailure(
          clearError?.message ?? "Cart-reset clearMiloCart failed",
          clearError?.code ?? FAILURE_TYPE.UNKNOWN,
          { stage: "cart_reset" },
        );
        await finalizeRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          status: "failed",
          workerNotes: "Cart reset clearMiloCart threw",
          errorMessage: failure.message,
          failureType: failure.failureType,
          failureDetails: failure.details,
          evidence: [
            ...stepEvidence,
            buildNoSubmitAttestationEvidence("cart_reset", "cart_reset_only"),
          ],
        });
        return {
          success: false,
          claimed: true,
          failed: true,
          runId: run.id,
          stage: "cart_reset",
          error: clearError?.code ?? FAILURE_TYPE.UNKNOWN,
        };
      }

      stepEvidence.push(
        buildWorkerStepEvidence(
          "rpa_cart_reset_complete",
          "Cart-reset clearMiloCart completed",
          {
            cleared: !!clearResult?.cleared,
            item_count_before: clearResult?.itemCountBefore ?? 0,
            skipped: !!clearResult?.skipped,
            reason: clearResult?.reason ?? null,
          },
        ),
      );

      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "succeeded",
        workerNotes: "Cart reset succeeded",
        errorMessage: null,
        evidence: [
          ...stepEvidence,
          buildEvidenceEntry({
            kind: "cart_reset_summary",
            stage: "cart_reset",
            message: clearResult?.cleared
              ? `Cleared ${clearResult.itemCountBefore} item(s) from MILO cart`
              : clearResult?.skipped
                ? `Cart-reset skipped: ${clearResult.reason}`
                : "MILO cart was already empty",
            attributes: clearResult ?? {},
          }),
          buildNoSubmitAttestationEvidence("cart_reset", "cart_reset_only"),
        ],
      });

      /*
        AUDIT #16 (P1, 2026-06-12): this success return was missing
        `runSucceeded = true`, so the finally released the session as
        UNHEALTHY and tore down a perfectly good warm browser after every
        successful cart reset — including the signup activation probe and
        the VerifyMlccBanner. The user's next validate then paid the
        ~2-minute cold path instead of the ~30-45s warm one.
      */
      runSucceeded = true;
      return {
        success: true,
        claimed: true,
        runId: run.id,
        runType: "cart_reset_only",
        clearResult,
      };
    }

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

    // AUDIT #19: throttled live progress so the scanner's progress line
    // shows "Adding item X of N" instead of a minutes-long blind wait.
    let lastStage3Beat = 0;
    try {
      session = await addItemsToCart(session, normalizedItems, {
        captureArtifacts: true,
        mlccLookup,
        onProgress: ({ done, total }) => {
          const now = Date.now();
          if (now - lastStage3Beat < 8_000 && done < total) return;
          lastStage3Beat = now;
          void heartbeatRun({
            apiBaseUrl,
            runId: run.id,
            storeId,
            workerId,
            progressStage: "rpa_add_items",
            progressMessage: `Adding items to MILO cart — ${done} of ${total}`,
          }).catch(() => {
            /* a missed heartbeat must never affect the run */
          });
        },
      });
    } catch (stage3Error) {
      // P0-3 (2026-07-16 postmortem F2): every stage death prints to stdout.
      console.error(
        `[stage3] FAILED run ${run.id}: ${stage3Error?.code ?? "UNKNOWN"} — ${stage3Error?.message ?? "no message"}`,
      );
      captureRunFailure(stage3Error, { stage: "stage3_add_items", runId: run.id, storeId });
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

    // Keepalive: validate can run up to ~45s and is otherwise SILENT after
    // the start heartbeat above — the client poll sees a frozen bar and can't
    // tell "working" from "stuck." Beat every 15s with progressStage
    // rpa_validate so heartbeat_at stays fresh ("still confirming with MLCC").
    // Same pattern as loginKeepalive/navKeepalive above; cleared in the finally
    // below whether validate succeeds or throws. 15s (vs 20s for login/nav)
    // so the ≤45s window gets ~2–3 beats. Fire-and-forget — a missed beat
    // never affects the run.
    const validateKeepalive = setInterval(() => {
      void heartbeatRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        workerId,
        progressStage: "rpa_validate",
        progressMessage: "Confirming your cart with MLCC",
      }).catch(() => {});
    }, 15_000);
    try {
      session = await validateCartOnMilo(session, {
        captureArtifacts: true,
      });
    } catch (stage4Error) {
      // Print to stdout so `fly logs` shows the death (2026-07-16: two live
      // submit attempts died in stage 4 with NOTHING in the log stream — the
      // failure only existed in the DB and cost 20 blind minutes mid-order).
      console.error(
        `[stage4] FAILED run ${run.id}: ${stage4Error?.code ?? "UNKNOWN"} — ${stage4Error?.message ?? "no message"}`,
      );
      captureRunFailure(stage4Error, { stage: "stage4_validate", runId: run.id, storeId });
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
    } finally {
      clearInterval(validateKeepalive);
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

    // ─── Validate-only short-circuit ──────────────────────────────────────
    //
    // If this run was kicked off as "validate_only", we stop here. The user
    // has now seen Stages 1-4 results — login OK, products navigation OK,
    // items added with MILO's real cart-verification (active vs. out-of-stock),
    // Stage 4 MILO validate run. We finalize the run as succeeded and embed
    // the live cart state into the evidence so the scanner UI can render a
    // "here's what MILO sees" panel without us ever clicking the Checkout
    // button. ZERO risk of accidental submission because Stage 5 isn't
    // reachable from this branch.
    if (isValidateOnly) {
      const validateOnlySummary = {
        validated: session?.validated ?? null,
        can_checkout: session?.canCheckout ?? null,
        ada_breakdown: session?.adaOrders ?? null,
        order_summary: session?.orderSummary ?? null,
        items_added: Array.isArray(session?.itemsAdded)
          ? session.itemsAdded
          : null,
        items_rejected: Array.isArray(session?.itemsRejected)
          ? session.itemsRejected
          : null,
        out_of_stock_items: Array.isArray(session?.outOfStockItems)
          ? session.outOfStockItems
          : null,
        validate_messages: Array.isArray(session?.validationMessages)
          ? session.validationMessages
          : null,
        validate_errors: Array.isArray(session?.validationErrors)
          ? session.validationErrors
          : null,
        current_url: session?.currentUrl ?? null,
      };

      stepEvidence.push(
        buildWorkerStepEvidence(
          "validate_only_complete",
          "validate_only pipeline complete; Stage 5 deliberately skipped",
          { ...validateOnlySummary, stage_5_invoked: false },
        ),
      );

      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "succeeded",
        workerNotes:
          "validate_only complete — Stages 1-4 ran successfully; Stage 5 was not reachable",
        evidence: [
          ...stepEvidence,
          buildEvidenceEntry({
            kind: "validate_only_summary",
            stage: "validate_only_complete",
            message:
              "Live MILO cart state for the scanner's Validate-against-MLCC UI",
            attributes: validateOnlySummary,
          }),
          buildNoSubmitAttestationEvidence(
            "validate_only_complete",
            "validate_only",
          ),
        ],
      });
      console.log(
        `[worker] validate_only run ${run.id} finalized succeeded (canCheckout=${session?.canCheckout}, oos=${Array.isArray(session?.outOfStockItems) ? session.outOfStockItems.length : "?"})`,
      );
      runSucceeded = true;
      return {
        success: true,
        claimed: true,
        failed: false,
        runId: run.id,
        runType: "validate_only",
        canCheckout: session?.canCheckout ?? null,
        outOfStockCount: Array.isArray(session?.outOfStockItems)
          ? session.outOfStockItems.length
          : null,
        sessionReused: sessionWasReused,
      };
    }
    // ─── End validate-only short-circuit ──────────────────────────────────

    /*
      AUDIT #17 (P0, 2026-06-12) — BOUNDARY COMPARISON BEFORE LIVE SUBMIT
      (Integrity Doctrine discipline #11: what we sent === what came back;
      mismatch = LOUD ALERT).

      Stage 3 verifies items against the live MILO cart and demotes
      rejects — but a PARTIAL outcome (81 of 84 verified) flowed straight
      through Stage 4 into Stage 5, silently submitting a short order the
      user never approved. The pre-submit modal shows the LOCAL cart, so
      no layer caught it.

      Gate (live submits only — dry runs are rehearsals and their results
      already surface rejections):
        1. every requested code must be VERIFIED in the active MILO cart
           at the exact requested quantity (session.itemsAdded is already
           the exact-quantity-verified set), and
        2. the active cart must contain nothing we didn't request.
      Any mismatch REFUSES Stage 5 with a typed, listable failure. A
      blocked short order beats a placed wrong order, always — the user
      reviews and re-runs.
    */
    /*
      AUDIT #20 (P0-class, 2026-06-12) — DUPLICATE-SUBMIT TRIPWIRE.
      If a recent submit attempt for THIS store died AT CHECKOUT in an
      AMBIGUOUS way (reaped mid-click, confirmation timeout with failed
      backstop, unknown crash), MILO may or may not have placed that
      order — the only safe move is to REFUSE the next live submit until
      a human checks MILO's order history. Definitively-safe checkout
      failures (error toast = MILO rejected it; our own safety/boundary
      refusals) don't trip this. Window: 30 minutes. Concurrent same-store
      runs are structurally impossible (one_running_run_per_store index),
      so only the failed-ambiguous window matters.
    */
    if (allowOrderSubmission) {
      // Shared tripwire query (extracted 2026-07-22 — same helper the node
      // engine-submit branch uses; behavior identical to the inline block).
      const { error: tripwireErr, ambiguousDeaths: tripwireDeaths } =
        await fetchAmbiguousCheckoutDeaths(workerSupabase, storeId);
      if (tripwireErr) {
        // Fail SAFE: if we cannot evaluate the tripwire, refuse the live
        // submit rather than risk a double order (doctrine: loud > wrong).
        await finalizeRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          status: "failed",
          workerNotes: "Stage 5 refused: duplicate-submit tripwire could not be evaluated",
          errorMessage: `Could not check recent submit history before live submission: ${tripwireErr}`,
          failureType: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
          failureDetails: { tripwire_error: tripwireErr },
          evidence: [
            ...stepEvidence,
            buildNoSubmitAttestationEvidence("stage5_dup_tripwire", "rpa_run"),
          ],
        });
        return {
          success: false,
          claimed: true,
          failed: true,
          runId: run.id,
          stage: "stage5_dup_tripwire",
          error: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
        };
      }
      const ambiguousDeaths = tripwireDeaths ?? [];
      if (ambiguousDeaths.length > 0) {
        await finalizeRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          status: "failed",
          workerNotes:
            "Stage 5 refused: a recent submit attempt died at checkout ambiguously — possible order already placed",
          errorMessage:
            `Refusing live submit: ${ambiguousDeaths.length} submit attempt(s) for this store died at checkout within the last 30 minutes with an ambiguous outcome. Check MILO's order history (/milo/account/orders) — the order may already exist.`,
          failureType: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
          failureDetails: {
            ambiguous_runs: ambiguousDeaths.map((r) => ({
              run_id: r.id,
              finished_at: r.finished_at,
              failure_type: r.failure_type,
            })),
            window_minutes: 30,
          },
          evidence: [
            ...stepEvidence,
            buildEvidenceEntry({
              kind: "duplicate_submit_tripwire",
              stage: "stage5_dup_tripwire",
              message:
                "Live submission refused — recent ambiguous checkout death for this store",
              attributes: { ambiguous_runs: ambiguousDeaths },
            }),
            buildNoSubmitAttestationEvidence("stage5_dup_tripwire", "rpa_run"),
          ],
        });
        return {
          success: false,
          claimed: true,
          failed: true,
          runId: run.id,
          stage: "stage5_dup_tripwire",
          error: "MLCC_POSSIBLE_DUPLICATE_SUBMIT",
        };
      }
    }

    if (allowOrderSubmission) {
      /*
        Truth source (strengthened during the same audit pass): prefer
        Stage 4's POST-VALIDATE cart (session.adaOrders) over Stage 3's
        verified set — MILO can demote an item AT VALIDATE (task #53's
        "validate_demoted" class), and Stage 3's snapshot predates that.
        An OOS-section item is deliberately treated as missing here: a
        submit containing OOS lines is a short order, and the client's
        #55 lock already enforces the same policy — this is the server
        side of that defense. Fallback to Stage 3's verified set only if
        adaOrders is somehow absent (it never should be on this path —
        Stage 4 is mandatory before Stage 5).
      */
      const verifiedByCode = new Map();
      const adaOrdersArr = Array.isArray(session?.adaOrders)
        ? session.adaOrders
        : [];
      if (adaOrdersArr.length > 0) {
        for (const ada of adaOrdersArr) {
          for (const it of ada?.items ?? []) {
            const codeStr = String(it?.code ?? "").trim();
            if (!codeStr) continue;
            const q = Number(it?.quantity ?? it?.quantityOrdered ?? NaN);
            verifiedByCode.set(
              codeStr,
              (verifiedByCode.get(codeStr) ?? 0) +
                (Number.isFinite(q) ? q : 0),
            );
          }
        }
      } else {
        for (const i of Array.isArray(session?.itemsAdded)
          ? session.itemsAdded
          : []) {
          verifiedByCode.set(String(i.code), Number(i.quantity));
        }
      }

      const boundaryMismatches = [];
      for (const want of normalizedItems) {
        const got = verifiedByCode.get(String(want.code));
        if (got == null) {
          boundaryMismatches.push({
            code: want.code,
            requested: want.quantity,
            in_cart: 0,
            kind: "missing_or_rejected",
          });
        } else if (Number(got) !== Number(want.quantity)) {
          boundaryMismatches.push({
            code: want.code,
            requested: want.quantity,
            in_cart: got,
            kind: "quantity_mismatch",
          });
        }
      }
      const requestedCodes = new Set(
        normalizedItems.map((i) => String(i.code)),
      );
      for (const [codeStr, qty] of verifiedByCode) {
        if (!requestedCodes.has(codeStr)) {
          boundaryMismatches.push({
            code: codeStr,
            requested: 0,
            in_cart: qty,
            kind: "unexpected_item_in_cart",
          });
        }
      }

      if (boundaryMismatches.length > 0) {
        const missingCount = boundaryMismatches.filter(
          (m) => m.kind === "missing_or_rejected",
        ).length;
        const failure = summarizeFailure(
          `Refusing live submit: MILO cart does not match the approved order (${boundaryMismatches.length} mismatch${boundaryMismatches.length === 1 ? "" : "es"}: ${missingCount} missing/rejected)`,
          "MLCC_CART_MISMATCH_BEFORE_SUBMIT",
          {
            stage: "stage5_boundary_gate",
            mismatches: boundaryMismatches,
            requested_count: normalizedItems.length,
            verified_count: verifiedByCode.size,
          },
        );
        await finalizeRun({
          apiBaseUrl,
          runId: run.id,
          storeId,
          status: "failed",
          workerNotes:
            "Stage 5 refused: boundary comparison found cart/order mismatch (doctrine #11)",
          errorMessage: failure.message,
          failureType: failure.failureType,
          failureDetails: failure.details,
          evidence: [
            ...stepEvidence,
            buildEvidenceEntry({
              kind: "boundary_comparison",
              stage: "stage5_boundary_gate",
              message:
                "Requested order vs verified MILO cart mismatch — live submission refused",
              attributes: {
                mismatches: boundaryMismatches,
                requested_count: normalizedItems.length,
                verified_count: verifiedByCode.size,
              },
            }),
            buildNoSubmitAttestationEvidence("stage5_boundary_gate", "rpa_run"),
          ],
        });
        return {
          success: false,
          claimed: true,
          failed: true,
          runId: run.id,
          stage: "stage5_boundary_gate",
          error: "MLCC_CART_MISMATCH_BEFORE_SUBMIT",
        };
      }
    }

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
      // AUDIT #24 (P0, 2026-06-13): this was hardcoded to 60_000ms — far
      // below checkout.js's own documented worst case for a REAL submit:
      // POST_SUBMIT_WAIT_MS (75s) + HISTORY_FETCH_BUDGET_MS (90s) backstop
      // + setup/click/capture overhead = up to ~185s. Every large-cart real
      // submit could hit this 60s ceiling AFTER the Checkout button was
      // already clicked (order placed on MILO), get reported as "failed:
      // MILO_STAGE5_TIMEOUT" with a false no-submit attestation, and lose
      // the confirmation numbers — while checkout.js's own `run()` kept
      // executing in the background against session.page, racing with this
      // function's session-release/teardown in the `finally` block.
      // 240_000ms covers the documented 185s worst case with real margin,
      // matching checkout.js's own DEFAULT_TIMEOUT_MS (180_000) intent.
      // 420s (was 240s — Order Day 2026-07-16 postmortem F3): 240s
      // guillotined the run mid-backstop on a slow MILO — AFTER the real
      // submit clicked (MLCC email arrived while the run "failed"). The
      // post-click machinery alone is 75s signal wait + 90s history
      // backstop + nav/parse; pre-click checkout-page work on an
      // order-night MILO eats the rest. Hang-stop, not pace-setter — and
      // post-click expiry now resolves to submitOutcome:"unconfirmed"
      // inside checkout.js instead of throwing (the truth rule).
      // Fail-closed: a check/preview can never reach the submit machinery.
      assertSubmitMachineryAllowed({ runType, site: "stage5_checkout(browser)" });
      checkedOut = await checkoutOnMilo(session, {
        mode: stage5Mode,
        allowOrderSubmission,
        timeoutMs: 420_000,
      });
    } catch (stage5Error) {
      // Stage-5 deaths must be visible in `fly logs` (postmortem F2 — the
      // stage-4 twin of this line was added mid-order-day 2026-07-16).
      console.error(
        `[stage5] FAILED run ${run.id}: ${stage5Error?.code ?? "UNKNOWN"} — ${stage5Error?.message ?? "no message"}`,
      );
      captureRunFailure(stage5Error, {
        stage: "stage5_checkout",
        runId: run.id,
        storeId,
        mode: stage5Mode,
        extra: { submit_clicked: stage5Error?.details?.submit_clicked === true },
      });
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
      /*
        A thrown stage-5 error with submit_clicked in its details means the
        click dispatched and MILO then showed an explicit rejection toast
        (the one error checkout.js still throws post-click). The attestation
        must tell the truth either way (2026-07-16: tonight's placed order
        carries a FALSE "no submit" attestation in evidence — never again).
      */
      const clickDispatched = stage5Error?.details?.submit_clicked === true;
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "failed",
        workerNotes: clickDispatched
          ? "RPA Stage 5 failed — MILO rejected the submit after the click (error toast)"
          : "RPA Stage 5 failed",
        errorMessage: failure.message,
        failureType: failure.failureType,
        failureDetails: {
          ...failure.details,
          submit_clicked: clickDispatched,
        },
        evidence: [
          ...stepEvidence,
          ...(clickDispatched
            ? [
                buildEvidenceEntry({
                  kind: "submit_click_attestation",
                  stage: "stage5_checkout",
                  message:
                    "Checkout click DISPATCHED; MILO returned an explicit rejection toast — no order expected, verify Orders page",
                  attributes: {
                    submit_clicked: true,
                    submit_clicked_at: stage5Error?.details?.submit_clicked_at ?? null,
                    error_code: stage5Error?.code ?? null,
                  },
                }),
              ]
            : [buildNoSubmitAttestationEvidence("stage5_checkout", "rpa_run")]),
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

    /*
      THE TRUTH RULE, worker half (2026-07-16 postmortem P0-1). checkout.js
      resolves post-click errors/timeouts as submitOutcome:"unconfirmed"
      instead of throwing. The run finalizes as submitted_unconfirmed:
      TERMINAL (status is not "failed", so the retry scheduler never sees
      it — re-running a dispatched submit risks a DOUBLE ORDER), and the
      client renders "Submitted — confirming", never "didn't go through."
      External truth (MLCC email / MILO Orders page) outranks run state.
    */
    if (stage5Mode === "submit" && checkedOut?.submitOutcome === "unconfirmed") {
      console.error(
        `[stage5] UNCONFIRMED run ${run.id}: submit click dispatched at ${checkedOut?.submitClickedAt ?? "unknown"}; ` +
          `no confirmation captured before the stage ended (${checkedOut?.stage5Error?.code ?? "no code"}). ` +
          `Attempting second-chance receipt scrape before settling.`,
      );

      /*
        SECOND-CHANCE RECEIPT SCRAPE (2026-07-16 postmortem F3, the
        self-healing half). On 7/16 the run gave up while the placed
        order sat fully visible on /milo/orders — a human (Tony) had to
        read the page and hand-insert the confirmations. If the browser
        page survived whatever killed stage 5, the worker can read that
        same page itself: one bounded, read-only orders-history parse.
        Confirmations found → this run UPGRADES to a full success with
        numbers persisted, exactly as if stage 5 had finished. Nothing
        found (or page dead) → settle at submitted_unconfirmed, honest.
        No cart mutation, no clicks — the submit already happened.
      */
      let recoveredReceipt = null;
      if (session?.page) {
        try {
          recoveredReceipt = await navigateToOrdersAndCapture(
            session.page,
            session,
            checkedOut?.outputDir ?? session?.outputDir ?? null,
            [],
            90_000,
          );
        } catch (scrapeErr) {
          console.error(
            `[stage5] second-chance scrape failed for run ${run.id}: ${scrapeErr?.code ?? "UNKNOWN"} — ${scrapeErr?.message ?? scrapeErr}`,
          );
        }
      }
      const rc = recoveredReceipt?.confirmationNumbers;
      const receiptRecovered =
        rc != null &&
        (Array.isArray(rc)
          ? rc.length > 0
          : typeof rc === "object"
            ? Object.keys(rc).length > 0
            : String(rc).trim() !== "");

      if (receiptRecovered) {
        console.log(
          `[stage5] SECOND-CHANCE RECOVERY run ${run.id}: confirmations found on /milo/orders — upgrading to succeeded`,
        );
        stepEvidence.push(
          buildEvidenceEntry({
            kind: "submit_click_attestation",
            stage: "stage5_checkout",
            message:
              "Submit click dispatched; stage 5 missed the receipt, but the worker's second-chance orders-history scrape recovered the confirmations",
            attributes: {
              submit_clicked: true,
              submit_clicked_at: checkedOut?.submitClickedAt ?? null,
              stage5_error_code: checkedOut?.stage5Error?.code ?? null,
              recovered_from_worker_backstop: true,
            },
          }),
        );
        // Rebuild checkedOut as a confirmed submit and FALL THROUGH to the
        // normal success path below (confirmations persist + finalize
        // succeeded) — this run never touches submitted_unconfirmed.
        checkedOut = {
          ...checkedOut,
          submitted: true,
          submitOutcome: undefined,
          confirmationNumbers: recoveredReceipt.confirmationNumbers,
          submittedTimestamp:
            recoveredReceipt.submittedTimestamp ?? checkedOut?.submitClickedAt ?? null,
          currentUrl: recoveredReceipt.currentUrl ?? checkedOut?.currentUrl ?? null,
          recoveredFromWorkerBackstop: true,
          ...(recoveredReceipt.historyOrders
            ? { historyOrders: recoveredReceipt.historyOrders }
            : {}),
        };
      }

      if (!receiptRecovered) {
      // MONEY AT RISK — a real order may exist on MILO with no confirmation
      // captured. Always page (2026-07-18 telemetry gap fix).
      captureSubmittedUnconfirmed({
        runId: run.id,
        storeId,
        submitClickedAt: checkedOut?.submitClickedAt ?? null,
        stage5ErrorCode: checkedOut?.stage5Error?.code ?? null,
      });
      console.error(
        `[stage5] UNCONFIRMED run ${run.id} settling: NOT failed, NOT retryable — verify on MILO Orders / MLCC email.`,
      );
      await finalizeRun({
        apiBaseUrl,
        runId: run.id,
        storeId,
        status: "submitted_unconfirmed",
        workerNotes:
          "Submit click dispatched; confirmation not captured before stage end. Verify MILO Orders page / MLCC email. Never auto-retried.",
        errorMessage: checkedOut?.stage5Error?.message ?? undefined,
        failureDetails: {
          submit_clicked: true,
          submit_clicked_at: checkedOut?.submitClickedAt ?? null,
          stage5_error_code: checkedOut?.stage5Error?.code ?? null,
        },
        evidence: [
          ...stepEvidence,
          buildEvidenceEntry({
            kind: "submit_click_attestation",
            stage: "stage5_checkout",
            message:
              "Checkout click DISPATCHED in submit mode; no terminal confirmation or rejection signal captured before the run ended",
            attributes: {
              submit_clicked: true,
              submit_clicked_at: checkedOut?.submitClickedAt ?? null,
              stage5_error_code: checkedOut?.stage5Error?.code ?? null,
              stage5_error_message: checkedOut?.stage5Error?.message ?? null,
              current_url: checkedOut?.currentUrl ?? null,
              output_dir: checkedOut?.outputDir ?? null,
            },
          }),
        ],
      });
      return {
        success: false,
        claimed: true,
        failed: false,
        runId: run.id,
        stage: "stage5_checkout",
        submittedUnconfirmed: true,
      };
      }
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

    /*
      Persist Stage 5 confirmations to public.milo_order_confirmations
      (task #41, 2026-06-02). Best-effort — never fail the run on a
      persistence error. ONLY for real submissions (dry_run produces
      no real confirmation numbers; we'd just be writing dummy rows).
      The service handles dedup via the (execution_run_id, ada_number)
      unique partial index, so a worker retry would noop instead of
      duplicating.
    */
    if (stage5Mode === "submit" && checkedOut?.submitted === true) {
      try {
        const persistResult = await persistMiloOrderConfirmations({
          supabase: workerSupabase,
          storeId,
          executionRunId: run.id,
          checkedOut,
          sessionAdaOrders: session?.adaOrders,
        });
        stepEvidence.push(
          buildWorkerStepEvidence(
            "milo_confirmations_persisted",
            persistResult.error
              ? `Confirmation persist completed with note: ${persistResult.error}`
              : `Persisted ${persistResult.persisted} confirmation row(s) to milo_order_confirmations`,
            {
              persisted: persistResult.persisted,
              skipped: persistResult.skipped,
              error: persistResult.error,
            },
          ),
        );
      } catch (persistErr) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        console.warn(
          `[worker] milo_order_confirmations persist threw (continuing): ${msg}`,
        );
        stepEvidence.push(
          buildWorkerStepEvidence(
            "milo_confirmations_persist_failed",
            "Confirmation persist threw — run still succeeds, evidence has the raw data",
            { error: msg },
          ),
        );
      }
    }

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

    runSucceeded = true;
    return {
      success: true,
      claimed: true,
      runId: run.id,
      mode: checkedOut?.mode,
      submitted: checkedOut?.submitted,
      confirmationNumbers: checkedOut?.confirmationNumbers ?? null,
      dryRunReason: checkedOut?.dryRunReason ?? null,
      stage5DurationMs: checkedOut?.stage5DurationMs,
      sessionReused: sessionWasReused,
    };
  } finally {
    /*
      Session disposal (task #46 Phase A). Two paths:
        a. Persist enabled + we have a sessionId — call releaseSession.
           The manager decides whether to keep the browser warm (healthy
           run, hold for reuse) or close it (poisoned, tear down).
        b. Otherwise (legacy path / no managed session) — close the
           browser like the original code did. Preserves behavior when
           the env flag is off OR when persist failed to attach (e.g.
           Stage 1+2 threw before we could attach).

      runSucceeded is the source of truth for "is this session safe to
      reuse." Any return-from-catch in a stage leaves it false, so a
      failed run always tears down. Validate-only success and rpa_run
      success both set it true right before returning.
    */
    if (persistEnabled && sessionId) {
      await releaseSession({
        sessionId,
        healthy: runSucceeded,
        reason: runUnhealthyReason || (runSucceeded ? null : "run_did_not_complete"),
      });
    } else {
      // Close the CONTEXT before the browser so Playwright flushes recordHar
      // (network.har) to disk. browser.close() alone does NOT flush it
      // (documented in _test_validate.js). Best-effort — teardown never throws.
      if (session?.context) await session.context.close().catch(() => {});
      if (session?.browser) await session.browser.close().catch(() => {});
    }

    /*
      P0-2 (2026-07-16 postmortem F5): upload the run's artifacts OFF-MACHINE
      the moment they're flushed. This line exists because the 7/16 disarm
      restart wiped the live submit run's network.har from this ephemeral
      disk — the submit-endpoint capture, gone. Placement is deliberate:
      AFTER the context close above (so network.har exists on disk) and
      inside the finally (so success, failure, and submitted_unconfirmed
      all preserve their evidence). Best-effort + bounded — a slow or
      failed upload logs one line and never blocks the worker loop.
      NOTE: this runs after finalizeRun, so counts land in fly logs (grep
      "[artifacts]"), not in run evidence — retrieval is by run id via
      scripts/pull-run-artifacts.mjs, which lists Storage directly.
    */
    if (session?.outputDir && run?.id) {
      const artifactSummary = await uploadRunArtifacts({
        supabase: workerSupabase,
        runId: run.id,
        outputDir: session.outputDir,
      });
      console.log(formatUploadSummary(run.id, artifactSummary));
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
