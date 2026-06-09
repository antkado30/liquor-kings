/**
 * VerifyMlccBanner — task #88, 2026-06-06.
 *
 * Shown on the scanner home when mlcc_credentials_last_verified_at is null.
 */
import { useMlccVerifyProbe } from "../hooks/useMlccVerifyProbe";
import {
  IconAlert,
  IconCheck,
  IconLoader,
  IconPlug,
} from "./Icons";

type Props = {
  onVerified: () => void;
};

export function VerifyMlccBanner({ onVerified }: Props) {
  const { state, runProbe } = useMlccVerifyProbe(onVerified);

  const isRunning = state.kind === "running";
  const isFailed = state.kind === "failed";
  const isSuccess = state.kind === "succeeded";

  return (
    <div
      className={`verify-mlcc-banner${isSuccess ? " verify-mlcc-banner--success" : ""}`}
      role={isFailed ? "alert" : "status"}
    >
      <span className="verify-mlcc-banner__icon" aria-hidden>
        {isSuccess ? (
          <IconCheck size={20} strokeWidth={2.2} />
        ) : isRunning ? (
          <span className="verify-mlcc-banner__spinner">
            <IconLoader size={20} strokeWidth={2} />
          </span>
        ) : isFailed ? (
          <IconAlert size={20} strokeWidth={2} />
        ) : (
          <IconPlug size={20} strokeWidth={1.9} />
        )}
      </span>

      <div className="verify-mlcc-banner__body">
        <div className="verify-mlcc-banner__title">
          {isSuccess
            ? "MLCC connection verified"
            : isRunning
              ? "Verifying MLCC connection…"
              : isFailed
                ? "Verification failed"
                : "Verify your MLCC connection"}
        </div>
        <div className="verify-mlcc-banner__subtitle">
          {isSuccess
            ? "You're connected to MILO. This banner will disappear shortly."
            : isFailed
              ? state.message
              : isRunning
                ? "Signing into MILO — usually takes 30–60 seconds. Keep the app open."
                : "We haven't confirmed your MILO login yet. One tap to test it."}
        </div>
      </div>

      {!isRunning && !isSuccess ? (
        <button
          type="button"
          className="verify-mlcc-banner__btn"
          onClick={() => void runProbe()}
        >
          {isFailed ? "Retry" : "Verify"}
        </button>
      ) : null}
    </div>
  );
}
