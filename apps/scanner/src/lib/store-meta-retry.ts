/**
 * store-meta fetch with retry (2026-08-05).
 *
 * Born from a real scare: the cart page fetched /home/smart-cards ONCE on
 * mount, and a single silent network failure meant storeMeta stayed
 * undefined — which hid the Place Order button on a fully-armed store
 * until the next cold open. Tony stared at a cart with no Place button
 * an hour after arming his own store.
 *
 * This helper turns "one shot, shrug on failure" into "a few patient
 * tries": call the getter, and on failure (or an ok:false payload) wait
 * and try again, up to `tries` total. Resolves with the first successful
 * payload, or null after the last failure — the caller keeps the same
 * fail-soft behavior (preview messaging), it just stops giving up after
 * one bad moment of hotel wifi.
 *
 * Pure orchestration — the getter, clock, and delays are injected, so
 * vitest pins it with fake timers and zero network.
 */

export interface StoreMetaRetryOptions {
  /** Total attempts including the first (default 3). */
  tries?: number;
  /** Delay between attempts in ms (default 3000). */
  delayMs?: number;
  /** Injectable sleeper for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Abort check — return true to stop retrying (e.g. unmounted). */
  cancelled?: () => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchWithRetries<T>(
  get: () => Promise<T | null | undefined>,
  options: StoreMetaRetryOptions = {},
): Promise<T | null> {
  const tries = options.tries ?? 3;
  const delayMs = options.delayMs ?? 3000;
  const sleep = options.sleep ?? defaultSleep;
  const cancelled = options.cancelled ?? (() => false);

  for (let attempt = 1; attempt <= tries; attempt++) {
    if (cancelled()) return null;
    try {
      const result = await get();
      if (result != null) return result;
    } catch {
      /* swallow — retrying is the whole point; the last miss returns null */
    }
    if (attempt < tries) {
      await sleep(delayMs);
    }
  }
  return null;
}
