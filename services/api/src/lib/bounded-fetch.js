/**
 * bounded-fetch — every network call finishes or fails in BOUNDED time
 * (claim-latency dig, 2026-07-11).
 *
 * THE SCAR THIS PREVENTS: 2026-06-14, a wedged worker→API connection made
 * bare fetch() hang 2-15 MINUTES per call for 4.5 hours — a real $4,000
 * validate sat at zero progress until the client gave up. The worker's
 * API calls got AbortSignal bounds that day; the API's OWN Supabase
 * client (and the worker's DB client) never did. Until now, any wedged
 * keepalive socket to Supabase hung the affected request FOREVER —
 * observed as the sporadic 20s claim-next timeouts (the worker aborts at
 * 20s; the server, before this, never would).
 *
 * Doctrine: fail LOUD in bounded time, never hang silently (§14, §22).
 * A timed-out DB call surfaces as a normal error to every existing
 * handler — they already treat DB errors as loud 500s.
 *
 * The 15s default is deliberately below the worker's 20s API abort, so
 * the server always answers (with an error) before the worker gives up
 * on it — errors stay attributable to the right hop.
 *
 * Caller signals are COMPOSED, not clobbered: if supabase-js (or anyone)
 * passes its own AbortSignal, both that signal and the timeout can abort
 * the call — whichever fires first. Uses AbortSignal.any when available
 * (Node ≥20.3; API runs node:22), with a manual composition fallback so
 * the worker image's Node version is never a deploy-day surprise.
 */

export const DEFAULT_DB_FETCH_TIMEOUT_MS = 15_000;

/**
 * Resolve the timeout from the environment knob (emergency lever —
 * `LK_DB_FETCH_TIMEOUT_MS`), falling back to the default on any
 * missing/invalid value. Exported for tests.
 * @param {string | undefined} raw
 * @returns {number}
 */
export function resolveDbFetchTimeoutMs(raw) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(n) && n >= 1_000 && n <= 300_000) return n;
  return DEFAULT_DB_FETCH_TIMEOUT_MS;
}

/**
 * Combine a caller-provided signal with a timeout signal — abort when
 * EITHER fires. Exported for tests.
 * @param {AbortSignal} callerSignal
 * @param {AbortSignal} timeoutSignal
 * @returns {AbortSignal}
 */
export function composeAbortSignals(callerSignal, timeoutSignal) {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([callerSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const forward = (source) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  for (const source of [callerSignal, timeoutSignal]) {
    if (source.aborted) {
      forward(source);
      break;
    }
    source.addEventListener("abort", () => forward(source), { once: true });
  }
  return controller.signal;
}

/**
 * Build a fetch with a hard per-call time bound. Drop-in for the
 * `global.fetch` option of `createClient` — everything else about the
 * call (method, headers, body) passes through untouched.
 *
 * @param {number} timeoutMs
 * @param {typeof fetch} [baseFetch] injectable for tests
 * @returns {typeof fetch}
 */
export function makeBoundedFetch(timeoutMs, baseFetch = fetch) {
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal
      ? composeAbortSignals(init.signal, timeoutSignal)
      : timeoutSignal;
    return baseFetch(input, { ...init, signal });
  };
}
