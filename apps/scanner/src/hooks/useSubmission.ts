import { useCallback, useEffect, useRef, useState } from "react";
import type { CartItem } from "../types";
import { addCartLine } from "../api/cart";
import {
  getRunSummary,
  isTerminalStatus,
  triggerRpaRunFromCart,
  type RunStatus,
} from "../api/execution";

export type SubmissionState =
  | { kind: "idle" }
  | { kind: "syncing"; itemsSynced: number; itemsTotal: number }
  | { kind: "submitting" }
  | {
      kind: "polling";
      runId: string;
      status: RunStatus;
      progressStage: string | null;
      progressMessage: string | null;
      lastPolledAt: number;
    }
  | {
      kind: "done";
      runId: string;
      finalStatus: RunStatus;
      failureType: string | null;
      progressMessage: string | null;
    }
  | { kind: "error"; message: string; recoverable: boolean };

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes

export function useSubmission(): {
  state: SubmissionState;
  start: (items: CartItem[]) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });
  const cancelledRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setState({ kind: "idle" });
  }, []);

  const start = useCallback(
    async (items: CartItem[]) => {
      if (state.kind !== "idle" && state.kind !== "error" && state.kind !== "done") {
        return;
      }
      if (items.length === 0) {
        setState({
          kind: "error",
          message: "Cart is empty. Add items before submitting.",
          recoverable: true,
        });
        return;
      }
      cancelledRef.current = false;

      // Phase 1: sync local cart lines to server
      setState({ kind: "syncing", itemsSynced: 0, itemsTotal: items.length });

      let cartId: string | null = null;
      for (let i = 0; i < items.length; i += 1) {
        if (cancelledRef.current) return;
        const line = items[i];
        const result = await addCartLine({
          mlccCode: line.product.code,
          quantity: line.quantity,
        });
        if (!result.ok) {
          setState({
            kind: "error",
            message: `Could not sync item ${line.product.code} (${line.product.name}): ${result.error}`,
            recoverable: true,
          });
          return;
        }
        cartId = result.cart.id;
        setState({ kind: "syncing", itemsSynced: i + 1, itemsTotal: items.length });
      }

      if (!cartId) {
        setState({
          kind: "error",
          message: "Sync completed but no cart id was returned.",
          recoverable: true,
        });
        return;
      }

      // Phase 2: trigger the RPA run
      setState({ kind: "submitting" });
      const triggerResult = await triggerRpaRunFromCart({ cartId });
      if (!triggerResult.ok) {
        setState({
          kind: "error",
          message: `Could not start the MILO order pipeline: ${triggerResult.error}`,
          recoverable: true,
        });
        return;
      }

      // Phase 3: poll for status until terminal
      const pollStart = Date.now();
      let lastSummary = {
        runId: triggerResult.runId,
        status: triggerResult.status,
        progressStage: null as string | null,
        progressMessage: null as string | null,
      };
      setState({
        kind: "polling",
        runId: lastSummary.runId,
        status: lastSummary.status,
        progressStage: lastSummary.progressStage,
        progressMessage: lastSummary.progressMessage,
        lastPolledAt: Date.now(),
      });

      while (!cancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelledRef.current) return;
        if (Date.now() - pollStart > MAX_POLL_MS) {
          setState({
            kind: "error",
            message:
              "Polling timed out after 5 minutes. The run may still complete in the background — check Orders.",
            recoverable: true,
          });
          return;
        }
        const summaryRes = await getRunSummary({ runId: lastSummary.runId });
        if (!summaryRes.ok) {
          // transient: keep polling, don't fail immediately
          continue;
        }
        const s = summaryRes.summary;
        lastSummary = {
          runId: s.id,
          status: s.status,
          progressStage: s.progress_stage,
          progressMessage: s.progress_message,
        };
        if (isTerminalStatus(s.status)) {
          setState({
            kind: "done",
            runId: s.id,
            finalStatus: s.status,
            failureType: s.failure_type,
            progressMessage: s.progress_message,
          });
          return;
        }
        setState({
          kind: "polling",
          runId: lastSummary.runId,
          status: lastSummary.status,
          progressStage: lastSummary.progressStage,
          progressMessage: lastSummary.progressMessage,
          lastPolledAt: Date.now(),
        });
      }
    },
    [state.kind],
  );

  return { state, start, reset };
}
