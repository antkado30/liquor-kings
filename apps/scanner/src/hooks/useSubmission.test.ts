/**
 * Unit tests for useSubmission — the validate->submit state machine that
 * drives the scanner cart drawer (see useSubmission.ts header doc).
 *
 * This is the exact state machine the Thursday real-order mandate test
 * (TONY-WANTS.md QUALITY MANDATE: 3 consecutive real orders in-app) will
 * exercise end to end. These tests mock the API layer (api/cart,
 * api/execution) entirely — no network, no Supabase auth, no dev server —
 * so they're safe to run anytime, including right before that test.
 *
 * Covers:
 *  - empty-cart guard (immediate error, no API calls)
 *  - validate happy path: idle -> validateSyncing -> validateStarting ->
 *    validatePolling -> validateDone(succeeded) with validateResult
 *  - validate trigger failure -> error state (recoverable)
 *  - submit guard: startSubmit() is a no-op unless state is
 *    validateDone with finalStatus === "succeeded"
 *  - submit happy path: validateDone(succeeded) -> submitStarting ->
 *    submitPolling -> submitDone with submitResult (audit #15 truth source)
 *  - invalidateValidation returns to idle
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
import { useSubmission } from "./useSubmission";

const mockReplaceCartLines = replaceCartLines as unknown as ReturnType<
  typeof vi.fn
>;
const mockTriggerRun = triggerRpaRunFromCart as unknown as ReturnType<
  typeof vi.fn
>;
const mockGetRunSummary = getRunSummary as unknown as ReturnType<typeof vi.fn>;

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

function makeItems(): CartItem[] {
  return [{ product: makeProduct("1234"), quantity: 2 }];
}

const POLL_INTERVAL_MS = 2500;

beforeEach(() => {
  vi.useFakeTimers();
  mockReplaceCartLines.mockReset();
  mockTriggerRun.mockReset();
  mockGetRunSummary.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * pollUntilTerminal does `await new Promise(r => setTimeout(r, 2500))`
 * before each getRunSummary call. With fake timers we need to advance
 * past that delay and flush microtasks for the state update to land.
 */
async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  });
}

describe("useSubmission", () => {
  it("rejects an empty cart immediately without calling the API", async () => {
    const { result } = renderHook(() => useSubmission());

    await act(async () => {
      await result.current.startValidate([]);
    });

    expect(result.current.state).toEqual({
      kind: "error",
      message: "Cart is empty. Add items before validating.",
      recoverable: true,
    });
    expect(mockReplaceCartLines).not.toHaveBeenCalled();
    expect(mockTriggerRun).not.toHaveBeenCalled();
  });

  it("walks the validate flow to validateDone(succeeded) with validateResult", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-1" });
    mockTriggerRun.mockResolvedValue({
      ok: true,
      runId: "run-1",
      status: "queued",
    });

    const validateResult = {
      validated: true,
      can_checkout: true,
      ada_breakdown: null,
      order_summary: { grossTotal: 100, netTotal: 90 },
      items_added: [],
      items_rejected: null,
      out_of_stock_items: null,
      validate_messages: ["All items in stock"],
      validate_errors: null,
    };

    mockGetRunSummary
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-1",
          status: "running",
          progress_stage: "validate",
          progress_message: "Checking MLCC...",
          failure_type: null,
          failure_message: null,
          validate_result: null,
          submit_result: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-1",
          status: "succeeded",
          progress_stage: "validate_only_complete",
          progress_message: null,
          failure_type: null,
          failure_message: null,
          validate_result: validateResult,
          submit_result: null,
        },
      });

    const { result } = renderHook(() => useSubmission());

    let runPromise: Promise<void>;
    await act(async () => {
      runPromise = result.current.startValidate(makeItems());
    });

    // Sync phase -> trigger -> first poll tick
    await advancePoll();
    expect(result.current.state.kind).toBe("validatePolling");
    if (result.current.state.kind === "validatePolling") {
      expect(result.current.state.status).toBe("running");
      expect(result.current.state.progressMessage).toBe("Checking MLCC...");
    }

    // Second poll tick -> terminal
    await advancePoll();
    await act(async () => {
      await runPromise!;
    });

    expect(mockReplaceCartLines).toHaveBeenCalledWith([
      { mlccCode: "1234", quantity: 2 },
    ]);
    expect(mockTriggerRun).toHaveBeenCalledWith({
      cartId: "cart-1",
      mode: "validate_only",
    });

    expect(result.current.state).toEqual({
      kind: "validateDone",
      runId: "run-1",
      finalStatus: "succeeded",
      cartId: "cart-1",
      validateResult,
      failureType: null,
      failureMessage: null,
    });
  });

  it("surfaces a trigger failure as a recoverable error", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-1" });
    mockTriggerRun.mockResolvedValue({
      ok: false,
      error: "MLCC session expired",
    });

    const { result } = renderHook(() => useSubmission());

    await act(async () => {
      await result.current.startValidate(makeItems());
    });

    expect(result.current.state).toEqual({
      kind: "error",
      message: "Could not start MLCC validate: MLCC session expired",
      recoverable: true,
    });
    expect(mockGetRunSummary).not.toHaveBeenCalled();
  });

  it("startSubmit is a no-op from idle (no cartId, nothing validated)", async () => {
    const { result } = renderHook(() => useSubmission());

    await act(async () => {
      await result.current.startSubmit();
    });

    expect(result.current.state).toEqual({ kind: "idle" });
    expect(mockTriggerRun).not.toHaveBeenCalled();
  });

  it("startSubmit is a no-op when validateDone but finalStatus !== succeeded", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-1" });
    mockTriggerRun.mockResolvedValue({
      ok: true,
      runId: "run-1",
      status: "queued",
    });
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-1",
        status: "failed",
        progress_stage: null,
        progress_message: null,
        failure_type: "mlcc_login_failed",
        failure_message: "Could not log in to MLCC",
        validate_result: null,
        submit_result: null,
      },
    });

    const { result } = renderHook(() => useSubmission());

    let runPromise: Promise<void>;
    await act(async () => {
      runPromise = result.current.startValidate(makeItems());
    });
    await advancePoll();
    await act(async () => {
      await runPromise!;
    });

    expect(result.current.state.kind).toBe("validateDone");
    if (result.current.state.kind === "validateDone") {
      expect(result.current.state.finalStatus).toBe("failed");
    }

    mockTriggerRun.mockClear();
    await act(async () => {
      await result.current.startSubmit();
    });

    // Still validateDone(failed) — submit must not have fired.
    expect(result.current.state.kind).toBe("validateDone");
    expect(mockTriggerRun).not.toHaveBeenCalled();
  });

  it("walks the submit flow to submitDone with submitResult (audit #15 truth source)", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-1" });

    // Validate trigger + poll
    mockTriggerRun.mockResolvedValueOnce({
      ok: true,
      runId: "run-validate",
      status: "queued",
    });
    mockGetRunSummary.mockResolvedValueOnce({
      ok: true,
      summary: {
        id: "run-validate",
        status: "succeeded",
        progress_stage: "validate_only_complete",
        progress_message: null,
        failure_type: null,
        failure_message: null,
        validate_result: {
          validated: true,
          can_checkout: true,
          ada_breakdown: null,
          order_summary: null,
          items_added: [],
          items_rejected: null,
          out_of_stock_items: null,
          validate_messages: null,
          validate_errors: null,
        },
        submit_result: null,
      },
    });

    const { result } = renderHook(() => useSubmission());

    let validatePromise: Promise<void>;
    act(() => {
      validatePromise = result.current.startValidate(makeItems());
    });
    await advancePoll();
    await act(async () => {
      await validatePromise!;
    });
    expect(result.current.state.kind).toBe("validateDone");

    // Submit trigger + poll
    mockTriggerRun.mockResolvedValueOnce({
      ok: true,
      runId: "run-submit",
      status: "queued",
    });
    mockGetRunSummary
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-submit",
          status: "running",
          progress_stage: "checkout",
          progress_message: "Submitting order to MILO...",
          failure_type: null,
          failure_message: null,
          validate_result: null,
          submit_result: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        summary: {
          id: "run-submit",
          status: "succeeded",
          progress_stage: "submit_complete",
          progress_message: "Order placed",
          failure_type: null,
          failure_message: null,
          validate_result: null,
          submit_result: {
            mode: "rpa_run",
            submitted: true,
            confirmation_numbers: ["MLCC-123456"],
            dry_run_reason: null,
          },
        },
      });

    let submitPromise: Promise<void>;
    await act(async () => {
      submitPromise = result.current.startSubmit();
    });

    await advancePoll();
    expect(result.current.state.kind).toBe("submitPolling");
    if (result.current.state.kind === "submitPolling") {
      expect(result.current.state.progressMessage).toBe(
        "Submitting order to MILO...",
      );
    }

    await advancePoll();
    await act(async () => {
      await submitPromise!;
    });

    expect(mockTriggerRun).toHaveBeenLastCalledWith({
      cartId: "cart-1",
      mode: "rpa_run",
    });
    // Cart synced once during validate, not re-synced for submit.
    expect(mockReplaceCartLines).toHaveBeenCalledTimes(1);

    expect(result.current.state).toEqual({
      kind: "submitDone",
      runId: "run-submit",
      finalStatus: "succeeded",
      failureType: null,
      failureMessage: null,
      progressMessage: "Order placed",
      submitResult: {
        mode: "rpa_run",
        submitted: true,
        confirmation_numbers: ["MLCC-123456"],
        dry_run_reason: null,
      },
    });
  });

  it("invalidateValidation resets validateDone back to idle", async () => {
    mockReplaceCartLines.mockResolvedValue({ ok: true, cartId: "cart-1" });
    mockTriggerRun.mockResolvedValue({
      ok: true,
      runId: "run-1",
      status: "queued",
    });
    mockGetRunSummary.mockResolvedValue({
      ok: true,
      summary: {
        id: "run-1",
        status: "succeeded",
        progress_stage: "validate_only_complete",
        progress_message: null,
        failure_type: null,
        failure_message: null,
        validate_result: null,
        submit_result: null,
      },
    });

    const { result } = renderHook(() => useSubmission());

    let runPromise: Promise<void>;
    await act(async () => {
      runPromise = result.current.startValidate(makeItems());
    });
    await advancePoll();
    await act(async () => {
      await runPromise!;
    });
    expect(result.current.state.kind).toBe("validateDone");

    act(() => {
      result.current.invalidateValidation();
    });

    expect(result.current.state).toEqual({ kind: "idle" });
  });
});
