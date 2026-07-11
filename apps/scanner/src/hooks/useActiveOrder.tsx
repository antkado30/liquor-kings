/**
 * useActiveOrder — app-level "active order" tracker (2026-06-26).
 *
 * Foundation for async "fire and notify" ordering. Today the run poll lives in
 * useSubmission → CartDrawer, which unmounts when the drawer closes, forcing
 * the user to watch a spinner. This provider lifts a SINGLE in-flight run to
 * the app root so its status survives the drawer closing and page navigation.
 *
 * The backend is already async: triggerRpaRunFromCart returns a runId at once
 * and the worker runs independently. We poll getRunSummary on the same proven
 * cadence as useSubmission's pollUntilTerminal (2500ms, easing to 10000ms
 * after 60s, never giving up until terminal or cancelled/unmounted).
 *
 * WIRED: CartDrawer calls trackOrder after firing a non-blocking Check/Place
 * Order run, so the pill tracks it app-wide. With no order tracked, activeOrder
 * is null and the pill renders null. This provider only OBSERVES an
 * already-triggered run — no validate/submit behavior is changed here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getRunSummary,
  isTerminalStatus,
  type RunMode,
  type RunStatus,
  type ValidateResult,
} from "../api/execution";
import { getCurrentStoreId } from "../lib/currentStore";
import { CHECK_TRUST_WINDOW_MS, type LastGreenCheck } from "../lib/place-gate";

const STORAGE_KEY = "lk.activeOrder.v1";
/*
  Two-step ordering (2026-07-11): the last GREEN check — a validate_only
  run that finished succeeded with MILO's can_checkout=true — persisted
  with the hash of the exact cart lines it blessed. This is what unlocks
  "Place Order" (Tony's 2026-07-01 design: Place trusts a fresh check
  <10 min for a byte-identical cart; any edit re-locks). Its own key, NOT
  part of lk.activeOrder.v1 — dismissing the status pill must never
  revoke Place eligibility.
*/
const GREEN_CHECK_STORAGE_KEY = "lk.lastGreenCheck.v1";
// Poll cadence mirrors useSubmission.pollUntilTerminal EXACTLY.
const POLL_INTERVAL_MS = 2500;
const POLL_BACKOFF_AFTER_MS = 60_000;
const POLL_BACKOFF_INTERVAL_MS = 10_000;
// A stored order is only worth resuming if it's plausibly still live. Past
// 30 min the worker reaper (STALE_RUN_MINUTES=15) has long since finalized
// it, and a stale UI hint is worse than none.
const REHYDRATE_MAX_AGE_MS = 30 * 60 * 1000;

export type ActiveOrderResult = {
  submitted: boolean | null;
  failureType: string | null;
  failureMessage: string | null;
  /**
   * The run's validate_result (MILO's live cart view: in-stock / OOS /
   * totals / messages). Populated on terminal from getRunSummary; null
   * while polling and on runs that never produced one. Surfaced by
   * RunResultSheet so the user sees what MILO actually found.
   */
  validateResult: ValidateResult | null;
  /**
   * MILO confirmation numbers for a REAL submitted order, keyed by ADA
   * reference number ("321"/"221"/"141", or "ada_1"-style when the
   * distributor couldn't be matched). Null on practice checks, dry runs,
   * and while polling. Threaded from submit_result so RunResultSheet can
   * show the number at the moment of truth (2026-07-01 — the sheet said
   * "Order placed" but made the user dig for the confirmation).
   */
  confirmationNumbers: Record<string, string | null> | string[] | null;
  /** Wall-clock the check took (tap → terminal). Null until terminal. */
  durationMs: number | null;
};

export type ActiveOrder = {
  runId: string;
  mode: RunMode;
  storeId: string;
  status: RunStatus;
  progressStage: string | null;
  progressMessage: string | null;
  startedAtMs: number;
  /**
   * hashCart() of the lines this run was fired with (2026-07-11). Lets a
   * terminal GREEN validate_only run record the Place-unlocking check for
   * exactly those lines. Null when the caller didn't provide one.
   */
  cartHash: string | null;
  /** null while polling; set once the run reaches a terminal status. */
  result: ActiveOrderResult | null;
};

/** Minimal shape persisted to localStorage for reload-mid-order rehydration. */
type StoredOrder = {
  runId: string;
  mode: RunMode;
  storeId: string;
  startedAtMs: number;
  /** Optional — older stored blobs won't have it; treated as null. */
  cartHash?: string | null;
};

/** LastGreenCheck + the store it belongs to (never leak across stores). */
type StoredGreenCheck = LastGreenCheck & { storeId: string };

type ActiveOrderContextValue = {
  activeOrder: ActiveOrder | null;
  /**
   * Begin tracking a run. Persists to localStorage and starts the poll.
   * Pass cartHash (hashCart of the fired lines) so a green validate_only
   * terminal can unlock Place for exactly that cart.
   */
  trackOrder: (runId: string, mode: RunMode, opts?: { cartHash?: string }) => void;
  /** Clear the active order + the persisted key. Stops polling. */
  dismiss: () => void;
  /**
   * The freshest green check for the CURRENT store, or null. Consumers
   * (the Place gate) judge hash match + freshness themselves.
   */
  lastGreenCheck: LastGreenCheck | null;
};

const ActiveOrderContext = createContext<ActiveOrderContextValue | null>(null);

function readStoredOrder(): StoredOrder | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOrder>;
    if (
      typeof parsed?.runId === "string" &&
      typeof parsed?.mode === "string" &&
      typeof parsed?.storeId === "string" &&
      typeof parsed?.startedAtMs === "number"
    ) {
      return parsed as StoredOrder;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredOrder(order: StoredOrder | null) {
  try {
    if (order) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode, quota) — non-fatal; tracking just
       won't survive a reload. The in-memory poll still works. */
  }
}

/**
 * Read the persisted green check, scoped to the given store and pruned
 * when it can't possibly unlock Place anymore (older than the trust
 * window). A corrupted blob reads as null — the gate then just demands
 * a fresh check, which is always the safe answer.
 */
function readStoredGreenCheck(storeId: string | null): LastGreenCheck | null {
  if (!storeId) return null;
  try {
    const raw = window.localStorage.getItem(GREEN_CHECK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGreenCheck>;
    if (
      typeof parsed?.cartHash !== "string" ||
      parsed.cartHash === "" ||
      typeof parsed?.at !== "number" ||
      !Number.isFinite(parsed.at) ||
      typeof parsed?.runId !== "string" ||
      typeof parsed?.storeId !== "string"
    ) {
      return null;
    }
    if (parsed.storeId !== storeId) return null;
    if (Date.now() - parsed.at >= CHECK_TRUST_WINDOW_MS) return null; // expired — dead weight
    return { cartHash: parsed.cartHash, at: parsed.at, runId: parsed.runId };
  } catch {
    return null;
  }
}

function writeStoredGreenCheck(check: StoredGreenCheck | null) {
  try {
    if (check) {
      window.localStorage.setItem(GREEN_CHECK_STORAGE_KEY, JSON.stringify(check));
    } else {
      window.localStorage.removeItem(GREEN_CHECK_STORAGE_KEY);
    }
  } catch {
    /* non-fatal — Place just needs a re-check after reload. */
  }
}

export function ActiveOrderProvider({ children }: { children: ReactNode }) {
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  // Rehydrated lazily on mount (store-scoped, expiry-pruned) so Place
  // eligibility survives an app close/reopen within the trust window.
  const [lastGreenCheck, setLastGreenCheck] = useState<LastGreenCheck | null>(
    () => readStoredGreenCheck(getCurrentStoreId()),
  );

  // Generation guard (mirrors useSubmission.runGenRef): only ONE poll loop
  // runs at a time. Each trackOrder/resume/dismiss/unmount bumps the
  // generation; a stale loop sees the mismatch and exits silently.
  const runGenRef = useRef(0);
  const mountedRef = useRef(true);

  // Mark mounted; on unmount, invalidate any surviving poll loop.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runGenRef.current += 1;
    };
  }, []);

  /**
   * Background poll for one run. Fetches getRunSummary IMMEDIATELY — a
   * freshly-tracked or rehydrated run reflects its live status right away, with
   * no dead interval before the first update (instant-feel on reopen). Then
   * waits POLL_INTERVAL_MS between ticks, easing to POLL_BACKOFF_INTERVAL_MS
   * after 60s, until terminal / superseded / unmounted. Transient API errors
   * are swallowed (fetchWithRetry already handles blips) — we never give up on
   * a live run. On terminal, set `result` and STOP, keeping the terminal state
   * for the pill to show until dismiss().
   */
  const poll = useCallback(async (order: ActiveOrder) => {
    const gen = ++runGenRef.current;
    const pollStart = Date.now();
    while (mountedRef.current && runGenRef.current === gen) {
      // Fetch FIRST so the pill reflects the live run immediately (no dead
      // interval on a fresh tap or an app-reopen rehydrate).
      const res = await getRunSummary({ runId: order.runId });
      if (!mountedRef.current || runGenRef.current !== gen) return;
      if (res.ok) {
        const s = res.summary;
        const status = s.status;
        const progressStage = s.progress_stage;
        const progressMessage = s.progress_message;

        // Live progress update (only if this run is still the active one).
        setActiveOrder((cur) =>
          cur && cur.runId === order.runId
            ? { ...cur, status, progressStage, progressMessage }
            : cur,
        );

        if (isTerminalStatus(status)) {
          const result: ActiveOrderResult = {
            submitted: s.submit_result?.submitted ?? null,
            failureType: s.failure_type ?? null,
            failureMessage: s.failure_message ?? null,
            validateResult: s.validate_result ?? null,
            confirmationNumbers: s.submit_result?.confirmation_numbers ?? null,
            durationMs: Date.now() - order.startedAtMs,
          };
          setActiveOrder((cur) =>
            cur && cur.runId === order.runId ? { ...cur, status, result } : cur,
          );
          /*
            Record the GREEN check (two-step ordering, 2026-07-11): a
            validate_only run that succeeded with MILO's own
            can_checkout=true, fired for a known cart hash, unlocks Place
            for exactly those lines (gated again by freshness + hash match
            in resolvePlaceGate — and by the server's Stage-5 triple gate
            regardless). Submit runs and failed/red checks never write
            this. Timestamped at the moment the result LANDED, not when
            the run started — freshness measures the age of MILO's answer.
          */
          if (
            order.mode === "validate_only" &&
            typeof order.cartHash === "string" &&
            order.cartHash !== "" &&
            status === "succeeded" &&
            s.validate_result?.can_checkout === true
          ) {
            const green: StoredGreenCheck = {
              cartHash: order.cartHash,
              at: Date.now(),
              runId: order.runId,
              storeId: order.storeId,
            };
            writeStoredGreenCheck(green);
            setLastGreenCheck({
              cartHash: green.cartHash,
              at: green.at,
              runId: green.runId,
            });
          }
          // STOP polling; KEEP the terminal result in state until dismiss().
          return;
        }
      }
      // Transient API errors fall through here too — never give up on a live
      // run. Wait before the next tick; ease off after the first minute.
      const interval =
        Date.now() - pollStart > POLL_BACKOFF_AFTER_MS
          ? POLL_BACKOFF_INTERVAL_MS
          : POLL_INTERVAL_MS;
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
      if (!mountedRef.current || runGenRef.current !== gen) return;
    }
  }, []);

  const trackOrder = useCallback(
    (runId: string, mode: RunMode, opts?: { cartHash?: string }) => {
      const storeId = getCurrentStoreId();
      if (!storeId) return; // no store context — can't scope a tracked run
      const startedAtMs = Date.now();
      const cartHash =
        typeof opts?.cartHash === "string" && opts.cartHash !== ""
          ? opts.cartHash
          : null;
      writeStoredOrder({ runId, mode, storeId, startedAtMs, cartHash });
      const order: ActiveOrder = {
        runId,
        mode,
        storeId,
        status: "queued",
        progressStage: null,
        progressMessage: null,
        startedAtMs,
        cartHash,
        result: null,
      };
      setActiveOrder(order);
      void poll(order); // bumping gen inside poll retires any prior loop
    },
    [poll],
  );

  const dismiss = useCallback(() => {
    runGenRef.current += 1; // stop any in-flight poll
    writeStoredOrder(null);
    setActiveOrder(null);
  }, []);

  // Rehydrate on mount: if a tracked order for THIS store is still fresh,
  // resume polling (the first tick may already find it terminal). Otherwise
  // drop the stale key so a reload never shows a dead run.
  useEffect(() => {
    const stored = readStoredOrder();
    if (!stored) return;
    const currentStore = getCurrentStoreId();
    const fresh = Date.now() - stored.startedAtMs < REHYDRATE_MAX_AGE_MS;
    if (!currentStore || stored.storeId !== currentStore || !fresh) {
      writeStoredOrder(null);
      return;
    }
    const order: ActiveOrder = {
      runId: stored.runId,
      mode: stored.mode,
      storeId: stored.storeId,
      status: "running",
      progressStage: null,
      progressMessage: null,
      startedAtMs: stored.startedAtMs,
      // Older stored blobs (pre-2026-07-11) have no cartHash → null; a
      // rehydrated check without a hash simply can't unlock Place.
      cartHash: typeof stored.cartHash === "string" && stored.cartHash !== "" ? stored.cartHash : null,
      result: null,
    };
    setActiveOrder(order);
    void poll(order);
  }, [poll]);

  const value: ActiveOrderContextValue = { activeOrder, trackOrder, dismiss, lastGreenCheck };
  return (
    <ActiveOrderContext.Provider value={value}>
      {children}
    </ActiveOrderContext.Provider>
  );
}

export function useActiveOrder(): ActiveOrderContextValue {
  const ctx = useContext(ActiveOrderContext);
  if (!ctx) {
    throw new Error("useActiveOrder must be used within an ActiveOrderProvider");
  }
  return ctx;
}
