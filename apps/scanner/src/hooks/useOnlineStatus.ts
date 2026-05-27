/**
 * Reactive offline-awareness hook.
 *
 * Returns `true` when the browser believes it has network connectivity,
 * `false` when it doesn't. Driven by the browser's `online` / `offline`
 * events on window — which fire reliably on iOS Safari when Wi-Fi or
 * cellular drops/reconnects.
 *
 * Why this matters for dad's store:
 *   - The MILO website is online-only and so is our API. If the in-store
 *     Wi-Fi blips, every scan silently fails with "Having trouble
 *     connecting…" toasts — useful but reactive.
 *   - This hook lets us show a PROACTIVE persistent banner the moment the
 *     network drops, so dad knows the scanner is offline before he scans
 *     four bottles and wonders why nothing's responding.
 *
 * `navigator.onLine` has a known false-positive (it can report online when
 * captive-portal'd or actually unreachable). It's a useful coarse signal —
 * for the "obviously offline" case it's right, and for everything else our
 * fetchWithRetry / network error toasts pick up the slack.
 */
import { useEffect, useState } from "react";

function readInitialOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  // Default to online (true) if the API is missing — being wrong toward
  // "online" is less alarming than a false offline banner on first paint.
  return navigator.onLine ?? true;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(readInitialOnline);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Re-read on mount in case the value changed between SSR / first paint
    // and effect run (matters for the StrictMode double-render in dev).
    setOnline(readInitialOnline());

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
