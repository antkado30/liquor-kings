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
import { useMlccVerifyProbe } from "../hooks/useMlccVerifyProbe";

type Props = {
  onVerified: () => void;
};

export function VerifyMlccBanner({ onVerified }: Props) {
  const { state, runProbe } = useMlccVerifyProbe(onVerified);

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
          …
        </div>
      ) : (
        <button type="button" onClick={runProbe} style={btnStyle}>
          {state.kind === "failed" ? "Retry" : "Verify"}
        </button>
      )}
    </div>
  );
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
