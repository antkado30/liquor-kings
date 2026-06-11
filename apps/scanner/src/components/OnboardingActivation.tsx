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
import { IconAlert, IconCheck, IconLoader, IconPlug } from "./Icons";
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
    <div className="onbd-backdrop" role="dialog" aria-modal="true">
      <div className="onbd-card">
        {state.kind === "succeeded" ? (
          <>
            <div className="onbd-icon onbd-icon--success">
              <IconCheck size={32} strokeWidth={2.2} />
            </div>
            <h2 className="onbd-heading">You&apos;re all set!</h2>
            <p className="onbd-copy">
              Welcome to Liquor Kings, {storeName}. We&apos;ve verified your MLCC
              connection — opening the scanner now.
            </p>
          </>
        ) : state.kind === "failed" ? (
          <>
            <div className="onbd-icon onbd-icon--failed">
              <IconAlert size={28} strokeWidth={2} />
            </div>
            <h2 className="onbd-heading">Couldn&apos;t verify connection</h2>
            <p className="onbd-copy">{state.message}</p>

            {showFixCreds && storeId ? (
              <div className="onbd-fix">
                <p className="onbd-hint">
                  Update the same username and password you use at
                  lara.michigan.gov. We&apos;ll retry the connection check
                  automatically.
                </p>
                <div className="onbd-creds">
                  <MlccCredentialsForm
                    overrideStoreId={storeId}
                    passwordRequired
                    submitLabel="Save & retry connection"
                    onSaved={() => {
                      retryProbe();
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="auth-btn auth-btn--ghost auth-btn--block onbd-fix__cancel"
                  onClick={() => setShowFixCreds(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="onbd-actions">
                  <button
                    type="button"
                    className="auth-btn auth-btn--primary"
                    onClick={retryProbe}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className="auth-btn auth-btn--secondary"
                    onClick={onComplete}
                  >
                    Skip for now
                  </button>
                </div>
                {storeId ? (
                  <button
                    type="button"
                    className="auth-btn auth-btn--primary auth-btn--block onbd-fix__open"
                    onClick={() => setShowFixCreds(true)}
                  >
                    Update MLCC credentials
                  </button>
                ) : null}
                <p className="onbd-footnote">
                  Common causes: wrong MLCC username or password, MLCC site
                  maintenance, or an account prompt (captcha / 2FA) on MILO.
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div className="onbd-icon onbd-icon--running">
              <IconPlug size={26} strokeWidth={1.85} />
            </div>
            <h2 className="onbd-heading">Verifying your MLCC connection…</h2>
            <p className="onbd-copy">
              We&apos;re signing into MILO with your credentials to confirm
              everything works before you start scanning. This usually takes
              30–60 seconds — please keep this screen open.
            </p>
            {elapsedSec >= 20 ? (
              <p className="onbd-footnote">
                Still working… {elapsedSec}s elapsed. MLCC can be slow during
                peak hours.
              </p>
            ) : null}
            <ActivationProgress state={state} />
          </>
        )}
      </div>
    </div>
  );
}

function ActivationProgress({ state }: { state: ActivationState }) {
  return (
    <div className="onbd-progress" role="status" aria-live="polite">
      <ol className="onbd-progress__list">
        {STAGES.map((stage) => {
          const reached = stageHasReached(state, stage.id);
          const active = stageIsActive(state, stage.id);
          const status = reached ? "done" : active ? "active" : "pending";
          return (
            <li
              key={stage.id}
              className={`onbd-progress__step onbd-progress__step--${status}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="onbd-progress__icon" aria-hidden>
                {status === "done" ? (
                  <IconCheck size={12} strokeWidth={2.75} />
                ) : status === "active" ? (
                  <IconLoader
                    size={12}
                    strokeWidth={2.75}
                    className="onbd-progress__spin"
                  />
                ) : null}
              </span>
              <span className="onbd-progress__label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
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
