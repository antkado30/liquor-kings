import { useState } from "react";
import { Msg } from "../operator-review/components/Msg";
import { useOperatorSession } from "../session/OperatorSessionContext";

export function SignInView() {
  const { gateMsg, connect } = useOperatorSession();
  const [accessToken, setAccessToken] = useState("");
  const [preferredStoreId, setPreferredStoreId] = useState("");
  const [busy, setBusy] = useState(false);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connect(accessToken, preferredStoreId);
      setAccessToken("");
      setPreferredStoreId("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lk-auth">
      <div className="lk-auth__panel">
        <div className="lk-auth__brand">
          <span className="lk-auth__crown" aria-hidden>
            {/* Crown mark — inline SVG, no emoji (premium feel). */}
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
          Paste your access token once. We set a secure session on this device —
          then add it to your home screen and you stay signed in.
        </p>

        <div className="lk-field">
          <label className="lk-field__label">Access token</label>
          <input
            className="lk-input lk-input--mono"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Paste your token"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

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

        <button
          type="button"
          className="lk-btn-primary"
          onClick={() => void onConnect()}
          disabled={busy}
        >
          {busy ? "Connecting…" : "Connect session"}
        </button>

        <Msg type={gateMsg.type} text={gateMsg.text} />
      </div>
    </div>
  );
}
