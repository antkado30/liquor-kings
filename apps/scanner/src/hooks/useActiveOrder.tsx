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
 * INFRASTRUCTURE ONLY. Nothing calls trackOrder yet — with no order tracked,
 * activeOrder is null, the pill renders null, and the app behaves exactly as
 * today. No validate/submit behavior is changed.
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

const STORAGE_KEY = "lk.activeOrder.v1";
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
  /** null while polling; set once the run reaches a terminal status. */
  result: ActiveOrderResult | null;
};

/** Minimal shape persisted to localStorage for reload-mid-order rehydration. */
type StoredOrder = {
  runId: string;
  mode: RunMode;
  storeId: string;
  startedAtMs: number;
};

type ActiveOrderContextValue = {
  activeOrder: ActiveOrder | null;
  /** Begin tracking a run. Persists to localStorage and starts the poll. */
  trackOrder: (runId: string, mode: RunMode) => void;
  /** Clear the active order + the persisted key. Stops polling. */
  dismiss: () => void;
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

export function ActiveOrderProvider({ children }: { children: ReactNode }) {
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);

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
   * Background poll for one run. Mirrors pollUntilTerminal: getRunSummary
   * every POLL_INTERVAL_MS, ease to POLL_BACKOFF_INTERVAL_MS after 60s, keep
   * going until terminal / superseded / unmounted. Transient API errors are
   * swallowed (fetchWithRetry already handles blips) — we never give up on a
   * live run. On terminal, set `result` and STOP, keeping the terminal state
   * for the pill to show until dismiss().
   */
  const poll = useCallback(async (order: ActiveOrder) => {
    const gen = ++runGenRef.current;
    const pollStart = Date.now();
    let interval = POLL_INTERVAL_MS;
    while (mountedRef.current && runGenRef.current === gen) {
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
      if (!mountedRef.current || runGenRef.current !== gen) return;
      if (Date.now() - pollStart > POLL_BACKOFF_AFTER_MS) {
        interval = POLL_BACKOFF_INTERVAL_MS;
      }
      const res = await getRunSummary({ runId: order.runId });
      if (!mountedRef.current || runGenRef.current !== gen) return;
      if (!res.ok) {
        // Transient API error — keep polling, don't fail the run.
        continue;
      }
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
          durationMs: Date.now() - order.startedAtMs,
        };
        setActiveOrder((cur) =>
          cur && cur.runId === order.runId ? { ...cur, status, result } : cur,
        );
        // STOP polling; KEEP the terminal result in state until dismiss().
        return;
      }
    }
  }, []);

  const trackOrder = useCallback(
    (runId: string, mode: RunMode) => {
      const storeId = getCurrentStoreId();
      if (!storeId) return; // no store context — can't scope a tracked run
      const startedAtMs = Date.now();
      writeStoredOrder({ runId, mode, storeId, startedAtMs });
      const order: ActiveOrder = {
        runId,
        mode,
        storeId,
        status: "queued",
        progressStage: null,
        progressMessage: null,
        startedAtMs,
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
      result: null,
    };
    setActiveOrder(order);
    void poll(order);
  }, [poll]);

  const value: ActiveOrderContextValue = { activeOrder, trackOrder, dismiss };
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
