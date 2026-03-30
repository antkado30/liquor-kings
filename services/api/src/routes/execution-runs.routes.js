import express from "express";
import supabase from "../config/supabase.js";
import {
  applyExecutionRunOperatorAction,
  claimNextQueuedExecutionRun,
  getExecutionRunOperatorActionsById,
  createExecutionRunFromCart,
  getExecutionRunEvidenceById,
  getExecutionRunById,
  getExecutionRunSummaryById,
  heartbeatExecutionRun,
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

  const { statusCode, body } = await createExecutionRunFromCart(
    supabase,
    storeId,
    cartId,
    { userId: req.auth_user_id },
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
