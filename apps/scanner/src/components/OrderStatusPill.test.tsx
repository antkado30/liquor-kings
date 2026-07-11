/**
 * OrderStatusPill component tests (2026-07-08) — the "pill opens DURING the
 * run" want. Pins the four behaviors Tony asked for:
 *  1. Tapping the pill MID-RUN opens the live sheet (stage + honest practice
 *     copy) instead of doing nothing.
 *  2. When the run lands while the sheet is open, the result fills in — same
 *     sheet, no reopen.
 *  3. A succeeded run's tap still opens the full result (regression guard).
 *  4. A failed run's tap opens the honest failure view naming the reason
 *     (was: navigate home, which explained nothing).
 *
 * useActiveOrder is module-mocked — no network, no provider, no router.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { OrderStatusPill } from "./OrderStatusPill";
import type { ActiveOrder } from "../hooks/useActiveOrder";
import type { ValidateResult } from "../api/execution";

let mockActiveOrder: ActiveOrder | null = null;
const mockDismiss = vi.fn();

vi.mock("../hooks/useActiveOrder", () => ({
  useActiveOrder: () => ({ activeOrder: mockActiveOrder, dismiss: mockDismiss }),
}));

const runningOrder = (): ActiveOrder => ({
  runId: "run-1",
  mode: "validate_only",
  storeId: "store-1",
  status: "running",
  progressStage: "rpa_validate",
  progressMessage: null,
  startedAtMs: Date.now() - 5_000,
  cartHash: null, // pill fixtures don't exercise the Place gate (2026-07-11)
  result: null,
});

const cleanValidateResult: ValidateResult = {
  validated: true,
  can_checkout: true,
  ada_breakdown: null,
  order_summary: { grossTotal: 700, liquorTax: 84, discount: -120, netTotal: 664 },
  items_added: null,
  items_rejected: null,
  out_of_stock_items: [],
  validate_messages: ["Cart validated!"],
  validate_errors: null,
};

const succeededOrder = (): ActiveOrder => ({
  ...runningOrder(),
  status: "succeeded",
  result: {
    submitted: false,
    failureType: null,
    failureMessage: null,
    validateResult: cleanValidateResult,
    confirmationNumbers: null,
    durationMs: 23_000,
  },
});

const failedOrder = (): ActiveOrder => ({
  ...runningOrder(),
  status: "failed",
  result: {
    submitted: null,
    failureType: "MILO_STAGE4_TIMEOUT",
    failureMessage: "MILO validate timed out after 45 seconds.",
    validateResult: null,
    confirmationNumbers: null,
    durationMs: 47_000,
  },
});

beforeEach(() => {
  mockActiveOrder = null;
  mockDismiss.mockClear();
});

describe("OrderStatusPill — tap-through (2026-07-08 want)", () => {
  it("mid-run tap opens the LIVE sheet: stage line + honest practice copy", () => {
    mockActiveOrder = runningOrder();
    render(<OrderStatusPill />);

    // The pill itself shows the running headline.
    expect(screen.getByText("Checking your cart")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show run progress" }));

    const dialog = screen.getByRole("dialog", { name: "MLCC run progress" });
    expect(dialog.textContent).toContain("Confirming your cart"); // stage label
    expect(dialog.textContent).toContain("Practice check — nothing is being ordered.");
    expect(dialog.textContent).toContain("the result lands here");
  });

  it("result FILLS IN while the live sheet is open — same sheet, no reopen", () => {
    mockActiveOrder = runningOrder();
    const { rerender } = render(<OrderStatusPill />);
    fireEvent.click(screen.getByRole("button", { name: "Show run progress" }));
    expect(screen.getByRole("dialog", { name: "MLCC run progress" })).toBeTruthy();

    // The run lands: hook state flips to terminal; the pill re-renders.
    mockActiveOrder = succeededOrder();
    rerender(<OrderStatusPill />);

    const dialog = screen.getByRole("dialog", { name: "MLCC run result" });
    expect(dialog.textContent).toContain("Cart is ready");
    expect(dialog.textContent).toContain("Everything's in stock.");
    expect(dialog.textContent).toContain("$664.00");
  });

  it("succeeded tap still opens the full result sheet (regression guard)", () => {
    mockActiveOrder = succeededOrder();
    render(<OrderStatusPill />);
    fireEvent.click(screen.getByRole("button", { name: "Show run result" }));
    const dialog = screen.getByRole("dialog", { name: "MLCC run result" });
    expect(dialog.textContent).toContain("Cart is ready");
  });

  it("failed tap opens the honest failure view naming the reason", () => {
    mockActiveOrder = failedOrder();
    render(<OrderStatusPill />);
    fireEvent.click(screen.getByRole("button", { name: "Show run result" }));
    const dialog = screen.getByRole("dialog", { name: "MLCC run failed" });
    expect(dialog.textContent).toContain("Check couldn't finish");
    expect(dialog.textContent).toContain("MILO validate timed out after 45 seconds.");
    expect(dialog.textContent).toContain("Nothing was ordered — this was a check.");
  });
});
