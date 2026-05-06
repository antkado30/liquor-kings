import express from "express";
import supabase from "../config/supabase.js";
import {
  applyExecutionRunOperatorAction,
  claimNextQueuedExecutionRun,
  getExecutionRunOperatorReviewBundleById,
  getExecutionRunOperatorActionsById,
  createExecutionRunFromCart,
  getExecutionRunEvidenceById,
  getExecutionRunById,
  getExecutionRunLifecycleById,
  getExecutionRunPilotVerificationById,
  getExecutionRunPilotVerdictById,
  getExecutionRunPilotReviewPacketById,
  getStorePilotOverview,
  getStorePilotRunsFeed,
  getExecutionRunSummaryById,
  heartbeatExecutionRun,
  listExecutionRunsForOperatorReview,
  listExecutionRunsForCart,
  listExecutionRunSummariesForCart,
  updateExecutionRunStatus,
} from "../services/execution-run.service.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import { requireServiceRole } from "../middleware/require-service-role.middleware.js";

const router = express.Router();

router.param("storeId", enforceParamStoreMatches);

router.post("/claim-next", requireServiceRole, async (req, res) => {
  const { workerId, workerNotes } = req.body ?? {};

  const { statusCode, body } = await claimNextQueuedExecutionRun(
    supabase,
    workerId,
    workerNotes,
  );

  return res.status(statusCode).json(body);
});

router.post("/from-cart/:storeId/:cartId", async (req, res) => {
  const { storeId, cartId } = req.params;
  const mode = req.body?.mode;

  if (mode !== undefined && mode !== "rpa_run") {
    return res.status(400).json({
      error: "INVALID_MODE",
      details: "mode must be one of: rpa_run",
    });
  }

  const { statusCode, body } = await createExecutionRunFromCart(
    supabase,
    storeId,
    cartId,
    { userId: req.auth_user_id, mode },
  );

  return res.status(statusCode).json(body);
});

router.get("/cart/:storeId/:cartId", async (req, res) => {
  const { storeId, cartId } = req.params;

  const { statusCode, body } = await listExecutionRunsForCart(
    supabase,
    storeId,
    cartId,
  );

  return res.status(statusCode).json(body);
});

router.get("/cart/:storeId/:cartId/history", async (req, res) => {
  const { storeId, cartId } = req.params;

  const { statusCode, body } = await listExecutionRunSummariesForCart(
    supabase,
    storeId,
    cartId,
  );

  return res.status(statusCode).json(body);
});

router.get("/review/:storeId/runs", async (req, res) => {
  const { storeId } = req.params;
  const { status, failure_type: failureType, cart_id: cartId } = req.query;
  const pendingManualReviewRaw = req.query.pending_manual_review;
  const pendingManualReview =
    pendingManualReviewRaw === undefined
      ? undefined
      : String(pendingManualReviewRaw).toLowerCase() === "true";
  const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 100);
  const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(offsetRaw, 0);

  const { statusCode, body } = await listExecutionRunsForOperatorReview(
    supabase,
    storeId,
    {
      status: status ? String(status) : undefined,
      failureType: failureType ? String(failureType) : undefined,
      pendingManualReview,
      cartId: cartId ? String(cartId) : undefined,
      limit,
      offset,
    },
  );
  return res.status(statusCode).json(body);
});

router.get("/review/:storeId/pilot-runs", async (req, res) => {
  const { storeId } = req.params;
  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : limitRaw;
  const { statusCode, body } = await getStorePilotRunsFeed(supabase, storeId, {
    limit,
  });
  return res.status(statusCode).json(body);
});

router.get("/review/:storeId/pilot-overview", async (req, res) => {
  const { storeId } = req.params;
  const limitRaw = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const failedLimitRaw = Number.parseInt(String(req.query.failed_limit ?? "5"), 10);
  const limit = Number.isNaN(limitRaw) ? 20 : limitRaw;
  const failedLimit = Number.isNaN(failedLimitRaw) ? 5 : failedLimitRaw;
  const { statusCode, body } = await getStorePilotOverview(supabase, storeId, {
    limit,
    failedLimit,
  });
  return res.status(statusCode).json(body);
});

router.get("/:runId/summary", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunSummaryById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/lifecycle", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunLifecycleById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/pilot-verification", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunPilotVerificationById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/pilot-verdict", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunPilotVerdictById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/pilot-review-packet", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunPilotReviewPacketById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/review-bundle", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunOperatorReviewBundleById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/evidence", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunEvidenceById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId/actions", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { statusCode, body } = await getExecutionRunOperatorActionsById(
    supabase,
    runId,
    req.store_id,
  );
  return res.status(statusCode).json(body);
});

router.get("/:runId", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;

  const { statusCode, body } = await getExecutionRunById(
    supabase,
    runId,
    req.store_id,
  );

  return res.status(statusCode).json(body);
});

router.patch("/:runId/heartbeat", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { workerId, progressStage, progressMessage, workerNotes } =
    req.body ?? {};

  const { statusCode, body } = await heartbeatExecutionRun(
    supabase,
    runId,
    req.store_id,
    workerId,
    progressStage,
    progressMessage,
    workerNotes,
  );

  return res.status(statusCode).json(body);
});

router.patch("/:runId/status", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  const { runId } = req.params;
  const { status, workerNotes, errorMessage, failureType, failureDetails, evidence } =
    req.body ?? {};

  const { statusCode, body } = await updateExecutionRunStatus(
    supabase,
    runId,
    req.store_id,
    status,
    workerNotes,
    errorMessage,
    failureType,
    failureDetails,
    evidence,
  );

  return res.status(statusCode).json(body);
});

router.post("/:runId/actions", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  const { runId } = req.params;
  const { action, reason, note } = req.body ?? {};

  const { statusCode, body } = await applyExecutionRunOperatorAction(
    supabase,
    runId,
    req.store_id,
    action,
    {
      reason,
      note,
      actorId: req.auth_user_id ?? req.headers["x-operator-id"] ?? null,
    },
  );
  return res.status(statusCode).json(body);
});

export default router;
