/**
 * Shared MLCC cart_reset_only probe used by VerifyMlccBanner and Settings.
 * Logs into MILO via the execution-runs pipeline and polls until terminal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRunSummary,
  isTerminalStatus,
  triggerMlccCartReset,
} from "../api/execution";

export type MlccVerifyState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "succeeded" }
  | { kind: "failed"; message: string };

export function humanizeProbeError(raw: string): string {
  if (/credential|invalid|password|login/i.test(raw)) {
    return "Your MLCC username or password didn't work. Update them below.";
  }
  if (/captcha|2fa|mfa/i.test(raw)) {
    return "MLCC is asking for a captcha or 2FA. Sign in at lara.michigan.gov first, then retry.";
  }
  if (/network|timeout|unreachable/i.test(raw)) {
    return "MLCC is slow or unreachable. Try again in a minute.";
  }
  return "We couldn't connect to MLCC. Try again, or check your credentials below.";
}

export function useMlccVerifyProbe(onVerified?: () => void) {
  const [state, setState] = useState<MlccVerifyState>({ kind: "idle" });
  const pollingRef = useRef(false);

  const runProbe = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setState({ kind: "running" });
    const trigger = await triggerMlccCartReset();
    if (!trigger.ok) {
      pollingRef.current = false;
      setState({
        kind: "failed",
        message: humanizeProbeError(trigger.error),
      });
      return;
    }

    /*
      P0 (2026-06-14, Sweep 2): never give up while the run is still
      genuinely in flight. The execution_runs reaper bounds every run's
      lifetime to ~15 minutes (STALE_RUN_MINUTES), so 16 minutes is a
      true upper bound, not an arbitrary guess. Giving up earlier and
      telling the user to "try again" risked firing a second
      cart_reset_only run that queues behind the first (busyStores),
      doubling the wait. Back off to 10s polls after the first minute
      to keep request volume sane during the long tail.
    */
    const start = Date.now();
    const POLL_BACKOFF_AFTER_MS = 60_000;
    const POLL_BACKOFF_INTERVAL_MS = 10_000;
    const MAX_POLL_MS = 16 * 60 * 1000;
    let interval = 2000;
    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, interval));
      if (Date.now() - start > POLL_BACKOFF_AFTER_MS) {
        interval = POLL_BACKOFF_INTERVAL_MS;
      }
      const summary = await getRunSummary({ runId: trigger.runId });
      if (!summary.ok) continue;
      if (isTerminalStatus(summary.summary.status)) {
        pollingRef.current = false;
        if (summary.summary.status === "succeeded") {
          onVerified?.();
          setState({ kind: "succeeded" });
        } else {
          setState({
            kind: "failed",
            message: humanizeProbeError(
              summary.summary.failure_type ?? "Unknown error",
            ),
          });
        }
        return;
      }
    }
    pollingRef.current = false;
    setState({
      kind: "failed",
      message:
        "MLCC is taking unusually long. It's still running in the background — check back in a few minutes before trying again.",
    });
  }, [onVerified]);

  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  return { state, runProbe };
}
