import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import {
  getMlccConnected,
  subscribeMlccConnected,
} from "../lib/mlccStatus";

/**
 * Connect-MILO nudge (M3, 2026-08-08). Renders ONLY when the store is
 * confirmed credless (the "connect later" signup path) — the scanner
 * and shared catalog work instantly for these stores, but ordering is
 * locked until MILO connects in Settings. Dismiss lasts the session
 * (in-memory), so it politely reappears next visit without nagging on
 * every navigation.
 */

let dismissedThisSession = false;

export function MlccConnectBanner() {
  const connected = useSyncExternalStore(
    subscribeMlccConnected,
    getMlccConnected,
    getMlccConnected,
  );
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  if (connected !== false || dismissed) return null;

  return (
    <div className="mlcc-banner" role="status">
      <span className="mlcc-banner__text">
        Scan away — prices are live. To place orders, connect your MILO
        sign-in.
      </span>
      <Link to="/settings" className="mlcc-banner__cta">
        Connect
      </Link>
      <button
        type="button"
        className="mlcc-banner__dismiss"
        aria-label="Dismiss"
        onClick={() => {
          dismissedThisSession = true;
          setDismissed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
