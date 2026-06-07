/**
 * Tiny dependency-free stale-while-revalidate cache (2026-06-07).
 *
 * WHY THIS EXISTS — the "everything loads slowly" fix:
 * Every scanner page used to refetch from the network on every mount
 * (useEffect → setLoading(true) → await fetch → render). So every tab
 * switch showed a blank screen + spinner, even when the data hadn't
 * changed. Tony's #1 ask (see feedback_instant_feel): tabs must open
 * INSTANTLY.
 *
 * HOW IT WORKS:
 * The cache lives in a module-level Map — OUTSIDE the React tree — so it
 * survives route unmount/remount. When a page reopens:
 *   1. We paint the last-known data immediately (no spinner).
 *   2. We kick off a background revalidation if the data is stale.
 *   3. When the fresh data lands, subscribed components re-render.
 *
 * This is the same model as SWR / React Query, in ~90 lines, zero deps,
 * so we don't grow the bundle (which is the OTHER half of the slowness).
 *
 * KEYS: callers scope keys by store id so one store's data never bleeds
 * into another after a sign-out/sign-in in the same browser. clearAllCache()
 * is also called on sign-out as a belt-and-suspenders reset.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

type Entry<T> = {
  data: T | undefined;
  error: unknown;
  promise: Promise<T> | null;
  updatedAt: number;
  subscribers: Set<() => void>;
};

const store = new Map<string, Entry<unknown>>();

function getEntry<T>(key: string): Entry<T> {
  let e = store.get(key) as Entry<T> | undefined;
  if (!e) {
    e = {
      data: undefined,
      error: undefined,
      promise: null,
      updatedAt: 0,
      subscribers: new Set(),
    };
    store.set(key, e as Entry<unknown>);
  }
  return e;
}

function notify<T>(e: Entry<T>) {
  for (const fn of e.subscribers) fn();
}

/** Imperatively set cache data (e.g. after appending a paginated page). */
export function mutateCache<T>(key: string, data: T): void {
  const e = getEntry<T>(key);
  e.data = data;
  e.error = undefined;
  e.updatedAt = Date.now();
  notify(e);
}

/** Mark a key stale so the next mount refetches (data stays for instant paint). */
export function invalidate(key: string): void {
  const e = store.get(key) as Entry<unknown> | undefined;
  if (e) e.updatedAt = 0;
}

/** Wipe everything — called on sign-out so the next user starts clean. */
export function clearAllCache(): void {
  store.clear();
}

function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const e = getEntry<T>(key);
  if (e.promise) return e.promise; // dedupe concurrent revalidations
  const p = (async () => {
    try {
      const data = await fetcher();
      e.data = data;
      e.error = undefined;
      e.updatedAt = Date.now();
      return data;
    } catch (err) {
      e.error = err;
      throw err;
    } finally {
      e.promise = null;
      notify(e);
    }
  })();
  e.promise = p;
  notify(e); // flip isValidating on immediately
  return p;
}

export type CachedResource<T> = {
  /** Last-known data — present instantly on remount if previously loaded. */
  data: T | undefined;
  error: unknown;
  /** True only on the very first load when there's nothing cached yet. */
  loading: boolean;
  /** True whenever a (re)fetch is in flight, including background refreshes. */
  isValidating: boolean;
  /** Force a refetch now. */
  refresh: () => Promise<T | undefined>;
  /** Imperatively overwrite cached data (pagination appends, optimistic UI). */
  mutate: (data: T) => void;
};

/**
 * Subscribe a component to a cached resource. Paints cached data
 * instantly, revalidates in the background when stale.
 *
 * @param key       Stable cache key (scope by store id). Pass null to disable.
 * @param fetcher   Async loader. MUST throw on failure so error state works.
 * @param dedupeMs  How long cached data is considered fresh (default 30s).
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  dedupeMs = 30_000,
): CachedResource<T> {
  const [, force] = useReducer((c: number) => c + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    const e = getEntry<T>(key);
    e.subscribers.add(force);
    const isStale = Date.now() - e.updatedAt > dedupeMs;
    if (e.data === undefined || isStale) {
      void revalidate(key, () => fetcherRef.current()).catch(() => {
        /* error captured on the entry; surfaced via .error */
      });
    }
    return () => {
      e.subscribers.delete(force);
    };
  }, [key, dedupeMs]);

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve(undefined);
    return revalidate(key, () => fetcherRef.current()).catch(() => undefined);
  }, [key]);

  const mutate = useCallback(
    (data: T) => {
      if (key) mutateCache(key, data);
    },
    [key],
  );

  const entry = key ? getEntry<T>(key) : null;
  return {
    data: entry?.data,
    error: entry?.error,
    loading: entry ? entry.data === undefined && entry.error === undefined : false,
    isValidating: entry ? entry.promise != null : false,
    refresh,
    mutate,
  };
}
