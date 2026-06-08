/**
 * useSubmission — two-step Validate → Submit state machine for the
 * scanner cart drawer (Phase 1 Week 1 of V1 roadmap, 2026-05-30).
 *
 * Mirrors MILO's actual user flow exactly:
 *
 *   1. User clicks "Validate against MLCC"
 *      → `startValidate(items)` runs:
 *          a. Syncs local cart items to a server cart (one row per line)
 *          b. Triggers an execution_run with mode="validate_only"
 *          c. Polls /:runId/summary until terminal
 *          d. On success surfaces the live MILO cart state (in-stock,
 *             out-of-stock, totals, ADA breakdown, validate messages)
 *          → state moves to "validateDone"
 *      → ZERO chance of accidental submission — the worker never enters
 *        Stage 5 for this run.
 *   2. User reviews the result. Two paths:
 *      a. Edit cart (remove OOS, change quantities) → cart drawer calls
 *         `invalidateValidation()` → state moves back to "idle" so user
 *         must re-validate before re-submitting.
 *      b. Approve as-is → click Submit.
 *   3. User clicks "Submit Order"
 *      → `startSubmit()` runs:
 *          a. Cart is already on the server (synced during validate) — no
 *             re-sync unless the user added/removed items in between
 *          b. Triggers an execution_run with mode="rpa_run" (Stages 1-5)
 *          c. Polls until terminal
 *          → state moves to "submitDone"
 *      → Stage 5 is still triple-gated server-side. The submit button is
 *        a UX gate, not a security gate.
 *
 * Design notes:
 * - We keep cartId in the state so Submit can reuse the cart from Validate
 *   without re-syncing every line. Saves ~1 second of RPA setup per real
 *   order placed.
 * - `invalidateValidation()` is called by CartDrawer when the user
 *   mutates the cart (add/remove line, change qty). It moves state back
 *   to idle but preserves cartId so the next startValidate just re-syncs
 *   the changed lines on top.
 * - Both validate and submit flows share the same poll loop (extracted
 *   into pollUntilTerminal). One bug-fix surface, two consumers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CartItem } from "../types";
import { replaceCartLines } from "../api/cart";
import {
  getRunSummary,
  isTerminalStatus,
  triggerRpaRunFromCart,
  type RunMode,
  type RunStatus,
  type ValidateResult,
} from "../api/execution";

/**
 * State machine. Each state name describes WHICH side of the flow we're
 * in (validate vs. submit) and what step we're on.
 */
export type SubmissionState =
  | { kind: "idle" }
  // Validate flow
  | { kind: "validateSyncing"; itemsSynced: number; itemsTotal: number }
  | { kind: "validateStarting" }
  | {
      kind: "validatePolling";
      runId: string;
      status: RunStatus;
      progressStage: string | null;
      progressMessage: string | null;
      lastPolledAt: number;
    }
  | {
      kind: "validateDone";
      runId: string;
      finalStatus: RunStatus;
      cartId: string;
      validateResult: ValidateResult | null;
    }
  // Submit flow
  | { kind: "submitStarting"; cartId: string }
  | {
      kind: "submitPolling";
      runId: string;
      cartId: string;
      status: RunStatus;
      progressStage: string | null;
      progressMessage: string | null;
      lastPolledAt: number;
    }
  | {
      kind: "submitDone";
      runId: string;
      finalStatus: RunStatus;
      failureType: string | null;
      progressMessage: string | null;
    }
  // Terminal error
  | { kind: "error"; message: string; recoverable: boolean };

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes per phase

/**
 * Optional hook into a background pre-validate cache (task #47, 2026-06-02).
 * When provided, startValidate checks the cache first; on a hit the
 * state machine jumps straight to validateDone without re-running the
 * full sync+trigger+poll pipeline. Cache miss falls through to the
 * normal flow.
 */
export type BackgroundPreValidateCache = {
  getCachedResult: (
    items: CartItem[],
  ) => {
    cartId: string;
    validateResult: ValidateResult | null;
    finalStatus: "succeeded";
  } | null;
  invalidateCache: () => void;
};

export function useSubmission(
  preValidateCache?: BackgroundPreValidateCache,
): {
  state: SubmissionState;
  startValidate: (items: CartItem[]) => Promise<void>;
  startSubmit: () => Promise<void>;
  /**
   * Called by CartDrawer when the user mutates the cart after a validate.
   * Returns the state to idle so the Submit button gates on a fresh
   * validate. cartId is forgotten on purpose — the next validate will
   * sync from scratch to ensure the server cart matches the UI exactly.
   */
  invalidateValidation: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const cancelledRef = useRef(false);

  // Cleanup on unmount — abort any in-flight polling.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setState({ kind: "idle" });
  }, []);

  const invalidateValidation = useCallback(() => {
    cancelledRef.current = false;
    setState({ kind: "idle" });
  }, []);

  /**
   * Shared poll loop for both flows. Returns the terminal RunSummary on
   * success, or throws an Error with a UI-ready message on failure.
   *
   * onState lets the caller update its own state (validatePolling vs.
   * submitPolling) on each tick so the UI can show progress.
   */
  const pollUntilTerminal = useCallback(
    async (
      runId: string,
      onTick: (summary: {
        status: RunStatus;
        progressStage: string | null;
        progressMessage: string | null;
      }) => void,
    ): Promise<{
      status: RunStatus;
      failureType: string | null;
      progressMessage: string | null;
      validateResult: ValidateResult | null;
    }> => {
      const pollStart = Date.now();
      while (!cancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelledRef.current) {
          throw new Error("Polling cancelled");
        }
        if (Date.now() - pollStart > MAX_POLL_MS) {
          throw new Error(
            "Polling timed out after 5 minutes. The run may still complete in the background — check Orders.",
          );
        }
        const summaryRes = await getRunSummary({ runId });
        if (!summaryRes.ok) {
          // Transient API error — keep polling, don't fail immediately.
          // (5xx and network blips are handled by fetchWithRetry below.)
          continue;
        }
        const s = summaryRes.summary;
        const status = s.status;
        const progressStage = s.progress_stage;
        const progressMessage = s.progress_message;
        if (isTerminalStatus(status)) {
          return {
            status,
            failureType: s.failure_type,
            progressMessage,
            validateResult: s.validate_result ?? null,
          };
        }
        onTick({ status, progressStage, progressMessage });
      }
      throw new Error("Polling cancelled");
    },
    [],
  );

  /**
   * Trigger a from-cart run with the given mode, return the runId or
   * throw a UI-ready Error.
   */
  const triggerRun = useCallback(
    async (cartId: string, mode: RunMode): Promise<string> => {
      const triggerResult = await triggerRpaRunFromCart({ cartId, mode });
      if (!triggerResult.ok) {
        throw new Error(
          mode === "validate_only"
            ? `Could not start MLCC validate: ${triggerResult.error}`
            : `Could not start the MILO order pipeline: ${triggerResult.error}`,
        );
      }
      return triggerResult.runId;
    },
    [],
  );

  /**
   * Step 1: sync local cart to server. Returns the cartId from the last
   * successful add. Throws a UI-ready Error on the first failure.
   */
  const syncCart = useCallback(
    async (
      items: CartItem[],
      onProgress: (synced: number, total: number) => void,
    ): Promise<string> => {
      if (cancelledRef.current) throw new Error("Cancelled");
      // ONE bulk request instead of N sequential adds (perf 2026-06-07).
      onProgress(0, items.length);
      const result = await replaceCartLines(
        items.map((line) => ({
          mlccCode: line.product.code,
          quantity: line.quantity,
        })),
      );
      if (!result.ok) {
        throw new Error(`Could not sync cart to MLCC: ${result.error}`);
      }
      onProgress(items.length, items.length);
      return result.cartId;
    },
    [],
  );

  const startValidate = useCallback(
    async (items: CartItem[]) => {
      // Only allow validate from idle / error / completed states.
      if (
        state.kind !== "idle" &&
        state.kind !== "error" &&
        state.kind !== "validateDone" &&
        state.kind !== "submitDone"
      ) {
        return;
      }
      if (items.length === 0) {
        setState({
          kind: "error",
          message: "Cart is empty. Add items before validating.",
          recoverable: true,
        });
        return;
      }
      cancelledRef.current = false;

      /*
        Pre-validate cache check (task #47, 2026-06-02). If a
        background pre-validate completed for THIS exact cart, jump
        straight to validateDone without re-running the full pipeline.
        The cartId is reused too — Submit will skip the cart sync.
        Cache is invalidated on consume so the same result isn't shown
        repeatedly if the user clicks Re-validate.
      */
      if (preValidateCache) {
        const cached = preValidateCache.getCachedResult(items);
        if (cached) {
          setState({
            kind: "validateDone",
            runId: "background-prevalidate",
            finalStatus: cached.finalStatus,
            cartId: cached.cartId,
            validateResult: cached.validateResult,
          });
          preValidateCache.invalidateCache();
          return;
        }
      }

      // Phase 1.a: sync
      setState({
        kind: "validateSyncing",
        itemsSynced: 0,
        itemsTotal: items.length,
      });
      let cartId: string;
      try {
        cartId = await syncCart(items, (synced, total) =>
          setState({ kind: "validateSyncing", itemsSynced: synced, itemsTotal: total }),
        );
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
          recoverable: true,
        });
        return;
      }

      // Phase 1.b: trigger validate_only
      setState({ kind: "validateStarting" });
      let runId: string;
      try {
        runId = await triggerRun(cartId, "validate_only");
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
          recoverable: true,
        });
        return;
      }

      // Phase 1.c: poll
      setState({
        kind: "validatePolling",
        runId,
        status: "queued",
        progressStage: null,
        progressMessage: null,
        lastPolledAt: Date.now(),
      });
      try {
        const terminal = await pollUntilTerminal(runId, ({ status, progressStage, progressMessage }) =>
          setState({
            kind: "validatePolling",
            runId,
            status,
            progressStage,
            progressMessage,
            lastPolledAt: Date.now(),
          }),
        );
        setState({
          kind: "validateDone",
          runId,
          finalStatus: terminal.status,
          cartId,
          validateResult: terminal.validateResult,
        });
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
          recoverable: true,
        });
      }
    },
    [state.kind, syncCart, triggerRun, pollUntilTerminal, preValidateCache],
  );

  const startSubmit = useCallback(async () => {
    // Submit is only valid from validateDone (the only state that has a
    // cartId AND has been validated against MLCC).
    if (state.kind !== "validateDone") return;
    if (state.finalStatus !== "succeeded") return;
    const cartId = state.cartId;
    cancelledRef.current = false;

    // Phase 2.a: trigger rpa_run
    setState({ kind: "submitStarting", cartId });
    let runId: string;
    try {
      runId = await triggerRun(cartId, "rpa_run");
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      });
      return;
    }

    // Phase 2.b: poll
    setState({
      kind: "submitPolling",
      runId,
      cartId,
      status: "queued",
      progressStage: null,
      progressMessage: null,
      lastPolledAt: Date.now(),
    });
    try {
      const terminal = await pollUntilTerminal(runId, ({ status, progressStage, progressMessage }) =>
        setState({
          kind: "submitPolling",
          runId,
          cartId,
          status,
          progressStage,
          progressMessage,
          lastPolledAt: Date.now(),
        }),
      );
      setState({
        kind: "submitDone",
        runId,
        finalStatus: terminal.status,
        failureType: null,
        progressMessage: terminal.progressMessage,
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      });
    }
  }, [state, triggerRun, pollUntilTerminal]);

  return { state, startValidate, startSubmit, invalidateValidation, reset };
}
