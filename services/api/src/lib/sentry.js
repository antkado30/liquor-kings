import * as Sentry from "@sentry/node";
import { execSync } from "node:child_process";

function deriveRelease() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  // The production Docker image has no `git`, so this shells out and fails on
  // every boot, printing "/bin/sh: 1: git: not found" to the logs and leaving
  // the Sentry release tagged "unknown". Silence the shell's own stderr
  // (stdio) so a clean boot log doesn't look alarming; the try/catch already
  // handles the throw. Best fix long-term: pass SENTRY_RELEASE at deploy time.
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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

/*
 * Expected BUSINESS outcomes — the operator resolves these, they are not bugs
 * and must NOT page. Everything else a failed RPA run throws (stage timeouts,
 * MILO UI changes, decrypt/security, submit-side anomalies, unknown crashes)
 * is worth a human's attention and gets captured. (2026-07-18 observability
 * gap: the worker catches every stage error → nothing was ever "unhandled" →
 * Sentry saw ZERO despite order-day 7/16's dozen failures. This is the fix.)
 */
const BUSINESS_FAILURE_SUBSTRINGS = [
  "OUT_OF_STOCK", "INSUFFICIENT_INVENTORY",
  "BELOW_9L", "NINE_LITER", "INVALID_SPLIT", "SPLIT_QUANT", "QUANTITY_RULE",
  "CODE_MISMATCH", "ITEM_NOT_FOUND",
];

function isBusinessOutcome(code) {
  const c = String(code ?? "").toUpperCase();
  return BUSINESS_FAILURE_SUBSTRINGS.some((s) => c.includes(s));
}

/**
 * Report an RPA run failure to Sentry — but only the ones worth paging on.
 * No-op without a DSN; NEVER throws (telemetry may never break a run).
 *
 * @param {unknown} error
 * @param {{stage?:string, runId?:string, storeId?:string, failureType?:string, mode?:string, extra?:object}} [ctx]
 */
export function captureRunFailure(error, ctx = {}) {
  if (!process.env.SENTRY_DSN) return;
  const code = ctx.failureType ?? (error && typeof error === "object" ? error.code : null);
  if (isBusinessOutcome(code)) return; // expected — operator handles, don't page
  try {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("area", "rpa_worker");
      if (ctx.stage) scope.setTag("stage", ctx.stage);
      if (ctx.mode) scope.setTag("mode", ctx.mode);
      if (ctx.failureType) scope.setTag("failure_type", String(ctx.failureType));
      if (ctx.runId) scope.setTag("run_id", ctx.runId);
      scope.setContext("rpa_run", {
        runId: ctx.runId ?? null,
        storeId: ctx.storeId ?? null,
        stage: ctx.stage ?? null,
        failureType: ctx.failureType ?? null,
        mode: ctx.mode ?? null,
        ...(ctx.extra && typeof ctx.extra === "object" ? ctx.extra : {}),
      });
      const err =
        error instanceof Error
          ? error
          : new Error(String((error && error.message) || error || "RPA run failure"));
      Sentry.captureException(err);
    });
  } catch {
    /* telemetry must never break the run */
  }
}

/**
 * Report a submitted-but-unconfirmed run — MONEY AT RISK, always page.
 * A real order may exist on MILO with no confirmation captured. No-op without
 * a DSN; never throws.
 */
export function captureSubmittedUnconfirmed(ctx = {}) {
  if (!process.env.SENTRY_DSN) return;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("area", "rpa_worker");
      scope.setTag("stage", "stage5_checkout");
      scope.setTag("submitted_unconfirmed", "true");
      if (ctx.runId) scope.setTag("run_id", ctx.runId);
      scope.setContext("rpa_run", {
        runId: ctx.runId ?? null,
        storeId: ctx.storeId ?? null,
        submitClickedAt: ctx.submitClickedAt ?? null,
        stage5ErrorCode: ctx.stage5ErrorCode ?? null,
      });
      Sentry.captureMessage(
        `Submit dispatched but UNCONFIRMED (run ${ctx.runId ?? "?"}) — verify MILO Orders / MLCC email`,
        "error",
      );
    });
  } catch {
    /* never break the run */
  }
}

export { Sentry };
