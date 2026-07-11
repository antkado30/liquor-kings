/**
 * Unit tests for useActiveOrder — the app-level active-order tracker whose
 * localStorage persistence powers Tony's "close the app, reopen, my order
 * status is still there" want (TONY-WANTS + journal 2026-06-28).
 *
 * These prove the exact contract that want depends on, WITHOUT a device:
 *  - trackOrder persists the run to localStorage AND exposes it in state
 *  - RESTORE ON REMOUNT (close app → reopen): a fresh provider rehydrates a
 *    still-fresh stored order and reconnects its poll to the live run
 *  - a stale (>30 min) stored order is dropped and the key cleared, so a
 *    reload never resurrects a dead run
 *  - a stored order from a DIFFERENT store is dropped (no cross-store leak)
 *  - dismiss clears both state and the persisted key
 *  - live poll updates (stage/message) flow into the tracked order
 *
 * API + store modules are fully mocked — no network, no Supabase, no dev
 * server — so this is safe to run anytime, including right before the
 * Thursday real-order mandate clock. Mirrors useSubmission.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../api/execution", () => ({
  getRunSummary: vi.fn(),
  isTerminalStatus: (status: string) =>
    status === "succeeded" || status === "failed" || status === "cancelled",
}));

vi.mock("../lib/currentStore", () => ({
  getCurrentStoreId: vi.fn(() => "store-1"),
}));

import { getRunSummary } from "../api/execution";
import { getCurrentStoreId } from "../lib/currentStore";
import { ActiveOrderProvider, useActiveOrder } from "./useActiveOrder";

const mockGetRunSummary = getRunSummary as unknown as ReturnType<typeof vi.fn>;
const mockGetCurrentStoreId = getCurrentStoreId as unknown as ReturnType<
  typeof vi.fn
>;

// Must match useActiveOrder.tsx internals.
const STORAGE_KEY = "lk.activeOrder.v1";
const POLL_INTERVAL_MS = 2500;
const THIRTY_ONE_MIN_MS = 31 * 60 * 1000;

function wrapper({ children }: { children: ReactNode }) {
  return <ActiveOrderProvider>{children}</ActiveOrderProvider>;
}

/** Advance past one poll's inter-tick wait (POLL_INTERVAL_MS) and flush. */
async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  });
}

/**
 * Flush the mount/rehydrate effect AND the poll's immediate first fetch
 * (fires at ~0ms) WITHOUT triggering the next inter-tick wait.
 */
async function flushImmediate() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

function seedStored(order: {
  runId: string;
  mode: string;
  storeId: string;
  startedAtMs: number;
}) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  mockGetRunSummary.mockReset();
  // Safe default so the poll's immediate first fetch never throws in tests
  // that don't drive a specific response (ok:false → keep polling, no-op).
  mockGetRunSummary.mockResolvedValue({ ok: false });
  mockGetCurrentStoreId.mockReset();
  mockGetCurrentStoreId.mockReturnValue("store-1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useActiveOrder persistence", () => {
  it("trackOrder writes the run to localStorage and exposes it in state", () => {
    const { result } = renderHook(() => useActiveOrder(), { wrapper });

    act(() => {
      result.current.trackOrder("run-1", "validate_only");
    });

    expect(result.current.activeOrder?.runId).toBe("run-1");
    expect(result.current.activeOrder?.mode).toBe("validate_only");
    expect(result.current.activeOrder?.status).toBe("queued");
    expect(result.current.activeOrder?.result).toBeNull();

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!);
    expect(stored).toMatchObject({
      runId: "run-1",
      mode: "validate_only",
      storeId: "store-1",
    });
    expect(typeof stored.startedAtMs).toBe("number");
  });

  it("restores a fresh stored order on remount (close app → reopen) and reconnects the poll", async () => {
    // A run that was in flight when the app was closed, finished while away.
    seedStored({
      runId: "run-42",
      mode: "validate_only",
      storeId: "store-1",
      startedAtMs: Date.now() - 5000,
    });
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-42",
        status: "succeeded",
        progress_stage: "rpa_validate",
        progress_message: "Confirming your cart with MLCC",
        failure_type: null,
        failure_message: null,
        validate_result: {
          validated: true,
          can_checkout: true,
          out_of_stock_items: [],
          order_summary: { netTotal: 529.08 },
        },
        submit_result: { submitted: false },
      },
    });

    // Fresh provider = the app reopening from scratch.
    const { result } = renderHook(() => useActiveOrder(), { wrapper });

    // The pill is back immediately on mount — before any network — still
    // "in flight" (result null) until the first poll lands.
    expect(result.current.activeOrder).not.toBeNull();
    expect(result.current.activeOrder?.runId).toBe("run-42");
    expect(result.current.activeOrder?.result).toBeNull();

    // The poll reconnects and resolves the live run IMMEDIATELY — no 2.5s dead
    // wait on reopen (the instant-feel guarantee).
    await flushImmediate();
    expect(mockGetRunSummary).toHaveBeenCalledWith({ runId: "run-42" });
    expect(result.current.activeOrder?.status).toBe("succeeded");
    expect(result.current.activeOrder?.result).not.toBeNull();
    expect(result.current.activeOrder?.result?.validateResult?.can_checkout).toBe(
      true,
    );
    expect(typeof result.current.activeOrder?.result?.durationMs).toBe("number");
  });

  it("threads confirmation numbers through on a REAL submitted order (ADA-object shape)", async () => {
    // The worker's real shape (order-day contract, 2026-07-01): an object
    // keyed by ADA reference number, from Stage 5's orders-history scrape.
    // RunResultSheet renders these at the moment of truth — dropping them
    // (the pre-2026-07-01 behavior) made the user dig for the confirmation.
    seedStored({
      runId: "run-real-1",
      mode: "submit",
      storeId: "store-1",
      startedAtMs: Date.now() - 5000,
    });
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-real-1",
        status: "succeeded",
        progress_stage: "rpa_checkout",
        progress_message: "Order placed",
        failure_type: null,
        failure_message: null,
        validate_result: {
          validated: true,
          can_checkout: true,
          out_of_stock_items: [],
          order_summary: { netTotal: 5462.8 },
        },
        submit_result: {
          mode: "submit",
          submitted: true,
          confirmation_numbers: { "321": "30765405", "221": "5654920" },
          dry_run_reason: null,
        },
      },
    });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    await flushImmediate();

    expect(result.current.activeOrder?.result?.submitted).toBe(true);
    expect(result.current.activeOrder?.result?.confirmationNumbers).toEqual({
      "321": "30765405",
      "221": "5654920",
    });
  });

  it("leaves confirmation numbers null on a practice check (no submit_result numbers)", async () => {
    seedStored({
      runId: "run-practice-1",
      mode: "validate_only",
      storeId: "store-1",
      startedAtMs: Date.now() - 5000,
    });
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-practice-1",
        status: "succeeded",
        progress_stage: "rpa_validate",
        progress_message: "Confirming your cart with MLCC",
        failure_type: null,
        failure_message: null,
        validate_result: {
          validated: true,
          can_checkout: true,
          out_of_stock_items: [],
          order_summary: { netTotal: 100.0 },
        },
        submit_result: { submitted: false },
      },
    });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    await flushImmediate();

    expect(result.current.activeOrder?.result?.submitted).toBe(false);
    expect(result.current.activeOrder?.result?.confirmationNumbers).toBeNull();
  });

  it("drops a stale (>30 min) stored order on remount and clears the key", async () => {
    seedStored({
      runId: "old-run",
      mode: "validate_only",
      storeId: "store-1",
      startedAtMs: Date.now() - THIRTY_ONE_MIN_MS,
    });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    await flushImmediate();

    expect(result.current.activeOrder).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mockGetRunSummary).not.toHaveBeenCalled();
  });

  it("drops a stored order from a different store on remount", async () => {
    mockGetCurrentStoreId.mockReturnValue("store-1");
    seedStored({
      runId: "other-store-run",
      mode: "validate_only",
      storeId: "store-OTHER",
      startedAtMs: Date.now() - 1000,
    });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    await flushImmediate();

    expect(result.current.activeOrder).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mockGetRunSummary).not.toHaveBeenCalled();
  });

  it("dismiss clears both the tracked order and the persisted key", () => {
    const { result } = renderHook(() => useActiveOrder(), { wrapper });

    act(() => {
      result.current.trackOrder("run-9", "validate_only");
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.activeOrder).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("flows live poll updates (stage/message) into the tracked order before terminal", async () => {
    mockGetRunSummary
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-live",
          status: "running",
          progress_stage: "rpa_validate",
          progress_message: "Confirming your cart with MLCC",
          failure_type: null,
          failure_message: null,
          validate_result: null,
          submit_result: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-live",
          status: "succeeded",
          progress_stage: "rpa_validate",
          progress_message: null,
          failure_type: null,
          failure_message: null,
          validate_result: { validated: true, can_checkout: true, out_of_stock_items: [] },
          submit_result: { submitted: false },
        },
      });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-live", "validate_only");
    });

    // Immediate first fetch: still running, live stage/message surfaced.
    await flushImmediate();
    expect(result.current.activeOrder?.status).toBe("running");
    expect(result.current.activeOrder?.progressStage).toBe("rpa_validate");
    expect(result.current.activeOrder?.progressMessage).toBe(
      "Confirming your cart with MLCC",
    );
    expect(result.current.activeOrder?.result).toBeNull();

    // Next tick: terminal, result populated, polling stops.
    await advancePoll();
    expect(result.current.activeOrder?.status).toBe("succeeded");
    expect(result.current.activeOrder?.result).not.toBeNull();
  });

  it("transient poll errors do not fail or drop the tracked run", async () => {
    mockGetRunSummary
      .mockResolvedValueOnce({ ok: false, error: "network blip" })
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-blip",
          status: "succeeded",
          progress_stage: "rpa_validate",
          progress_message: null,
          failure_type: null,
          failure_message: null,
          validate_result: { validated: true, can_checkout: true, out_of_stock_items: [] },
          submit_result: { submitted: false },
        },
      });

    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-blip", "validate_only");
    });

    // Immediate first fetch errors — run must still be alive, still polling.
    await flushImmediate();
    expect(result.current.activeOrder).not.toBeNull();
    expect(result.current.activeOrder?.result).toBeNull();

    // Next tick succeeds.
    await advancePoll();
    expect(result.current.activeOrder?.status).toBe("succeeded");
    expect(result.current.activeOrder?.result).not.toBeNull();
  });
});

/**
 * Green-check recording (two-step Check → SEE → Place, 2026-07-11).
 * A tracked validate_only run that lands succeeded with MILO's
 * can_checkout=true — and was fired with a known cart hash — records the
 * Place-unlocking check. Everything else must NOT.
 */
describe("useActiveOrder green-check recording", () => {
  const GREEN_KEY = "lk.lastGreenCheck.v1";

  function greenSummary(runId: string, overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      summary: {
        id: runId,
        status: "succeeded",
        progress_stage: "rpa_validate",
        progress_message: null,
        failure_type: null,
        failure_message: null,
        validate_result: {
          validated: true,
          can_checkout: true,
          out_of_stock_items: [],
          order_summary: { netTotal: 925.38 },
        },
        submit_result: { submitted: false },
        ...overrides,
      },
    };
  }

  it("records + persists the green check when a hashed validate_only lands clean", async () => {
    mockGetRunSummary.mockResolvedValue(greenSummary("run-g1"));
    const { result } = renderHook(() => useActiveOrder(), { wrapper });

    act(() => {
      result.current.trackOrder("run-g1", "validate_only", { cartHash: "1234:2|555:1" });
    });
    expect(result.current.lastGreenCheck).toBeNull(); // not green until terminal

    await flushImmediate();
    expect(result.current.lastGreenCheck).toMatchObject({
      cartHash: "1234:2|555:1",
      runId: "run-g1",
    });
    expect(typeof result.current.lastGreenCheck?.at).toBe("number");

    const stored = JSON.parse(window.localStorage.getItem(GREEN_KEY)!);
    expect(stored).toMatchObject({
      cartHash: "1234:2|555:1",
      runId: "run-g1",
      storeId: "store-1",
    });
  });

  it("a FAILED check never records a green", async () => {
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-f1",
        status: "failed",
        progress_stage: "rpa_validate",
        progress_message: null,
        failure_type: "MILO_LOGIN_NETWORK_ERROR",
        failure_message: "Could not reach MILO",
        validate_result: null,
        submit_result: null,
      },
    });
    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-f1", "validate_only", { cartHash: "h" });
    });
    await flushImmediate();
    expect(result.current.activeOrder?.status).toBe("failed");
    expect(result.current.lastGreenCheck).toBeNull();
    expect(window.localStorage.getItem(GREEN_KEY)).toBeNull();
  });

  it("succeeded but can_checkout=false (OOS / rule trouble) is NOT green", async () => {
    mockGetRunSummary.mockResolvedValue(
      greenSummary("run-oos", {
        validate_result: {
          validated: true,
          can_checkout: false,
          out_of_stock_items: [{ code: "95996" }],
        },
      }),
    );
    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-oos", "validate_only", { cartHash: "h" });
    });
    await flushImmediate();
    expect(result.current.lastGreenCheck).toBeNull();
  });

  it("a submit-mode run NEVER records a green check (only checks unlock Place)", async () => {
    mockGetRunSummary.mockResolvedValue(greenSummary("run-sub"));
    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-sub", "submit", { cartHash: "h" });
    });
    await flushImmediate();
    expect(result.current.activeOrder?.status).toBe("succeeded");
    expect(result.current.lastGreenCheck).toBeNull();
  });

  it("a green terminal WITHOUT a cart hash records nothing (nothing to match against)", async () => {
    mockGetRunSummary.mockResolvedValue(greenSummary("run-nohash"));
    const { result } = renderHook(() => useActiveOrder(), { wrapper });
    act(() => {
      result.current.trackOrder("run-nohash", "validate_only");
    });
    await flushImmediate();
    expect(result.current.lastGreenCheck).toBeNull();
  });

  it("rehydrates a fresh same-store green check on mount; drops other-store and expired ones", () => {
    // Fresh + same store → exposed.
    window.localStorage.setItem(
      GREEN_KEY,
      JSON.stringify({ cartHash: "h1", at: Date.now() - 60_000, runId: "r1", storeId: "store-1" }),
    );
    const first = renderHook(() => useActiveOrder(), { wrapper });
    expect(first.result.current.lastGreenCheck).toMatchObject({ cartHash: "h1", runId: "r1" });
    first.unmount();

    // Different store → null.
    window.localStorage.setItem(
      GREEN_KEY,
      JSON.stringify({ cartHash: "h2", at: Date.now() - 60_000, runId: "r2", storeId: "store-OTHER" }),
    );
    const second = renderHook(() => useActiveOrder(), { wrapper });
    expect(second.result.current.lastGreenCheck).toBeNull();
    second.unmount();

    // Expired (>10 min) → null.
    window.localStorage.setItem(
      GREEN_KEY,
      JSON.stringify({ cartHash: "h3", at: Date.now() - 11 * 60_000, runId: "r3", storeId: "store-1" }),
    );
    const third = renderHook(() => useActiveOrder(), { wrapper });
    expect(third.result.current.lastGreenCheck).toBeNull();
    third.unmount();

    // Corrupted blob → null, no throw.
    window.localStorage.setItem(GREEN_KEY, "{not json");
    const fourth = renderHook(() => useActiveOrder(), { wrapper });
    expect(fourth.result.current.lastGreenCheck).toBeNull();
  });
});
