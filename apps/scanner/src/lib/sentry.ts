import * as Sentry from "@sentry/react";

/**
 * Errors that are NOT bugs and should never reach the Sentry dashboard
 * (2026-07-18 hardening sweep). Every one here is either a deliberate user
 * choice or a transient we auto-recover from — keeping them out means the
 * dashboard shows only things worth a human's time.
 */
function isExpectedNoise(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const msg = String((err as { message?: unknown })?.message ?? err ?? "").toLowerCase();

  // Camera / mic permission the user declined (LIQUOR-KINGS-SCANNER-5). The
  // scanner already shows a friendly "enable camera in Settings" message.
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return true;
  if (msg.includes("not allowed by the user agent") || msg.includes("denied permission")) return true;
  // No camera hardware / device unavailable — also a friendly-message path.
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") return true;

  // Stale-chunk load after a deploy (LIQUOR-KINGS-SCANNER-4). We auto-reload
  // to the new version (see main.tsx), so this is self-healing, not a bug.
  if (
    msg.includes("importing a module script failed") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("unable to preload")
  ) {
    return true;
  }
  return false;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log("[sentry] VITE_SENTRY_DSN not set, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || "unknown",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    beforeSend(event, hint) {
      // Drop deliberate user choices + self-healing transients (see above).
      if (isExpectedNoise(hint?.originalException)) return null;
      event.tags = { ...(event.tags || {}), service: "scanner" };
      return event;
    },
  });
}

export { Sentry };
