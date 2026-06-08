/**
 * useBackgroundPreValidate — silently runs a validate_only RPA run in
 * the background as the user builds their cart (task #47, 2026-06-02).
 *
 * Combined with #46 (persistent MILO session) and #48 (Submit also
 * reusing the warm session), this is the "validate feels instant" UX
 * Tony's been after. By the time the user actually taps "Validate
 * against MLCC", we already have a result waiting — show it
 * immediately instead of the 25-second warm or 2-minute cold pipeline.
 *
 * Behavior:
 *   - Hashes the cart on every change.
 *   - After STABILITY_DEBOUNCE_MS of no cart changes, fires a
 *     background validate using the same syncCart + triggerRun + poll
 *     pipeline useSubmission uses. NO UI feedback — completely silent.
 *   - Caches the result keyed by the exact cart hash that was
 *     validated.
 *   - Exposes getCachedResult(currentItems) which returns the cached
 *     result IFF the current cart hashes to the same value AND the
 *     run succeeded. Otherwise returns null (caller falls back to the
 *     foreground validate flow).
 *   - When the cart mutates after a cached result, the result is
 *     immediately considered stale (the hash check on get fails), and
 *     a new pre-validate is scheduled for the next debounce.
 *
 * Cost: at debounce 5s + ~25s warm-session validate, the worst case
 * is one pre-validate per ~30s of active cart building. A user
 * scanning continuously for 5 minutes fires ~10 pre-validates. Each
 * costs ~25 worker-seconds + a few cents of MLCC interaction. Tony's
 * scale that's fine; we'd revisit at thousands of stores.
 *
 * Edge cases:
 *   - Empty cart → no pre-validate fires.
 *   - In-flight validate is dropped when cart mutates; we DO NOT
 *     cancel the run server-side (orphan reaper handles cleanup;
 *     cancelling Playwright mid-stage is risky). We just stop caring
 *     about the result.
 *   - User clicks foreground Validate while a pre-validate is in
 *     flight: foreground runs in parallel. Wasteful but correct.
 *     useSubmission will see the cache miss and run its own pipeline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CartItem } from "../types";
import { replaceCartLines } from "../api/cart";
import {
  getRunSummary,
  isTerminalStatus,
  triggerRpaRunFromCart,
  type ValidateResult,
} from "../api/execution";

/**
 * How long the cart must be stable before we fire a background
 * validate. Tuned for the scan-cluster pattern (user scans 5 items in
 * 30 seconds, then pauses to review). 5s is long enough that we don't
 * fire mid-scan; short enough that the pre-validate is usually done
 * by the time the user opens the drawer.
 */
const STABILITY_DEBOUNCE_MS = 5000;
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 3 * 60 * 1000;

/*
  Kill switch (2026-06-02 evening). Was set to false when a validate
  flake hit prod and I incorrectly suspected the background pre-
  validate. Real cause turned out to be the rule engine table (18 ×
  750ml was offered as valid by the picker but rejected by MLCC at
  Stage 4). After the rule fix shipped, pre-validate re-enabled and
  staying on. Keep the constant in place for future emergencies —
  one-line flip disables the whole feature without ripping wiring.
*/
const PRE_VALIDATE_ENABLED = true;

/**
 * Cached result of a successful background pre-validate. cartHash is
 * the hash of the cart contents that were validated; we compare it to
 * the current cart on get to detect staleness.
 */
type CachedResult = {
  cartHash: string;
  cartId: string;
  validateResult: ValidateResult | null;
  finalStatus: "succeeded";
  completedAt: number;
};

export type BackgroundPreValidateStatus =
  | "idle"
  | "syncing"
  | "polling"
  | "success"
  | "error";

/** The shape useSubmission consumes — cache hit OR latched-onto in-flight run. */
export type ConsumableResult = Omit<CachedResult, "cartHash" | "completedAt">;

export type BackgroundPreValidate = {
  status: BackgroundPreValidateStatus;
  /**
   * Return the cached result IFF it matches the items passed in.
   * Caller hashes its current cart, the hook compares against the
   * cached hash, returns the result on match or null on miss.
   */
  getCachedResult: (currentItems: CartItem[]) => ConsumableResult | null;
  /**
   * If a background pre-validate is CURRENTLY running for this exact
   * cart, return its promise so a foreground Validate tap can latch
   * onto the in-flight run instead of starting a wasteful duplicate.
   * Resolves to the result on success, or null (caller falls back to a
   * fresh run). Returns null synchronously if nothing matching is in
   * flight. This is the big "validate feels faster" win — the user
   * usually taps Validate while the pre-validate is mid-flight.
   */
  getInFlight: (
    currentItems: CartItem[],
  ) => Promise<ConsumableResult | null> | null;
  /**
   * Wipe the cache. Called when useSubmission consumes the cached
   * result so the same pre-validate isn't reused for a second click.
   * (We could leave it cached but the freshness signal becomes
   * confusing.)
   */
  invalidateCache: () => void;
};

/**
 * Stable cart hash. Sorts items by code so cart-order doesn't matter,
 * stringifies (code, qty) pairs. Two identical carts produce identical
 * hashes even if the user added items in different orders.
 */
export function hashCart(items: CartItem[]): string {
  if (items.length === 0) return "";
  return items
    .map((l) => `${l.product.code}:${l.quantity}`)
    .sort()
    .join("|");
}

export function useBackgroundPreValidate(items: CartItem[]): BackgroundPreValidate {
  const [status, setStatus] = useState<BackgroundPreValidateStatus>("idle");
  const cacheRef = useRef<CachedResult | null>(null);
  /**
   * The currently-running pre-validate, if any: the cart hash it's
   * validating + a promise that resolves to the result (or null on
   * failure). Lets a foreground tap latch onto it.
   */
  const inFlightRef = useRef<{
    hash: string;
    promise: Promise<ConsumableResult | null>;
  } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Generation counter. Each background run has its own number; if a
   * NEW run starts (because cart changed), older runs ignore their
   * result on completion. Prevents an in-flight stale run from
   * overwriting a fresh cache.
   */
  const generationRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const invalidateCache = useCallback(() => {
    cacheRef.current = null;
    setStatus("idle");
  }, []);

  const getCachedResult = useCallback(
    (currentItems: CartItem[]) => {
      const cached = cacheRef.current;
      if (!cached) return null;
      const currentHash = hashCart(currentItems);
      if (currentHash !== cached.cartHash) return null;
      return {
        cartId: cached.cartId,
        validateResult: cached.validateResult,
        finalStatus: cached.finalStatus,
      };
    },
    [],
  );

  /**
   * Run a single background pre-validate. Captures the generation
   * number; bails on completion if a newer generation has started.
   */
  const runPreValidate = useCallback(
    async (validatingItems: CartItem[]): Promise<ConsumableResult | null> => {
      const myGeneration = generationRef.current;
      const cartHashAtStart = hashCart(validatingItems);
      if (validatingItems.length === 0) return null;

      setStatus("syncing");
      // Step 1: sync the cart in ONE bulk request (perf 2026-06-07). Errors
      // abort silently — the foreground flow will retry and show the user the
      // error if it persists.
      if (generationRef.current !== myGeneration) return null;
      const syncResult = await replaceCartLines(
        validatingItems.map((line) => ({
          mlccCode: line.product.code,
          quantity: line.quantity,
        })),
      );
      if (generationRef.current !== myGeneration) return null;
      if (!syncResult.ok) {
        if (generationRef.current === myGeneration) setStatus("error");
        return null;
      }
      const cartId = syncResult.cartId;

      // Step 2: trigger validate_only.
      const triggerResult = await triggerRpaRunFromCart({
        cartId,
        mode: "validate_only",
      });
      if (!triggerResult.ok) {
        if (generationRef.current === myGeneration) setStatus("error");
        return null;
      }
      const runId = triggerResult.runId;

      setStatus("polling");
      // Step 3: poll until terminal. Same shape as useSubmission's
      // pollUntilTerminal but pared down — no UI tick, just wait for the
      // final result.
      const pollStart = Date.now();
      let terminalSummary: {
        finalStatus: "succeeded" | "failed" | "cancelled";
        validateResult: ValidateResult | null;
      } | null = null;

      while (generationRef.current === myGeneration) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (generationRef.current !== myGeneration) return null;
        if (Date.now() - pollStart > MAX_POLL_MS) {
          if (generationRef.current === myGeneration) setStatus("error");
          return null;
        }
        const summaryRes = await getRunSummary({ runId });
        if (!summaryRes.ok) continue; // transient — keep polling
        const s = summaryRes.summary;
        if (isTerminalStatus(s.status)) {
          terminalSummary = {
            finalStatus: s.status as "succeeded" | "failed" | "cancelled",
            validateResult: s.validate_result ?? null,
          };
          break;
        }
      }

      if (!terminalSummary) return null;
      if (generationRef.current !== myGeneration) return null;

      if (terminalSummary.finalStatus === "succeeded") {
        cacheRef.current = {
          cartHash: cartHashAtStart,
          cartId,
          validateResult: terminalSummary.validateResult,
          finalStatus: "succeeded",
          completedAt: Date.now(),
        };
        setStatus("success");
        return {
          cartId,
          validateResult: terminalSummary.validateResult,
          finalStatus: "succeeded",
        };
      }
      cacheRef.current = null;
      setStatus("error");
      return null;
    },
    [],
  );

  /*
    Cart-watch effect: schedule a pre-validate STABILITY_DEBOUNCE_MS
    after the latest cart change. Each cart change increments the
    generation counter so any in-flight run bails before mutating the
    cache.
  */
  useEffect(() => {
    // Kill switch — when off, the hook is inert. useSubmission gets
    // null cache results and falls back to the foreground flow it had
    // before #47. See PRE_VALIDATE_ENABLED comment above.
    if (!PRE_VALIDATE_ENABLED) return;

    const currentHash = hashCart(items);

    // Already have a fresh cache for this exact cart? Nothing to do.
    if (cacheRef.current && cacheRef.current.cartHash === currentHash) {
      return;
    }

    // Cart changed — bump generation so any in-flight run bails.
    generationRef.current += 1;
    // Clear any pending debounce.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Stale cache for a different hash — drop it.
    if (cacheRef.current) {
      cacheRef.current = null;
      setStatus("idle");
    }

    if (items.length === 0) return;

    // Schedule the run on the trailing edge of the debounce.
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const itemsNow = itemsRef.current;
      const hash = hashCart(itemsNow);
      // Track this run so a foreground tap can latch onto it via getInFlight.
      const promise = runPreValidate(itemsNow);
      inFlightRef.current = { hash, promise };
      void promise.finally(() => {
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = null;
        }
      });
    }, STABILITY_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [items, runPreValidate]);

  const getInFlight = useCallback((currentItems: CartItem[]) => {
    const inf = inFlightRef.current;
    if (!inf) return null;
    if (hashCart(currentItems) !== inf.hash) return null;
    return inf.promise;
  }, []);

  return {
    status,
    getCachedResult,
    getInFlight,
    invalidateCache,
  };
}
