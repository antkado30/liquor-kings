import express from "express";
import supabase from "../config/supabase.js";
import {
  claimNextQueuedExecutionRun,
  createExecutionRunFromCart,
  getExecutionRunById,
  heartbeatExecutionRun,
  listExecutionRunsForCart,
  updateExecutionRunStatus,
} from "../services/execution-run.service.js";

const router = express.Router();

router.post("/from-cart/:storeId/:cartId", async (req, res) => {
  const { storeId, cartId } = req.params;

  const { statusCode, body } = await createExecutionRunFromCart(
    supabase,
    storeId,
    cartId,
  );

  return res.status(statusCode).json(body);
});


router.post("/claim-next", async (req, res) => {
  const { workerId, workerNotes } = req.body ?? {};

  const { statusCode, body } = await claimNextQueuedExecutionRun(
    supabase,
    workerId,
    workerNotes,
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


router.get("/:runId", async (req, res) => {
  const { runId } = req.params;

  const { statusCode, body } = await getExecutionRunById(supabase, runId);

  return res.status(statusCode).json(body);
});

router.patch("/:runId/heartbeat", async (req, res) => {
  const { runId } = req.params;
  const { workerId, progressStage, progressMessage, workerNotes } =
    req.body ?? {};

  const { statusCode, body } = await heartbeatExecutionRun(
    supabase,
    runId,
    workerId,
    progressStage,
    progressMessage,
    workerNotes,
  );

  return res.status(statusCode).json(body);
});


router.patch("/:runId/status", async (req, res) => {
  const { runId } = req.params;
  const { status, workerNotes, errorMessage } = req.body ?? {};

  const { statusCode, body } = await updateExecutionRunStatus(
    supabase,
    runId,
    status,
    workerNotes,
    errorMessage,
  );

  return res.status(statusCode).json(body);
});

export default router;
