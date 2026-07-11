/**
 * Unit tests for useBackgroundPreValidate — the silent background
 * validate that pre-checks the cart while the user builds it.
 *
 * Added 2026-07-11 with the run-dedupe work. Focus areas:
 *   - the hook fires ONE run after the cart stays stable (5s debounce)
 *   - the cached result carries the REAL runId (fireOrder tracks it)
 *   - getInFlightRun exposes the live runId mid-flight, hash-matched
 *   - cache freshness: results older than CACHE_FRESH_MS are a miss
 *     (stale stock truth must never be re-served as a green check)
 *
 * API layer fully mocked — no network, no Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CartItem, MlccProduct } from "../types";

vi.mock("../api/cart", () => ({
  replaceCartLines: vi.fn(),
}));

vi.mock("../api/execution", () => ({
  getRunSummary: vi.fn(),
  isTerminalStatus: (status: string) =>
    status === "succeeded" || status === "failed" || status === "cancelled",
  triggerRpaRunFromCart: vi.fn(),
}));

import { replaceCartLines } from "../api/cart";
import { getRunSummary, triggerRpaRunFromCart } from "../api/execution";
import { useBackgroundPreValidate } from "./useBackgroundPreValidate";

const mockReplaceCartLines = replaceCartLines as unknown as ReturnType<
  typeof vi.fn
>;
const mockTriggerRun = triggerRpaRunFromCart as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetRunSummary = getRunSummary as unknown as ReturnType<typeof vi.fn>;

const STABILITY_DEBOUNCE_MS = 5000;
const POLL_INTERVAL_MS = 2500;

function makeProduct(code: string): MlccProduct {
  return {
    id: `id-${code}`,
    code,
    name: `Test Bottle ${code}`,
    brand_family: null,
    category: null,
    ada_number: "ADA-1",
    ada_name: "Test ADA",
    proof: null,
    bottle_size_label: "750ml",
    bottle_size_ml: 750,
    case_size: 12,
    licensee_price: 10,
    min_shelf_price: 15,
    base_price: 12,
    is_new_item: false,
  };
}

function makeItems(code = "1234", quantity = 2): CartItem[] {
  return [{ product: makeProduct(code), quantity }];
}

/** A run summary row in the REAL RunSummary shape the poll consumes. */
function summaryRow(status: string) {
  return {
    ok: true,
    summary: {
      id: "run-bg-1",
      status,
      progress_stage: status === "succeeded" ? "validate_only_complete" : "validate",
      progress_message: null,
      failure_type: null,
      failure_message: null,
      validate_result:
        status === "succeeded"
          ? {
              validated: true,
              can_checkout: true,
              ada_breakdown: null,
              order_summary: { grossTotal: 100, netTotal: 90 },
              items_added: [],
              items_rejected: null,
              out_of_stock_items: null,
              validate_messages: null,
              validate_errors: null,
            }
          : null,
      submit_result: null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReplaceCartLines.mockReset();
  mockTriggerRun.mockReset();
  mockGetRunSummary.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance the fake clock inside act so state updates land. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Debounce → sync → trigger → one poll tick → terminal. */
async function runToSuccess() {
  mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-bg" });
  mockTriggerRun.mockResolvedValue({
    ok: true,
    runId: "run-bg-1",
    status: "queued",
  });
  mockGetRunSummary.mockResolvedValue(summaryRow("succeeded"));
}

describe("useBackgroundPreValidate", () => {
  it("fires ONE run after the cart stays stable and caches the result with the REAL runId", async () => {
    runToSuccess();
    const items = makeItems();
    const { result } = renderHook(() => useBackgroundPreValidate(items));

    // Nothing fires before the debounce elapses.
    await advance(STABILITY_DEBOUNCE_MS - 1000);
    expect(mockTriggerRun).not.toHaveBeenCalled();

    // Debounce fires → sync + trigger, then one poll tick → terminal.
    await advance(1000);
    await advance(POLL_INTERVAL_MS);

    expect(mockTriggerRun).toHaveBeenCalledTimes(1);
    expect(mockTriggerRun).toHaveBeenCalledWith({
      cartId: "cart-bg",
      mode: "validate_only",
    });

    const cached = result.current.getCachedResult(items);
    expect(cached).not.toBeNull();
    expect(cached).toMatchObject({
      cartId: "cart-bg",
      runId: "run-bg-1",
      finalStatus: "succeeded",
    });
  });

  it("getInFlightRun exposes the live runId mid-flight for the SAME cart, null for a different one", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-bg" });
    mockTriggerRun.mockResolvedValue({
      ok: true,
      runId: "run-bg-1",
      status: "queued",
    });
    // Run never terminates within this test — stays running.
    mockGetRunSummary.mockResolvedValue(summaryRow("running"));

    const items = makeItems();
    const { result } = renderHook(() => useBackgroundPreValidate(items));

    // Fire the debounce; the trigger resolves (microtasks flushed by
    // the async advance), the poll is now sleeping.
    await advance(STABILITY_DEBOUNCE_MS);

    const inFlight = result.current.getInFlightRun(items);
    expect(inFlight).not.toBeNull();
    expect(inFlight!.runId).toBe("run-bg-1");

    // A DIFFERENT cart must never latch onto this run.
    expect(result.current.getInFlightRun(makeItems("9999", 1))).toBeNull();

    // No cached result yet — the run hasn't finished.
    expect(result.current.getCachedResult(items)).toBeNull();
  });

  it("cache freshness: a result older than 5 minutes is a MISS (stale stock truth is never re-served)", async () => {
    runToSuccess();
    const items = makeItems();
    const { result } = renderHook(() => useBackgroundPreValidate(items));

    await advance(STABILITY_DEBOUNCE_MS);
    await advance(POLL_INTERVAL_MS);
    expect(result.current.getCachedResult(items)).not.toBeNull();

    // 4 minutes later: still fresh.
    await advance(4 * 60 * 1000);
    expect(result.current.getCachedResult(items)).not.toBeNull();

    // Past the 5-minute bound: miss.
    await advance(62 * 1000);
    expect(result.current.getCachedResult(items)).toBeNull();
  });

  it("a cart change drops the stale cache (hash mismatch) and the pending debounce", async () => {
    runToSuccess();
    const initial = makeItems();
    const { result, rerender } = renderHook(
      ({ items }: { items: CartItem[] }) => useBackgroundPreValidate(items),
      { initialProps: { items: initial } },
    );

    await advance(STABILITY_DEBOUNCE_MS);
    await advance(POLL_INTERVAL_MS);
    expect(result.current.getCachedResult(initial)).not.toBeNull();

    // Cart mutates — the cached result must not answer for the NEW cart,
    // and asking with the OLD lines must also miss (cache was dropped).
    const changed = makeItems("1234", 5);
    rerender({ items: changed });
    expect(result.current.getCachedResult(changed)).toBeNull();
    expect(result.current.getCachedResult(initial)).toBeNull();
  });
});
