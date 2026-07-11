import express from "express";
import supabase from "../config/supabase.js";
import {
  applyExecutionRunOperatorAction,
  claimNextQueuedExecutionRun,
  reapStaleExecutionRuns,
  recoverStuckStoreRuns,
  getExecutionRunOperatorReviewBundleById,
  getExecutionRunOperatorActionsById,
  createExecutionRunFromCart,
  createCartResetExecutionRun,
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

/**
 * POST /execution-runs/recover/:storeId — user "Start over" escape hatch.
 *
 * Frees the store from a CONFIRMED-DEAD run (no worker heartbeat for >90s) so
 * the user isn't trapped behind a wedged validate for the full 15-min reaper
 * window. Safe by construction (see recoverStuckStoreRuns): it never touches a
 * fresh-heartbeat (alive) run — two live runs would collide on the one MILO
 * cart — and never a run at/after checkout (submit-side, double-order risk).
 * Auth: enforceParamStoreMatches guarantees the caller owns :storeId.
 */
router.post("/recover/:storeId", async (req, res) => {
  const { storeId } = req.params;
  const result = await recoverStuckStoreRuns(supabase, storeId);
  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error });
  }
  return res.json(result);
});

/*
  Reap throttle (2026-07-11, claim-latency dig). The reaper used to run
  inline on EVERY claim-next — with the worker polling every few seconds,
  that's an extra DB round trip on every poll, and on days with stale runs
  (deploy/crash days — exactly 7/5, when the 20s claim timeouts clustered)
  the reap did per-run UPDATEs + web-push HTTP calls synchronously INSIDE
  the claim request, stalling it for seconds. Self-healing stays, at most
  once a minute: the shortest reap threshold is 3 MINUTES of stale
  heartbeat, so a 60s sweep cadence delays recovery by at most a third of
  the threshold while taking the reap off the hot path the rest of the
  time. Module-scope is per-process (2 API machines = 2 independent
  throttles) — fine, the reap is idempotent and guarded by its own WHERE.
*/
const REAP_MIN_INTERVAL_MS = 60_000;
let lastReapAtMs = 0;

router.post("/claim-next", requireServiceRole, async (req, res) => {
  const { workerId, workerNotes } = req.body ?? {};

  // Self-healing: sweep up runs whose worker died mid-run (stuck "running"
  // with a cold heartbeat). Best-effort — a reap failure must never block
  // claiming the next run — and throttled (see REAP_MIN_INTERVAL_MS above).
  if (Date.now() - lastReapAtMs >= REAP_MIN_INTERVAL_MS) {
    lastReapAtMs = Date.now();
    try {
      const reap = await reapStaleExecutionRuns(supabase);
      if (reap.ok && reap.reapedCount > 0) {
        console.warn(
          `[execution-runs] reaped ${reap.reapedCount} orphaned run(s): ${reap.reapedRunIds.join(", ")}`,
        );
      } else if (!reap.ok) {
        console.error(`[execution-runs] stale-run reap failed: ${reap.error}`);
      }
    } catch (err) {
      console.error(`[execution-runs] stale-run reap threw: ${err?.message || err}`);
    }
  }

  const { statusCode, body } = await claimNextQueuedExecutionRun(
    supabase,
    workerId,
    workerNotes,
  );

  return res.status(statusCode).json(body);
});

/**
 * Create an execution_run from a built cart.
 *
 * Modes (Phase 1 Week 1 Validate→Submit refactor, 2026-05-30):
 *   - "rpa_run"       — full pipeline. Worker runs Stages 1-5 against MILO.
 *                       Stage 5 submission stays triple-gated downstream
 *                       (metadata.mode + LK_ALLOW_ORDER_SUBMISSION env +
 *                       per-store allow_order_submission). Default when no
 *                       mode is provided (preserves existing callers).
 *   - "validate_only" — preview pipeline. Worker runs Stages 1-4 only and
 *                       finalizes succeeded with the live MILO cart state
 *                       captured to evidence (in-stock items, out-of-stock
 *                       items, ADA breakdown, validate messages). Used by
 *                       the scanner "Validate against MLCC" button so users
 *                       see exactly what MILO sees before they decide to
 *                       submit. ZERO chance of accidental submission — the
 *                       worker never enters Stage 5 for this mode.
 */
// "submit" is accepted (2026-06-26) but DORMANT — nothing calls it yet. The
// service downgrades it to dry_run unless env + store are both armed, and the
// worker re-checks both gates at runtime. Listed here only so the route
// doesn't 400 a future "submit" request before it reaches that logic.
const VALID_FROM_CART_MODES = new Set(["rpa_run", "validate_only", "submit"]);

router.post("/from-cart/:storeId/:cartId", async (req, res) => {
  const { storeId, cartId } = req.params;
  const mode = req.body?.mode;

  if (mode !== undefined && !VALID_FROM_CART_MODES.has(mode)) {
    return res.status(400).json({
      error: "INVALID_MODE",
      details: `mode must be one of: ${[...VALID_FROM_CART_MODES].join(", ")}`,
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

/**
 * POST /execution-runs/cart-reset/:storeId
 *
 * Creates a cart_reset_only execution run. The worker logs in to MILO,
 * navigates to /milo/cart, clicks Clear Cart, verifies empty, and
 * finalizes. No cart payload is required — the run carries metadata
 * and a store record only. Task #57 (2026-06-04).
 *
 * Idempotent: if an active cart_reset_only run is already in flight for
 * this store, the existing run id is returned instead of a 400.
 */
router.post("/cart-reset/:storeId", async (req, res) => {
  const { storeId } = req.params;
  const { statusCode, body } = await createCartResetExecutionRun(
    supabase,
    storeId,
    req.auth_user_id,
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
