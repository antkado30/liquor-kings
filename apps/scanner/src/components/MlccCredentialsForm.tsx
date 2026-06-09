/**
 * MlccCredentialsForm (task #86, 2026-06-06).
 *
 * Reusable form for updating MLCC creds. Used in onboarding failure
 * recovery and on the Settings page.
 */
import { useState, type FormEvent } from "react";
import { updateMlccCredentials } from "../api/me";
import { IconAlert } from "./Icons";

type Props = {
  overrideStoreId?: string;
  onSaved: (updatedAt: string | null) => void;
  blankToKeepHint?: string;
  submitLabel?: string;
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
    if (passwordRequired && !u) {
      setError("Enter your MLCC username.");
      return;
    }
    if (passwordRequired && !p) {
      setError("Enter your MLCC password.");
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
    <form className="mlcc-creds-form" onSubmit={handleSubmit}>
      <label className="onboarding-field">
        <span className="onboarding-field__label">MLCC username</span>
        <input
          type="text"
          className="onboarding-input"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          placeholder={
            passwordRequired ? "Your MLCC username" : blankToKeepHint
          }
          disabled={submitting}
        />
      </label>
      <label className="onboarding-field">
        <span className="onboarding-field__label">MLCC password</span>
        <div className="mlcc-creds-form__pw-wrap">
          <input
            type={showPw ? "text" : "password"}
            className="onboarding-input mlcc-creds-form__input--pw"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              passwordRequired ? "Your MLCC password" : blankToKeepHint
            }
            disabled={submitting}
          />
          <button
            type="button"
            className="mlcc-creds-form__pw-toggle"
            onClick={() => setShowPw((v) => !v)}
            tabIndex={-1}
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
      </label>

      {error ? (
        <p className="onboarding-error" role="alert">
          <IconAlert size={16} strokeWidth={2} aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="onboarding-btn onboarding-btn--primary onboarding-btn--block"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>

      <p className="onboarding-hint">
        We encrypt your password with AES-256-GCM before storing it. It&apos;s
        only used to place orders on your behalf.
      </p>
    </form>
  );
}
