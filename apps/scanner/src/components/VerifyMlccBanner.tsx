/**
 * VerifyMlccBanner — task #88, 2026-06-06.
 *
 * Shown on the scanner home when the current store's
 * `mlcc_credentials_last_verified_at` is null. Lets the user verify
 * their MLCC connection in one tap without going through full
 * onboarding activation again — useful when:
 *   - They skipped the activation modal at signup
 *   - They updated their MLCC creds and want to confirm the new
 *     ones work
 *   - A failed activation never finished a probe
 *
 * The probe itself reuses the same `cart_reset_only` execution-run
 * type as onboarding activation. On success the home re-fetches
 * smart cards and the banner naturally disappears because the
 * backend has stamped last_verified_at.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRunSummary,
  isTerminalStatus,
  triggerMlccCartReset,
} from "../api/execution";

type Props = {
  onVerified: () => void;
};

type BannerState =
  | { kind: "idle" }
  | { kind: "running"; runId: string }
  | { kind: "failed"; message: string };

export function VerifyMlccBanner({ onVerified }: Props) {
  const [state, setState] = useState<BannerState>({ kind: "idle" });
  const pollingRef = useRef(false);

  const runProbe = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setState({ kind: "running", runId: "pending" });
    const trigger = await triggerMlccCartReset();
    if (!trigger.ok) {
      pollingRef.current = false;
      setState({
        kind: "failed",
        message: humanizeProbeError(trigger.error),
      });
      return;
    }
    setState({ kind: "running", runId: trigger.runId });

    const start = Date.now();
    const MAX_POLL_MS = 180_000;
    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      const summary = await getRunSummary({ runId: trigger.runId });
      if (!summary.ok) continue;
      if (isTerminalStatus(summary.summary.status)) {
        pollingRef.current = false;
        if (summary.summary.status === "succeeded") {
          // Backend has now stamped last_verified_at — let parent
          // re-fetch smart cards which will hide this banner.
          onVerified();
          setState({ kind: "idle" });
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

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={titleStyle}>
          {state.kind === "running"
            ? "Verifying MLCC connection…"
            : "Verify your MLCC connection"}
        </div>
        <div style={subtitleStyle}>
          {state.kind === "failed"
            ? state.message
            : state.kind === "running"
              ? "Logging into MILO. Usually takes 30-60 seconds."
              : "We haven't confirmed your MILO login works yet. One-tap test."}
        </div>
      </div>
      {state.kind === "running" ? (
        <div style={spinnerStyle} aria-hidden>
          ⏳
        </div>
      ) : (
        <button type="button" onClick={runProbe} style={btnStyle}>
          {state.kind === "failed" ? "Retry" : "Verify"}
        </button>
      )}
    </div>
  );
}

function humanizeProbeError(raw: string): string {
  if (/credential|invalid|password|login/i.test(raw)) {
    return "Your MLCC username or password didn't work. Update them in Settings.";
  }
  if (/captcha|2fa|mfa/i.test(raw)) {
    return "MLCC is asking for a captcha or 2FA. Sign in at lara.michigan.gov first, then retry.";
  }
  if (/network|timeout|unreachable/i.test(raw)) {
    return "MLCC is slow or unreachable. Try again in a minute.";
  }
  return "We couldn't connect to MLCC. Try again, or check your creds in Settings.";
}

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 14px",
  margin: "10px 0",
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid rgba(245, 158, 11, 0.32)",
  borderRadius: 10,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#fde6b3",
  lineHeight: 1.3,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(253, 230, 179, 0.7)",
  marginTop: 2,
  lineHeight: 1.4,
};

const btnStyle: React.CSSProperties = {
  background: "#f59e0b",
  color: "#1a1208",
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const spinnerStyle: React.CSSProperties = {
  fontSize: 20,
  padding: "6px 12px",
};
