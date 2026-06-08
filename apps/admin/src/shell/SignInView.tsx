import { useState } from "react";
import { Msg } from "../operator-review/components/Msg";
import { useOperatorSession } from "../session/OperatorSessionContext";
import { signInWithPassword } from "../lib/supabaseAuth";

export function SignInView() {
  const { gateMsg, connect } = useOperatorSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preferredStoreId, setPreferredStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  // Fallback for power users / debugging — paste a raw access token.
  const [showToken, setShowToken] = useState(false);
  const [accessToken, setAccessToken] = useState("");

  const onSignIn = async () => {
    setLocalErr(null);
    setBusy(true);
    try {
      let token = accessToken.trim();
      // Primary path: exchange email + password for a fresh token.
      if (!showToken) {
        if (!email.trim() || !password) {
          setLocalErr("Enter your email and password.");
          return;
        }
        const res = await signInWithPassword(email, password);
        if (!res.ok) {
          setLocalErr(res.error);
          return;
        }
        token = res.accessToken;
      } else if (!token) {
        setLocalErr("Paste an access token, or switch back to email sign-in.");
        return;
      }
      // Trade the token for the operator session cookie.
      await connect(token, preferredStoreId);
      setPassword("");
      setAccessToken("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lk-auth">
      <div className="lk-auth__panel">
        <div className="lk-auth__brand">
          <span className="lk-auth__crown" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 7l3.5 3L12 4l5.5 6L21 7l-1.6 11H4.6L3 7z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                fill="rgba(124,111,255,0.18)"
              />
            </svg>
          </span>
          <div>
            <div className="lk-auth__wordmark">LIQUOR KINGS</div>
            <div className="lk-auth__eyebrow">Command Deck</div>
          </div>
        </div>

        <h1 className="lk-auth__title">Authenticate</h1>
        <p className="lk-auth__sub">
          Sign in with your Liquor Kings account. We set a secure session on
          this device — add it to your home screen and you stay signed in.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSignIn();
          }}
        >
          {!showToken ? (
            <>
              <div className="lk-field">
                <label className="lk-field__label">Email</label>
                <input
                  className="lk-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@liquorkings.com"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="username"
                  spellCheck={false}
                />
              </div>
              <div className="lk-field">
                <label className="lk-field__label">Password</label>
                <input
                  className="lk-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <div className="lk-field">
              <label className="lk-field__label">Access token</label>
              <input
                className="lk-input lk-input--mono"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste a Supabase access token"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="lk-field">
            <label className="lk-field__label">
              Store ID <span className="lk-field__opt">optional</span>
            </label>
            <input
              className="lk-input lk-input--mono"
              value={preferredStoreId}
              onChange={(e) => setPreferredStoreId(e.target.value)}
              placeholder="Leave blank for default store"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <button type="submit" className="lk-btn-primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          className="lk-auth__toggle"
          onClick={() => {
            setShowToken((v) => !v);
            setLocalErr(null);
          }}
        >
          {showToken ? "← Sign in with email instead" : "Advanced: use access token"}
        </button>

        {localErr ? <Msg type="error" text={localErr} /> : null}
        <Msg type={gateMsg.type} text={gateMsg.text} />
      </div>
    </div>
  );
}
