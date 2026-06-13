/**
 * Shared fetch helper for the admin (Command Deck) app — AbortController-based
 * timeout + bounded retry on 5xx/network errors.
 *
 * AUDIT #28 (P1, §6, 2026-06-13): every fetch in apps/admin/src/api/*.ts was a
 * bare `fetch()` with no timeout — the same unbounded-await class as #6
 * (scanner AuthGate boot hang) and #25 (scanner bare fetches). The worst
 * instance: OperatorSessionContext.loadSession()'s `getSession()` call on
 * every app boot. loadSession's `finally { setBootstrap("ready") }` never
 * runs while the fetch is stuck, so a stalled `/operator-review/session`
 * response leaves AppShell showing "Checking session…" forever — Tony is
 * locked out of the entire Command Deck (founder console, operator review,
 * NRS review, diagnostics, pilot ops, catalog images) with no error, no
 * retry, no recovery short of reloading (which hits the same hang again on
 * a genuinely bad connection).
 *
 * Mirrors apps/scanner/src/api/catalog.ts's fetchWithRetry. A separate copy
 * (not a shared package) because admin and scanner are independent Vite
 * apps with no shared workspace lib today — duplicating ~50 lines is far
 * cheaper than introducing a new workspace package for this.
 */

export type FetchRetryConfig = {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with a hard timeout (AbortController) and bounded retry on 5xx /
 * network errors. 4xx responses are returned immediately (caller decides how
 * to surface them) — never retried, since retrying a 4xx can't help.
 *
 * Defaults: 1 retry, 10s timeout. Callers making non-idempotent mutations
 * (POST actions that aren't safe to repeat) should pass `{ maxRetries: 1 }`
 * (the default) so a 5xx/timeout is reported rather than silently retried.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  config?: FetchRetryConfig,
): Promise<Response> {
  const maxRetries = config?.maxRetries ?? 1;
  const baseDelayMs = config?.baseDelayMs ?? 800;
  const timeoutMs = config?.timeoutMs ?? 10000;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status >= 400 && res.status < 500) {
        return res;
      }
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < maxRetries - 1) {
          await delay(baseDelayMs * 2 ** attempt);
          continue;
        }
        return res;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < maxRetries - 1) {
        await delay(baseDelayMs * 2 ** attempt);
        continue;
      }
    }
  }
  throw new Error(
    `Network error after ${maxRetries} attempt${maxRetries === 1 ? "" : "s"}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
