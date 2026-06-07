/**
 * Onboarding activation modal (task #84, 2026-06-06).
 *
 * Renders RIGHT after a brand-new sign-up, before the user touches the
 * scanner. We fire a cart_reset_only RPA run as a no-op login probe
 * — it logs into MILO with the user's creds, navigates to the
 * products page, and runs a (likely no-op) cart clear. Total ~30-60s.
 *
 * Outcome handling:
 *   - Succeeded → "You're all set! Welcome to Liquor Kings."
 *                 onComplete() flips the parent flag and the scanner
 *                 renders normally.
 *   - Failed    → "We couldn't connect to MILO." User gets clear
 *                 messaging + option to skip into the scanner (they
 *                 can fix creds later via a future settings page).
 *
 * Why this matters: the #1 SaaS-bounce trigger for a tool like LK is
 * "I signed up, opened the scanner, hit Validate, and it said
 * something broken — guess this doesn't work." By verifying creds
 * up-front we either onboard them with confidence or fail loud at the
 * right time, when they still have hands on the form.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRunSummary,
  isTerminalStatus,
  triggerMlccCartReset,
} from "../api/execution";
import { MlccCredentialsForm } from "./MlccCredentialsForm";

const STAGES: Array<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Signing into MLCC" },
  { id: "rpa_navigate", label: "Loading your products page" },
  { id: "rpa_cart_reset", label: "Confirming connection" },
];

type ActivationState =
  | { kind: "starting" }
  | { kind: "running"; runId: string; progressStage: string | null }
  | { kind: "succeeded" }
  | { kind: "failed"; message: string };

export function OnboardingActivation({
  onComplete,
  storeName,
  storeId,
}: {
  onComplete: () => void;
  storeName: string;
  /**
   * The newly-created store's id, returned by /auth/signup. Used to
   * override the build-time VITE_SCANNER_STORE_ID since this user
   * isn't a member of that store. When null (shouldn't happen but
   * defensive), we surface a clear error instead of silently calling
   * with the wrong store.
   */
  storeId: string | null;
}) {
  const [state, setState] = useState<ActivationState>({ kind: "starting" });
  const startedRef = useRef(false);
  // When user clicks "Update MLCC credentials" inside the failure
  // state, expand the inline form. After they save, we auto-retry
  // the probe with the new creds.
  const [showFixCreds, setShowFixCreds] = useState(false);

  const begin = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setState({ kind: "starting" });

    if (!storeId) {
      setState({
        kind: "failed",
        message:
          "We couldn't find your new store record. Skip for now — you can verify your MLCC connection from the scanner later.",
      });
      return;
    }

    const trigger = await triggerMlccCartReset(storeId);
    if (!trigger.ok) {
      setState({
        kind: "failed",
        message:
          "We couldn't reach our servers. Please check your internet and try again, or skip for now.",
      });
      return;
    }

    setState({ kind: "running", runId: trigger.runId, progressStage: null });

    // Poll every 2s up to 3 min.
    const start = Date.now();
    const MAX_POLL_MS = 180_000;
    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      const summary = await getRunSummary({
        runId: trigger.runId,
        overrideStoreId: storeId,
      });
      if (!summary.ok) continue;
      setState({
        kind: "running",
        runId: trigger.runId,
        progressStage: summary.summary.progress_stage ?? null,
      });
      if (isTerminalStatus(summary.summary.status)) {
        if (summary.summary.status === "succeeded") {
          setState({ kind: "succeeded" });
          // Auto-dismiss after 2.5s so they land in the scanner.
          setTimeout(() => onComplete(), 2500);
        } else {
          setState({
            kind: "failed",
            message: deriveFailureMessage(summary.summary),
          });
        }
        return;
      }
    }
    setState({
      kind: "failed",
      message:
        "MLCC is taking longer than expected. Your account is created — you can skip this and try Validate from the scanner.",
    });
  }, [onComplete, storeId]);

  useEffect(() => {
    void begin();
  }, [begin]);

  return (
    <div style={backdropStyle}>
      <div style={cardStyle}>
        {state.kind === "succeeded" ? (
          <>
            <div style={emojiStyle}>✅</div>
            <h2 style={titleStyle}>You&apos;re all set!</h2>
            <p style={subtitleStyle}>
              Welcome to Liquor Kings, {storeName}. We&apos;ve verified
              your MLCC connection. Dropping you into the scanner now.
            </p>
          </>
        ) : state.kind === "failed" ? (
          <>
            <div style={emojiStyle}>⚠️</div>
            <h2 style={titleStyle}>Couldn&apos;t verify connection</h2>
            <p style={subtitleStyle}>{state.message}</p>
            {showFixCreds && storeId ? (
              <div style={{ marginTop: 18 }}>
                <MlccCredentialsForm
                  overrideStoreId={storeId}
                  passwordRequired
                  submitLabel="Save & retry connection"
                  onSaved={() => {
                    setShowFixCreds(false);
                    startedRef.current = false;
                    void begin();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowFixCreds(false)}
                  style={{ ...secondaryBtnStyle, marginTop: 10 }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      startedRef.current = false;
                      void begin();
                    }}
                    style={primaryBtnStyle}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={onComplete}
                    style={secondaryBtnStyle}
                  >
                    Skip for now
                  </button>
                </div>
                {storeId ? (
                  <button
                    type="button"
                    onClick={() => setShowFixCreds(true)}
                    style={{
                      ...secondaryBtnStyle,
                      width: "100%",
                      marginTop: 10,
                      background: "rgba(58, 130, 247, 0.12)",
                      borderColor: "rgba(58, 130, 247, 0.4)",
                    }}
                  >
                    Update MLCC credentials
                  </button>
                ) : null}
                <p style={{ ...subtitleStyle, fontSize: 12, marginTop: 16, opacity: 0.6 }}>
                  Common causes: wrong MLCC username/password, MLCC site down,
                  account requires 2FA setup.
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div style={emojiStyle}>🔌</div>
            <h2 style={titleStyle}>Connecting to MLCC…</h2>
            <p style={subtitleStyle}>
              We&apos;re testing your MILO login to make sure everything
              works before you start scanning. Usually takes 30 to 60
              seconds.
            </p>
            <ul style={stageListStyle}>
              {STAGES.map((stage) => {
                const reached = stageHasReached(state, stage.id);
                const active = stageIsActive(state, stage.id);
                return (
                  <li key={stage.id} style={stageRowStyle}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 20,
                        marginRight: 10,
                        textAlign: "center",
                      }}
                    >
                      {reached ? "✓" : active ? "•" : "○"}
                    </span>
                    <span
                      style={{
                        opacity: reached ? 1 : active ? 0.9 : 0.5,
                      }}
                    >
                      {stage.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Map worker progress_stage value → STAGES index. Higher index means
 * progress further into the pipeline.
 */
function stageOrder(progressStage: string | null): number {
  if (!progressStage) return -1;
  if (progressStage === "rpa_login") return 0;
  if (progressStage === "rpa_navigate") return 1;
  if (progressStage === "rpa_cart_reset") return 2;
  if (progressStage === "completed") return 3;
  return -1;
}

function stageHasReached(state: ActivationState, stageId: string): boolean {
  if (state.kind === "succeeded") return true;
  if (state.kind !== "running") return false;
  const current = stageOrder(state.progressStage);
  const target = STAGES.findIndex((s) => s.id === stageId);
  return current > target;
}

function stageIsActive(state: ActivationState, stageId: string): boolean {
  if (state.kind !== "running") return false;
  const current = stageOrder(state.progressStage);
  const target = STAGES.findIndex((s) => s.id === stageId);
  return current === target;
}

function deriveFailureMessage(summary: {
  failure_type: string | null;
  progress_stage: string | null;
}): string {
  const ft = summary.failure_type ?? "";
  if (/invalid|credential|password|login/i.test(ft)) {
    return "Your MLCC username or password didn't work. Double-check the credentials you use at lara.michigan.gov and try again.";
  }
  if (/captcha|2fa|mfa/i.test(ft)) {
    return "MLCC is asking for a captcha or 2FA we can't complete automatically. Try signing into lara.michigan.gov directly first to clear any prompts, then retry.";
  }
  if (/network|timeout|unreachable/i.test(ft)) {
    return "MLCC is slow or down right now. Wait a couple minutes and try again.";
  }
  return `We hit an error during ${summary.progress_stage ?? "the connection check"}. Try again, or skip and try Validate from the scanner — it'll surface the real error message.`;
}

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 10, 14, 0.92)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 32,
  maxWidth: 460,
  width: "100%",
  color: "#fff",
};

const emojiStyle: React.CSSProperties = {
  fontSize: 48,
  textAlign: "center",
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  textAlign: "center",
  margin: "0 0 8px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.7)",
  textAlign: "center",
  lineHeight: 1.55,
  margin: 0,
};

const stageListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "20px 0 0",
};

const stageRowStyle: React.CSSProperties = {
  padding: "6px 0",
  fontSize: 14,
  fontVariantNumeric: "tabular-nums",
};

const primaryBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "#3a82f7",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
