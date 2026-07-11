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
  type SubmitResult,
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
      /** When THIS polling phase began — drives the elapsed-time UI. */
      startedAtMs: number;
    }
  | {
      kind: "validateDone";
      runId: string;
      finalStatus: RunStatus;
      cartId: string;
      validateResult: ValidateResult | null;
      /**
       * Why the run failed, when finalStatus !== "succeeded". Quality
       * mandate (2026-06-12): "finished as failed" with no explanation is
       * itself a failure. Feed these through humanizeRunFailure() for the
       * one-sentence UI copy.
       */
      failureType: string | null;
      failureMessage: string | null;
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
      /** When THIS polling phase began — drives the elapsed-time UI. */
      startedAtMs: number;
    }
  | {
      kind: "submitDone";
      runId: string;
      finalStatus: RunStatus;
      failureType: string | null;
      failureMessage: string | null;
      progressMessage: string | null;
      /**
       * Truth source for "did MILO actually receive an order" (audit #15).
       * A succeeded run with submitResult?.submitted !== true was a
       * dry-run downgrade — the UI must say NOTHING WAS ORDERED.
       */
      submitResult: SubmitResult | null;
    }
  // Terminal error
  | { kind: "error"; message: string; recoverable: boolean };

const POLL_INTERVAL_MS = 2500;
// P0 (2026-06-14): pollUntilTerminal used to throw "Polling timed out after
// 5 minutes" at MAX_POLL_MS, dumping the user into a dead-end `error` state
// that LOST the runId. CartDrawer's honestSlowMessage promises "MILO is slow
// today. We keep at it until it answers" — the 5-minute throw made that a
// lie. The 2026-06-14 incident showed exactly this: a real validate run was
// delayed by a worker-side bug, the client gave up at 5:00, and when the run
// actually finished (succeeded, all items checked against MILO) the UI was
// stuck showing "Validate against MLCC" as if nothing had happened — even
// though MILO's own cart showed the full validated result.
//
// Fix: never give up. After POLL_BACKOFF_AFTER_MS, ease off the poll cadence
// (no point hammering every 2.5s for a run that's taking minutes) but keep
// polling until the run reaches a terminal status or the component unmounts
// (cancelledRef). validate_only is provably safe to wait on indefinitely —
// Stage 5 (checkout) is never reached.
const POLL_BACKOFF_AFTER_MS = 60 * 1000;
const POLL_BACKOFF_INTERVAL_MS = 10_000;

/**
 * Optional hook into a background pre-validate cache (task #47, 2026-06-02).
 * When provided, startValidate checks the cache first; on a hit the
 * state machine jumps straight to validateDone without re-running the
 * full sync+trigger+poll pipeline. Cache miss falls through to the
 * normal flow.
 */
type PreValidateHit = {
  cartId: string;
  /**
   * The REAL execution run id behind the pre-validate (2026-07-11).
   * Consumers hand it to the order tracker so the pill follows the
   * actual run instead of the old "background-prevalidate" placeholder.
   */
  runId: string;
  validateResult: ValidateResult | null;
  finalStatus: "succeeded";
};

export type BackgroundPreValidateCache = {
  getCachedResult: (items: CartItem[]) => PreValidateHit | null;
  /**
   * If a background pre-validate is mid-flight for this exact cart,
   * returns its promise so we latch onto it instead of starting a
   * duplicate run. Null if nothing matching is in flight.
   */
  getInFlight?: (
    items: CartItem[],
  ) => Promise<PreValidateHit | null> | null;
  /**
   * Like getInFlight but exposes the live run itself (2026-07-11):
   * { runId, promise } for this exact cart, or null. runId is null
   * during the brief window before the server assigns one. fireOrder
   * uses this to track the existing run instead of creating a twin.
   */
  getInFlightRun?: (
    items: CartItem[],
  ) => { runId: string | null; promise: Promise<PreValidateHit | null> } | null;
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
  /**
   * Cancel any in-flight validate/submit poll and return to idle. Safe to
   * call mid-poll (unlike reset, which assumes nothing is running). Used by
   * the CartDrawer "Start over" escape hatch after recoverStore() confirms a
   * stuck run was cleared.
   */
  cancelActiveRun: () => void;
  /**
   * Non-blocking fire path (P1b): sync + trigger a full rpa_run, return the
   * runId without polling. The caller hands the runId to the app-level
   * active-order tracker. See implementation below.
   */
  fireOrder: (
    items: CartItem[],
    mode?: RunMode,
  ) => Promise<{ ok: true; runId: string } | { ok: false; error: string }>;
} {
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const cancelledRef = useRef(false);
  /**
   * Monotonic "run generation" (2026-06-26). Bumped on every cancel and at
   * the start of every new validate/submit run; each poll loop captures the
   * gen it started with and bails the moment runGenRef diverges.
   *
   * A lone boolean cancelledRef can't tell "cancelled because the user
   * started over" apart from "still running" — so once a fresh run reset the
   * flag back to false, an OLD poll loop (still suspended in its sleep) would
   * wake back up and clobber state with the stale runId's progress / result.
   * The generation closes that hole: cancelActiveRun() bumps it, the old loop
   * sees the mismatch and exits silently, and a brand-new validate gets a
   * brand-new gen that no surviving loop shares.
   */
  const runGenRef = useRef(0);

  // Cleanup on unmount — abort any in-flight polling.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      runGenRef.current += 1;
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
   * Cancel any in-flight validate/submit poll AND reset to idle in one step.
   * Used by the CartDrawer "Start over" escape hatch after recoverStore()
   * confirms a stuck run was cleared. Unlike reset()/invalidateValidation()
   * (which assume no poll is running), this is safe to call mid-poll: it
   * bumps runGenRef so the suspended poll loop exits on its next tick
   * WITHOUT its catch branch clobbering our idle state with a stale
   * "Polling cancelled" error, and without reviving once a new run starts.
   */
  const cancelActiveRun = useCallback(() => {
    runGenRef.current += 1;
    cancelledRef.current = true;
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
      /**
       * Generation this poll belongs to. The loop exits the instant
       * runGenRef diverges (cancel / supersede / unmount) so a stale poll
       * can never revive and overwrite state belonging to a newer run.
       */
      gen: number,
    ): Promise<{
      status: RunStatus;
      failureType: string | null;
      failureMessage: string | null;
      progressMessage: string | null;
      validateResult: ValidateResult | null;
      submitResult: SubmitResult | null;
    }> => {
      const pollStart = Date.now();
      let interval = POLL_INTERVAL_MS;
      while (!cancelledRef.current && runGenRef.current === gen) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        if (cancelledRef.current || runGenRef.current !== gen) {
          throw new Error("Polling cancelled");
        }
        if (Date.now() - pollStart > POLL_BACKOFF_AFTER_MS) {
          interval = POLL_BACKOFF_INTERVAL_MS;
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
            failureMessage: s.failure_message ?? null,
            progressMessage,
            validateResult: s.validate_result ?? null,
            submitResult: s.submit_result ?? null,
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
      // Claim a fresh generation for this run. Any poll still lingering
      // from a previous (cancelled) run now has a stale gen and will bail.
      const gen = ++runGenRef.current;

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
            runId: cached.runId,
            finalStatus: cached.finalStatus,
            cartId: cached.cartId,
            validateResult: cached.validateResult,
            failureType: null,
            failureMessage: null,
          });
          preValidateCache.invalidateCache();
          return;
        }

        /*
          No finished cache, but a pre-validate may be RUNNING for this
          exact cart. Latch onto it instead of starting a wasteful
          duplicate run — this is the common case (user taps Validate
          while the background run is still going) and the big perceived
          speedup. We show the polling UI while we wait on it; if it
          resolves with a result we're done, otherwise we fall through to
          a fresh run below.
        */
        const inFlight = preValidateCache.getInFlight?.(items);
        if (inFlight) {
          setState({
            kind: "validatePolling",
            runId: "background-prevalidate",
            status: "running",
            progressStage: "validate",
            progressMessage: "Finishing the MLCC check already in progress…",
            lastPolledAt: Date.now(),
            startedAtMs: Date.now(),
          });
          let latched: PreValidateHit | null = null;
          try {
            latched = await inFlight;
          } catch {
            latched = null;
          }
          if (cancelledRef.current || runGenRef.current !== gen) return;
          if (latched) {
            setState({
              kind: "validateDone",
              runId: latched.runId,
              finalStatus: latched.finalStatus,
              cartId: latched.cartId,
              validateResult: latched.validateResult,
              failureType: null,
              failureMessage: null,
            });
            preValidateCache.invalidateCache();
            return;
          }
          // else: in-flight run failed/stale — fall through to a fresh run.
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
      const validatePollStart = Date.now();
      setState({
        kind: "validatePolling",
        runId,
        status: "queued",
        progressStage: null,
        progressMessage: null,
        lastPolledAt: Date.now(),
        startedAtMs: validatePollStart,
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
            startedAtMs: validatePollStart,
          }),
        gen);
        // Superseded (cancelActiveRun started a new run, or unmounted):
        // the canceler already set the desired state — don't overwrite it
        // with this run's terminal result, and don't surface a stale error.
        if (runGenRef.current !== gen) return;
        setState({
          kind: "validateDone",
          runId,
          finalStatus: terminal.status,
          cartId,
          validateResult: terminal.validateResult,
          failureType: terminal.failureType,
          failureMessage: terminal.failureMessage,
        });
      } catch (e) {
        if (runGenRef.current !== gen) return;
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
    const gen = ++runGenRef.current;

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
    const submitPollStart = Date.now();
    setState({
      kind: "submitPolling",
      runId,
      cartId,
      status: "queued",
      progressStage: null,
      progressMessage: null,
      lastPolledAt: Date.now(),
      startedAtMs: submitPollStart,
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
          startedAtMs: submitPollStart,
        }),
      gen);
      // Superseded by a cancel — leave state as the canceler set it.
      if (runGenRef.current !== gen) return;
      setState({
        kind: "submitDone",
        runId,
        finalStatus: terminal.status,
        // Was hardcoded null (found 2026-06-12) — the submit flow threw
        // the failure explanation away. Quality mandate: every failure
        // states its reason.
        failureType: terminal.failureType,
        failureMessage: terminal.failureMessage,
        progressMessage: terminal.progressMessage,
        submitResult: terminal.submitResult,
      });
    } catch (e) {
      if (runGenRef.current !== gen) return;
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      });
    }
  }, [state, triggerRun, pollUntilTerminal]);

  /**
   * Non-blocking "fire and notify" order path (async pivot P1b, 2026-06-26).
   * Syncs the cart + triggers a full rpa_run, returns the runId immediately,
   * and DOES NOT poll — the app-level ActiveOrderProvider picks up tracking
   * via trackOrder(runId, "rpa_run"). The drawer closes right after, the
   * persistent OrderStatusPill shows progress, and the user is free.
   *
   * Reuses the existing syncCart + triggerRun primitives. Additive only —
   * startValidate/startSubmit/pollUntilTerminal and the state machine are
   * untouched (they're now unreached from the primary flow; cleanup is a
   * later portion). Submission stays triple-gated server-side.
   */
  const fireOrder = useCallback(
    async (
      items: CartItem[],
      mode: RunMode = "rpa_run",
    ): Promise<{ ok: true; runId: string } | { ok: false; error: string }> => {
      try {
        if (items.length === 0) return { ok: false, error: "Cart is empty." };

        /*
          Run-dedupe latch (2026-07-11). The one-tap "Check Order" path
          used to fire a fresh validate run unconditionally while the
          background pre-validate was ALREADY checking the identical
          cart — order day 7/9 logged 4 duplicate runs in 66 seconds,
          each pushing its own banner. For a CHECK (validate_only) we
          reuse what already exists, in order of preference:

            1. A fresh cached result (same cart, <5 min old) — return
               its real runId; the pill fetches the summary and lands on
               the result instantly. No new run, no second banner.
               Consumes the cache so a deliberate re-tap re-checks.
            2. A live in-flight pre-validate for this exact cart —
               return its runId; the pill tracks the run mid-flight.

          STRICTLY validate_only: an armed "submit" NEVER latches onto
          anything — every submit is a deliberate, fresh, fully-gated
          run (server re-gates regardless). If the in-flight run exists
          but hasn't been assigned its id yet (the ~1s sync window), we
          fall through — the SERVER dedupes identical in-flight
          validates too (execution-run.service.js, 2026-07-11), so even
          that window can't produce twins.
        */
        if (mode === "validate_only" && preValidateCache) {
          const cached = preValidateCache.getCachedResult(items);
          if (cached) {
            preValidateCache.invalidateCache();
            return { ok: true, runId: cached.runId };
          }
          const inFlightRun = preValidateCache.getInFlightRun?.(items);
          if (inFlightRun?.runId) {
            return { ok: true, runId: inFlightRun.runId };
          }
        }

        const cartId = await syncCart(items, () => {});
        const runId = await triggerRun(cartId, mode);
        return { ok: true, runId };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [syncCart, triggerRun, preValidateCache],
  );

  return { state, startValidate, startSubmit, invalidateValidation, reset, cancelActiveRun, fireOrder };
}
