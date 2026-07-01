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
