/**
 * Remove-OOS-from-the-result-sheet pins (2026-08-01, Tony's screenshot ask:
 * "i should be able to remove that item that is out of stock from that page…
 * either remove each one individually or remove all at once").
 *
 * The sheet edits the REAL cart (CartProvider), the removed row stays
 * visible struck-through as a receipt, and the re-check nudge appears —
 * because removal flips the place-gate hash and the old green check is dead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartProvider } from "../hooks/useCart";
import { RunResultSheet } from "./RunResultSheet";
import type { ActiveOrderResult } from "../hooks/useActiveOrder";
import type { MlccProduct } from "../types";

const CART_KEY = "lk-scanner-cart-v1";

function prod(code: string, name: string): MlccProduct {
  return {
    id: `id-${code}`,
    code,
    name,
    brand_family: null,
    category: null,
    ada_number: "321",
    ada_name: "NWS Michigan",
    proof: null,
    bottle_size_label: "750 ML",
    bottle_size_ml: 750,
    case_size: 12,
    licensee_price: 10,
    min_shelf_price: 12,
    base_price: 9,
    container: null,
    pack_count: null,
    is_new_item: false,
    imageUrl: null,
    last_price_book_date: null,
    is_active: true,
  } as MlccProduct;
}

function seedCart(codes: Array<[string, string]>): void {
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({
      version: 1,
      lines: codes.map(([code, name]) => ({ product: prod(code, name), quantity: 3 })),
      updatedAt: "2026-08-01T12:00:00Z",
    }),
  );
}

function cartCodesNow(): string[] {
  const raw = localStorage.getItem(CART_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { lines?: Array<{ product: { code: string } }> };
  return (parsed.lines ?? []).map((l) => l.product.code);
}

function resultWithOos(
  oos: Array<{ code?: string | null; quantity?: number; reason?: string }>,
  over: Partial<ActiveOrderResult> = {},
): ActiveOrderResult {
  return {
    submitted: false,
    failureType: null,
    failureMessage: null,
    validateResult: {
      can_checkout: false,
      out_of_stock_items: oos,
      order_summary: null,
      validate_messages: [],
      validate_errors: [],
    },
    confirmationNumbers: null,
    durationMs: 5000,
    ...over,
  } as unknown as ActiveOrderResult;
}

function renderSheet(result: ActiveOrderResult, withProvider = true) {
  const ui = (
    <RunResultSheet result={result} mode="validate_only" onClose={vi.fn()} />
  );
  return render(withProvider ? <CartProvider>{ui}</CartProvider> : ui);
}

beforeEach(() => {
  localStorage.clear();
});

describe("RunResultSheet — remove out-of-stock from the sheet", () => {
  it("removes exactly that line from the real cart and leaves a receipt", () => {
    seedCart([
      ["6401", "CIROC RED BERRY"],
      ["9528", "OLD CROW"],
    ]);
    renderSheet(resultWithOos([{ code: "6401", quantity: 6, reason: "oos_section" }]));

    fireEvent.click(screen.getByLabelText(/Remove CIROC RED BERRY/));

    expect(cartCodesNow()).toEqual(["9528"]); // the other line survives
    expect(screen.getByText("removed from cart")).toBeTruthy();
    expect(screen.queryByText(/Remove$/)).toBeNull(); // its button is gone
    // The nudge tells the truth about the now-stale green check.
    expect(screen.getByText(/Run a fresh Check before placing/)).toBeTruthy();
  });

  it("Remove all appears only for 2+ rows and clears every OOS line at once", () => {
    seedCart([
      ["6401", "CIROC RED BERRY"],
      ["9528", "OLD CROW"],
      ["1111", "KEEPER BOTTLE"],
    ]);
    renderSheet(
      resultWithOos([
        { code: "6401", quantity: 6 },
        { code: "9528", quantity: 2 },
      ]),
    );

    fireEvent.click(screen.getByText("Remove all out-of-stock (2)"));

    expect(cartCodesNow()).toEqual(["1111"]); // only the in-stock keeper remains
    expect(screen.getAllByText("removed from cart")).toHaveLength(2);
    expect(screen.queryByText(/Remove all out-of-stock/)).toBeNull();
  });

  it("a single removable row gets its own button but no Remove-all", () => {
    seedCart([["6401", "CIROC RED BERRY"]]);
    renderSheet(resultWithOos([{ code: "6401" }]));
    expect(screen.getByLabelText(/Remove CIROC RED BERRY/)).toBeTruthy();
    expect(screen.queryByText(/Remove all out-of-stock/)).toBeNull();
  });

  it("no remove UI on a really-submitted order (the cart clears on Done anyway)", () => {
    seedCart([["6401", "CIROC RED BERRY"]]);
    renderSheet(
      resultWithOos([{ code: "6401" }], {
        submitted: true,
        confirmationNumbers: { "321": "A1" },
      } as Partial<ActiveOrderResult>),
    );
    expect(screen.queryByLabelText(/Remove/)).toBeNull();
  });

  it("an OOS code that is not in the cart gets no button (nothing to remove)", () => {
    seedCart([["9528", "OLD CROW"]]);
    renderSheet(resultWithOos([{ code: "6401", quantity: 1 }]));
    expect(screen.queryByLabelText(/^Remove/)).toBeNull();
  });

  it("renders calmly with no CartProvider at all — display only, no buttons", () => {
    renderSheet(resultWithOos([{ code: "6401", quantity: 1 }]), false);
    expect(screen.getByText(/#6401/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Remove/)).toBeNull();
  });
});
