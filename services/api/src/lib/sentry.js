import * as Sentry from "@sentry/node";
import { execSync } from "node:child_process";

function deriveRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    return sha || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Initialize Sentry for the API process. Safe to call with no DSN (no-op).
 * Must run before other application modules load so auto-instrumentation applies.
 */
export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.log("[sentry] SENTRY_DSN not set, error tracking disabled");
    return;
  }

  const environment =
    process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
  const release = deriveRelease();

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment,
    release,
    tracesSampleRate: 0.1,
    ignoreErrors: ["AbortError", "ECONNRESET"],
    beforeSend(event, hint) {
      const url = event.request?.url;
      if (typeof url === "string" && url.includes("/health")) {
        return null;
      }
      const err = hint?.originalException;
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      if (msg.includes("ECONNRESET")) {
        return null;
      }
      event.tags = { ...(event.tags || {}), service: "api" };
      return event;
    },
  });

  console.log(`[sentry] initialized for environment ${environment}, release ${release}`);
}

export { Sentry };
