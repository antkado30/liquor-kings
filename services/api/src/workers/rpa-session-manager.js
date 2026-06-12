/**
 * RPA persistent session manager (task #46 Phase A, 2026-05-31).
 *
 * Holds a single warm Playwright session between successive RPA runs so
 * we can skip Stages 1 (login) and 2 (navigate to products) when the
 * next run targets the same store. End result for the user: Validate
 * drops from ~2 min to ~30-45s on the second+ run within the session
 * window.
 *
 * Scope of Phase A:
 *   - ONE held session per worker process, keyed by storeId.
 *   - On acquire for a different storeId, the held session is closed
 *     and replaced. (No multi-store pool yet — Tony's current scale is
 *     one store at Colony; the pool design is straightforward to add
 *     later by swapping `held` for a Map.)
 *   - Idle timeout: 10 minutes. After that, the held session is closed
 *     on next acquire instead of reused. MLCC's session TTL is the real
 *     constraint; 10 min is conservative.
 *   - Health check: before reusing, we call `session.page.url()`. Cheap
 *     and catches the common failure mode (browser crashed silently).
 *     Anything else (page navigated to /login, MILO 401'd us) gets
 *     caught on the next stage call.
 *   - On release: if the caller reports healthy=false (a stage threw),
 *     we close the session immediately. A poisoned session is worse
 *     than a fresh one.
 *
 * NOT in scope for Phase A:
 *   - Multi-store concurrent sessions
 *   - Active heartbeat pings to MILO to keep session alive
 *   - Session migration across worker restarts
 *
 * Guarded by env flag `LK_RPA_PERSIST_SESSION`. When unset or "no", the
 * caller bypasses this module entirely and runs the cold-pipeline path
 * exactly as before. Default off — Tony flips the flag in Fly secrets
 * when he's ready to validate against real MILO.
 */

import { randomUUID } from "node:crypto";

/**
 * Maximum time a session can sit idle before we discard it on next
 * acquire. MLCC's actual session TTL is somewhere in the 15-30 min
 * range based on observation; 10 min is well inside the safe window
 * and keeps us from holding stale state for ages between low-traffic
 * order windows.
 */
const DEFAULT_MAX_IDLE_MS = 10 * 60 * 1000;

/**
 * The single held session (or null when no session is warm). Each entry:
 *   - sessionId: random uuid for trace correlation across acquire/release
 *   - storeId: the store the session was logged in for
 *   - licenseNumber: the MILO license the navigate stage selected
 *   - session: the Playwright session object (browser, context, page, ...)
 *   - acquiredAt: when this run started using it
 *   - lastReleasedAt: when the previous run finished with it (null if
 *     it's currently in use OR was just created)
 *   - busy: true while a run is mid-flight using this session
 */
let held = null;

/**
 * Module-level config. Override via `configureSessionManager` in tests.
 */
let config = {
  maxIdleMs: DEFAULT_MAX_IDLE_MS,
  // Verbose logging — every acquire/release/close emits a console.log.
  // The worker daemon already logs prolifically; matching that style
  // keeps Fly logs readable when debugging session lifecycle.
  verbose: true,
};

/**
 * Replace one or more config values. Returns the previous config so a
 * test can snapshot and restore. Production code should not call this.
 *
 * @param {Partial<typeof config>} overrides
 */
export function configureSessionManager(overrides = {}) {
  const previous = { ...config };
  config = { ...config, ...overrides };
  return previous;
}

function log(message, attrs = {}) {
  if (!config.verbose) return;
  const parts = [`[session-manager] ${message}`];
  for (const [k, v] of Object.entries(attrs)) {
    parts.push(`${k}=${v}`);
  }
  console.log(parts.join(" "));
}

/**
 * Internal — close the held session's browser. Swallows close errors
 * because a session we want to throw away should be torn down even if
 * the close itself fails (the OS will reap the process).
 */
async function teardownHeldSession(reason) {
  if (!held) return;
  const { sessionId, session, storeId } = held;
  log("closing held session", { sessionId, storeId, reason });
  held = null;
  try {
    if (session?.browser) {
      await session.browser.close();
    }
  } catch (err) {
    log("close error (ignored)", {
      sessionId,
      error: err?.message || String(err),
    });
  }
}

/**
 * Quick liveness probe before reusing a session. Returns true iff the
 * page is still reachable. We deliberately keep this CHEAP — a single
 * `page.url()` call. Deeper checks (does MILO still recognize us?
 * are we still on the products page?) happen naturally when the caller
 * runs Stage 3 next, and Stage 3 already has its own auto-clear-cart
 * pre-flight which serves as a deeper probe.
 */
function isSessionAlive(session) {
  try {
    if (!session?.page) return false;
    if (typeof session.page.isClosed === "function" && session.page.isClosed()) {
      return false;
    }
    // Touch the URL — throws if the underlying CDP connection is dead.
    session.page.url();
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a session for a run. If a held session is reusable, returns
 * it and skips the cold pipeline. Otherwise, the caller is expected to
 * run Stages 1+2 themselves and call `attachFreshSession` to put the
 * resulting session under management.
 *
 * Reusability criteria (ALL must hold):
 *   1. There IS a held session.
 *   2. Same storeId AND same licenseNumber.
 *   3. Idle time since last release < maxIdleMs.
 *   4. Not currently busy (concurrent run on same store — rare but
 *      possible if a worker is multi-threaded; today's daemon is not).
 *   5. Liveness probe passes (`session.page.url()` doesn't throw).
 *
 * If a held session fails ANY criterion, it's closed and we return
 * `{ reused: false }` so the caller knows to run a cold pipeline.
 *
 * @param {object} args
 * @param {string} args.storeId
 * @param {string} args.licenseNumber - The MILO license we expect to
 *   already be selected. If a held session was navigated for a
 *   different license, we discard and reload.
 * @returns {Promise<
 *   | { reused: true, sessionId: string, session: object }
 *   | { reused: false, reason: string }
 * >}
 */
export async function acquireSession({ storeId, licenseNumber }) {
  if (!storeId) {
    return { reused: false, reason: "missing_store_id" };
  }
  if (!held) {
    return { reused: false, reason: "no_held_session" };
  }

  // Different store → blow away the held session immediately. Tony's
  // worker today only sees Colony, but defending the invariant cheaply
  // means future multi-store deployments don't accidentally mix
  // credentials.
  if (held.storeId !== storeId) {
    await teardownHeldSession("store_mismatch");
    return { reused: false, reason: "store_mismatch" };
  }

  if (licenseNumber && held.licenseNumber !== licenseNumber) {
    await teardownHeldSession("license_mismatch");
    return { reused: false, reason: "license_mismatch" };
  }

  if (held.busy) {
    // Should not happen with the current single-process daemon, but if
    // it does, the safest behavior is "you get a cold session, the
    // busy one stays in flight." DO NOT close it — the other run is
    // using it.
    return { reused: false, reason: "session_busy" };
  }

  const idleMs = Date.now() - (held.lastReleasedAt ?? 0);
  if (idleMs > config.maxIdleMs) {
    await teardownHeldSession("idle_timeout");
    return { reused: false, reason: "idle_timeout" };
  }

  if (!isSessionAlive(held.session)) {
    await teardownHeldSession("liveness_probe_failed");
    return { reused: false, reason: "liveness_probe_failed" };
  }

  /*
    Deep probe (2026-06-12, the worker-wedge incident). page.url() is
    answered from local state — it can pass while the underlying CDP
    connection/renderer is dead, handing the caller a corpse that times
    out 15s later in Stage 3. One real round-trip to the browser process
    (capped at 2s) proves the session can actually execute work before we
    hand it out. Costs ~5ms on a healthy session.
  */
  try {
    await Promise.race([
      held.session.page.evaluate("1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("cdp_probe_timeout")), 2_000),
      ),
    ]);
  } catch (err) {
    log("deep probe failed — closing held session", {
      sessionId: held.sessionId,
      error: err?.message || String(err),
    });
    await teardownHeldSession("cdp_probe_failed");
    return { reused: false, reason: "cdp_probe_failed" };
  }

  // Reusable!
  held.busy = true;
  held.acquiredAt = Date.now();
  log("acquire reused", {
    sessionId: held.sessionId,
    storeId: held.storeId,
    idleMs: Math.round(idleMs / 1000) + "s",
  });
  return {
    reused: true,
    sessionId: held.sessionId,
    session: held.session,
  };
}

/**
 * Put a freshly-created (or recreated) session under management. Called
 * by the caller after it runs Stages 1+2 from cold. The session manager
 * tracks it for the next acquire. Returns the assigned sessionId.
 *
 * If there's already a held session for a DIFFERENT store, we close it
 * first. (Same store with a fresh session shouldn't happen — caller
 * would have gotten reused=true on acquire — but if it does, we close
 * the old one too. Better one warm session than two leaked browsers.)
 */
export async function attachFreshSession({ storeId, licenseNumber, session }) {
  if (!storeId || !session?.browser) {
    return { ok: false, error: "invalid_attach_args" };
  }
  if (held && held.storeId !== storeId) {
    await teardownHeldSession("attach_replaced_different_store");
  }
  if (held && held.storeId === storeId) {
    // Replacing a same-store session — shouldn't happen in practice
    // but cleanest to tear down the old one rather than leak.
    await teardownHeldSession("attach_replaced_same_store");
  }
  const sessionId = randomUUID();
  held = {
    sessionId,
    storeId,
    licenseNumber: licenseNumber ?? null,
    session,
    acquiredAt: Date.now(),
    lastReleasedAt: null,
    busy: true,
  };
  log("attached fresh session", { sessionId, storeId, licenseNumber });
  return { ok: true, sessionId };
}

/**
 * Release a session after a run finishes. The session is held for the
 * next acquire IF the caller says healthy=true. If healthy=false (a
 * stage threw, or the caller can't vouch for the session's state), we
 * close it immediately.
 *
 * Always idempotent — calling release on an unknown sessionId is a
 * no-op, NOT an error. Callers always call this in a finally block.
 *
 * @param {object} args
 * @param {string} args.sessionId - From acquireSession or attachFreshSession.
 * @param {boolean} args.healthy - True iff every stage in this run
 *   succeeded AND the caller has not done anything (like navigated to
 *   logout or closed tabs) that would prevent reuse.
 * @param {string} [args.reason] - Optional, used in logging when
 *   healthy=false.
 */
export async function releaseSession({ sessionId, healthy, reason }) {
  if (!held || held.sessionId !== sessionId) {
    // Unknown / stale id — nothing to do. This is the case when the
    // run started before persist was enabled and there's no managed
    // session at all.
    return { ok: true, action: "ignored_unknown_session_id" };
  }
  if (!healthy) {
    await teardownHeldSession(reason || "released_unhealthy");
    return { ok: true, action: "closed_unhealthy" };
  }
  held.busy = false;
  held.lastReleasedAt = Date.now();
  log("released session for reuse", {
    sessionId,
    storeId: held.storeId,
    runDurationMs: Date.now() - (held.acquiredAt || 0),
  });
  return { ok: true, action: "held_for_reuse" };
}

/**
 * Force-close any held session. Called on worker shutdown (SIGINT /
 * SIGTERM) so we don't leak a browser process when Fly recycles the
 * machine. Also safe to call from tests for cleanup.
 *
 * @param {string} [reason] - For logging only.
 */
export async function forceCloseAll(reason = "force_close_all") {
  await teardownHeldSession(reason);
  return { ok: true };
}

/**
 * Diagnostic — current manager state, suitable for logging or a /health
 * endpoint. Never includes secrets (credentials live in the session
 * object, not surfaced here).
 */
export function getSessionManagerStats() {
  if (!held) {
    return { hasHeldSession: false };
  }
  return {
    hasHeldSession: true,
    sessionId: held.sessionId,
    storeId: held.storeId,
    licenseNumber: held.licenseNumber,
    busy: held.busy,
    acquiredAt: held.acquiredAt,
    lastReleasedAt: held.lastReleasedAt,
    idleMs: held.lastReleasedAt ? Date.now() - held.lastReleasedAt : null,
  };
}

/**
 * Test helper — clear all state synchronously without touching any
 * real browser. ONLY for unit tests; never call this in production
 * because it leaks browser processes.
 */
export function __resetForTestsOnly() {
  held = null;
}
