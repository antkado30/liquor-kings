/**
 * Onboarding activation modal (task #84, 2026-06-06).
 *
 * Renders RIGHT after a brand-new sign-up, before the user touches the
 * scanner. We fire a cart_reset_only RPA run as a no-op login probe
 * — it logs into MILO with the user's creds, navigates to the
 * products page, and runs a (likely no-op) cart clear. Total ~30-60s.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRunSummary,
  isTerminalStatus,
  triggerMlccCartReset,
} from "../api/execution";
import { humanizeNetworkError } from "../api/me";
import { MlccCredentialsForm } from "./MlccCredentialsForm";
import { IconAlert, IconCheck, IconLoader } from "./Icons";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";

const STAGES: Array<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Signing into MLCC" },
  { id: "rpa_navigate", label: "Loading your products page" },
  { id: "rpa_cart_reset", label: "Confirming connection" },
];

const MAX_POLL_MS = 180_000;
const MAX_POLL_FAILURES = 6;

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
  storeId: string | null;
}) {
  useLockBodyScroll();
  const [state, setState] = useState<ActivationState>({ kind: "starting" });
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [showFixCreds, setShowFixCreds] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (state.kind !== "starting" && state.kind !== "running") return;
    const t = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [state.kind]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const begin = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    cancelledRef.current = false;
    setShowFixCreds(false);
    setElapsedSec(0);
    setState({ kind: "starting" });

    if (!storeId) {
      startedRef.current = false;
      setState({
        kind: "failed",
        message:
          "We couldn't find your new store record. Skip for now — you can verify your MLCC connection from the scanner home.",
      });
      return;
    }

    const trigger = await triggerMlccCartReset(storeId);
    if (cancelledRef.current) return;

    if (!trigger.ok) {
      startedRef.current = false;
      setState({
        kind: "failed",
        message: humanizeNetworkError(trigger.error),
      });
      return;
    }

    setState({ kind: "running", runId: trigger.runId, progressStage: null });

    const start = Date.now();
    let pollFailures = 0;

    while (Date.now() - start < MAX_POLL_MS) {
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 2000));

      const summary = await getRunSummary({
        runId: trigger.runId,
        overrideStoreId: storeId,
      });

      if (cancelledRef.current) return;

      if (!summary.ok) {
        pollFailures += 1;
        if (pollFailures >= MAX_POLL_FAILURES) {
          startedRef.current = false;
          setState({
            kind: "failed",
            message:
              "Lost connection while verifying. Check your internet and try again.",
          });
          return;
        }
        continue;
      }

      pollFailures = 0;
      setState({
        kind: "running",
        runId: trigger.runId,
        progressStage: summary.summary.progress_stage ?? null,
      });

      if (isTerminalStatus(summary.summary.status)) {
        if (summary.summary.status === "succeeded") {
          setState({ kind: "succeeded" });
          window.setTimeout(() => onComplete(), 2500);
        } else {
          startedRef.current = false;
          setState({
            kind: "failed",
            message: deriveFailureMessage(summary.summary),
          });
        }
        return;
      }
    }

    startedRef.current = false;
    setState({
      kind: "failed",
      message:
        "MLCC is taking longer than expected. Your account is ready — skip for now and verify from the scanner home.",
    });
  }, [onComplete, storeId]);

  useEffect(() => {
    void begin();
  }, [begin]);

  const retryProbe = () => {
    startedRef.current = false;
    void begin();
  };

  return (
    <div className="onboarding-activation-backdrop" role="dialog" aria-modal="true">
      <div className="onboarding-activation-card">
        {state.kind === "succeeded" ? (
          <>
            <div className="onboarding-activation-icon onboarding-activation-icon--success">
              <IconCheck size={28} strokeWidth={2.2} />
            </div>
            <h2 className="onboarding-activation-heading">You&apos;re all set!</h2>
            <p className="onboarding-activation-copy">
              Welcome to Liquor Kings, {storeName}. We&apos;ve verified your MLCC
              connection — opening the scanner now.
            </p>
          </>
        ) : state.kind === "failed" ? (
          <>
            <div className="onboarding-activation-icon onboarding-activation-icon--failed">
              <IconAlert size={28} strokeWidth={2} />
            </div>
            <h2 className="onboarding-activation-heading">
              Couldn&apos;t verify connection
            </h2>
            <p className="onboarding-activation-copy">{state.message}</p>

            {showFixCreds && storeId ? (
              <div className="onboarding-activation-fix">
                <p className="onboarding-hint" style={{ marginBottom: 12 }}>
                  Update the same username and password you use at
                  lara.michigan.gov. We&apos;ll retry the connection check
                  automatically.
                </p>
                <MlccCredentialsForm
                  overrideStoreId={storeId}
                  passwordRequired
                  submitLabel="Save & retry connection"
                  onSaved={() => {
                    retryProbe();
                  }}
                />
                <button
                  type="button"
                  className="onboarding-btn onboarding-btn--ghost onboarding-btn--block"
                  style={{ marginTop: 10 }}
                  onClick={() => setShowFixCreds(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="onboarding-activation-actions">
                  <button
                    type="button"
                    className="onboarding-btn onboarding-btn--primary"
                    onClick={retryProbe}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className="onboarding-btn onboarding-btn--secondary"
                    onClick={onComplete}
                  >
                    Skip for now
                  </button>
                </div>
                {storeId ? (
                  <button
                    type="button"
                    className="onboarding-btn onboarding-btn--primary onboarding-btn--block"
                    style={{ marginTop: 10 }}
                    onClick={() => setShowFixCreds(true)}
                  >
                    Fix credentials
                  </button>
                ) : null}
                <p className="onboarding-activation-footnote">
                  Common causes: wrong MLCC username or password, MLCC site
                  maintenance, or an account prompt (captcha / 2FA) on MILO.
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div className="onboarding-activation-icon onboarding-activation-icon--running">
              <span className="settings-spinner" aria-hidden>
                <IconLoader size={28} strokeWidth={2} />
              </span>
            </div>
            <h2 className="onboarding-activation-heading">
              Verifying your MLCC connection…
            </h2>
            <p className="onboarding-activation-copy">
              We&apos;re signing into MILO with your credentials to confirm
              everything works before you start scanning. This usually takes
              30–60 seconds — please keep this screen open.
            </p>
            {elapsedSec >= 20 ? (
              <p className="onboarding-activation-footnote">
                Still working… {elapsedSec}s elapsed. MLCC can be slow during
                peak hours.
              </p>
            ) : null}
            <ul className="onboarding-activation-stages" aria-label="Verification progress">
              {STAGES.map((stage) => {
                const reached = stageHasReached(state, stage.id);
                const active = stageIsActive(state, stage.id);
                const stageClass = reached
                  ? "onboarding-activation-stage--done"
                  : active
                    ? "onboarding-activation-stage--active"
                    : "onboarding-activation-stage--pending";
                return (
                  <li
                    key={stage.id}
                    className={`onboarding-activation-stage ${stageClass}`}
                  >
                    <span
                      className={`onboarding-activation-stage__icon ${
                        reached
                          ? "onboarding-activation-stage__icon--done"
                          : active
                            ? "onboarding-activation-stage__icon--active"
                            : "onboarding-activation-stage__icon--pending"
                      }`}
                      aria-hidden
                    >
                      {reached ? (
                        <IconCheck size={13} strokeWidth={2.5} />
                      ) : active ? (
                        <IconLoader size={13} strokeWidth={2.2} />
                      ) : null}
                    </span>
                    <span>{stage.label}</span>
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
  if (state.kind === "starting") return stageId === "rpa_login";
  if (state.kind !== "running") return false;
  const current = stageOrder(state.progressStage);
  const target = STAGES.findIndex((s) => s.id === stageId);
  return current === target || (current < 0 && target === 0);
}

function deriveFailureMessage(summary: {
  failure_type: string | null;
  progress_stage: string | null;
}): string {
  const ft = summary.failure_type ?? "";
  if (/invalid|credential|password|login/i.test(ft)) {
    return "Your MLCC username or password didn't work. Tap Fix credentials to update them, then we'll retry.";
  }
  if (/captcha|2fa|mfa/i.test(ft)) {
    return "MLCC is asking for a captcha or 2FA we can't complete automatically. Sign in at lara.michigan.gov first to clear any prompts, then try again.";
  }
  if (/network|timeout|unreachable/i.test(ft)) {
    return "MLCC is slow or unreachable right now. Wait a minute and try again.";
  }
  return `We hit an error during ${summary.progress_stage ?? "the connection check"}. Try again, or skip and verify from the scanner home.`;
}
