/**
 * MlccCredentialsForm (task #86, 2026-06-06).
 *
 * Reusable form for updating MLCC creds. Used in two places:
 *   1. Inline inside OnboardingActivation's failure state, so a
 *      brand-new signup who fat-fingered their MLCC password can
 *      fix it and retry the probe without leaving the modal.
 *   2. Standalone on the scanner Settings page, so any signed-in
 *      user can rotate MLCC creds (e.g. password expired at MILO).
 *
 * Both username and password are optional — leave a field blank to
 * keep the existing value. We never display the existing password
 * (never read it back from the server; only ever write a new one).
 */
import { useState, type FormEvent } from "react";
import { updateMlccCredentials } from "../api/me";

type Props = {
  /**
   * Optional. If provided, sent as X-Store-Id instead of the runtime
   * resolver's value. Needed in the activation flow because the user
   * may not yet have the runtime cache populated when retrying.
   */
  overrideStoreId?: string;
  /**
   * Called with the new updated_at timestamp on success. Caller is
   * responsible for any post-save behavior (close modal, retry probe,
   * show toast, etc).
   */
  onSaved: (updatedAt: string | null) => void;
  /**
   * Optional. If set, both fields show this as the placeholder hint
   * ("Leave blank to keep current"). Defaults to a generic hint.
   */
  blankToKeepHint?: string;
  /** Optional. Label on the submit button. Defaults to "Save credentials". */
  submitLabel?: string;
  /**
   * When true, the password field is required. Use this in the
   * activation-retry flow where the whole point is to overwrite a
   * known-wrong password. Default false (rotation case).
   */
  passwordRequired?: boolean;
};

export function MlccCredentialsForm({
  overrideStoreId,
  onSaved,
  blankToKeepHint = "Leave blank to keep current",
  submitLabel = "Save credentials",
  passwordRequired = false,
}: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const u = username.trim();
    const p = password;
    if (passwordRequired && !p) {
      setError("Enter a new MLCC password.");
      return;
    }
    if (!u && !p) {
      setError("Enter a new username, password, or both.");
      return;
    }
    setSubmitting(true);
    const result = await updateMlccCredentials({
      mlcc_username: u || undefined,
      mlcc_password: p || undefined,
      overrideStoreId,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUsername("");
    setPassword("");
    onSaved(result.updated_at);
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <label style={labelStyle}>
        MLCC username
        <input
          type="text"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          placeholder={passwordRequired ? "Your MLCC username" : blankToKeepHint}
          style={inputStyle}
          disabled={submitting}
        />
      </label>
      <label style={labelStyle}>
        MLCC password
        <div style={{ position: "relative" }}>
          <input
            type={showPw ? "text" : "password"}
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordRequired ? "Your MLCC password" : blankToKeepHint}
            style={{ ...inputStyle, paddingRight: 56 }}
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            style={showPwBtnStyle}
            tabIndex={-1}
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
      </label>
      {error ? <div style={errorStyle}>{error}</div> : null}
      <button type="submit" disabled={submitting} style={submitBtnStyle}>
        {submitting ? "Saving…" : submitLabel}
      </button>
      <p style={hintStyle}>
        We re-encrypt your password with AES-256-GCM before storing it.
        It&apos;s only used to place orders on your behalf.
      </p>
    </form>
  );
}

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  textAlign: "left",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "rgba(255,255,255,0.85)",
};

const inputStyle: React.CSSProperties = {
  background: "#0d1017",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#fff",
  fontSize: 15,
  fontWeight: 500,
  width: "100%",
  boxSizing: "border-box",
};

const showPwBtnStyle: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  background: "transparent",
  border: "none",
  color: "rgba(255,255,255,0.55)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 4,
};

const errorStyle: React.CSSProperties = {
  background: "rgba(255, 80, 80, 0.12)",
  border: "1px solid rgba(255, 80, 80, 0.35)",
  color: "#ffb3b3",
  padding: 10,
  borderRadius: 8,
  fontSize: 13,
};

const submitBtnStyle: React.CSSProperties = {
  background: "#3a82f7",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.45)",
  margin: 0,
  lineHeight: 1.5,
};
