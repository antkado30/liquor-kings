import express from "express";
import supabase from "../config/supabase.js";
import {
  claimNextQueuedExecutionRun,
  createExecutionRunFromCart,
  getExecutionRunById,
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
  const { workerNotes } = req.body ?? {};

  const { statusCode, body } = await claimNextQueuedExecutionRun(
    supabase,
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
