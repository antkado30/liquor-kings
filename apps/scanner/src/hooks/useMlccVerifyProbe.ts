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

    const start = Date.now();
    const MAX_POLL_MS = 180_000;
    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, 2000));
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
      message: "MLCC is taking too long. Try again in a minute.",
    });
  }, [onVerified]);

  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  return { state, runProbe };
}
