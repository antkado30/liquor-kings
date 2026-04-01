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
    <div className="card gate">
      <h2>Sign in</h2>
      <p className="muted">
        Paste your Supabase access token once. The API sets an HttpOnly session cookie on this origin.
      </p>
      <div className="row">
        <label>Access token</label>
        <input
          style={{ flex: 1, minWidth: 280 }}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Paste once"
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Optional store UUID</label>
        <input
          style={{ flex: 1, minWidth: 280 }}
          value={preferredStoreId}
          onChange={(e) => setPreferredStoreId(e.target.value)}
          placeholder="If multiple stores, set initial store"
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={() => void onConnect()} disabled={busy}>
          Connect session
        </button>
      </div>
      <Msg type={gateMsg.type} text={gateMsg.text} />
    </div>
  );
}
