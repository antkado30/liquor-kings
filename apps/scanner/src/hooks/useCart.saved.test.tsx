/**
 * #28 save-for-later pins (2026-08-10). The saved list is a parking
 * spot OUTSIDE the money path: saved lines leave the cart (and its
 * totals) entirely, survive reloads via their own localStorage
 * bucket, and restore by merging back through raw addItem.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { MlccProduct } from "../types";
import { CartProvider, useCart } from "./useCart";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

function product(overrides: Partial<MlccProduct> = {}): MlccProduct {
  return {
    id: "p1",
    code: "1234",
    name: "JACK DANIELS BLACK",
    ada_number: "417",
    ada_name: "ADA 417",
    licensee_price: 24.99,
    bottle_size_ml: 750,
    ...overrides,
  } as MlccProduct;
}

const LINE_ID = "1234::417";

beforeEach(() => {
  localStorage.clear();
});

describe("save-for-later (#28)", () => {
  it("saving a line moves it out of the cart — totals shrink to zero", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 3));
    expect(result.current.totalCost).toBeCloseTo(74.97);

    act(() => result.current.saveForLater(LINE_ID));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.totalCost).toBe(0);
    expect(result.current.savedItems).toHaveLength(1);
    expect(result.current.savedItems[0].quantity).toBe(3);
  });

  it("move back to cart restores the exact line and empties saved", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 3));
    act(() => result.current.saveForLater(LINE_ID));
    act(() => result.current.moveSavedToCart(LINE_ID));
    expect(result.current.savedItems).toHaveLength(0);
    expect(result.current.items[0].quantity).toBe(3);
  });

  it("restore MERGES if the product was re-added meanwhile", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 3));
    act(() => result.current.saveForLater(LINE_ID));
    act(() => result.current.addItem(product(), 2)); // re-added fresh
    act(() => result.current.moveSavedToCart(LINE_ID));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].quantity).toBe(5);
  });

  it("saving the same product twice merges quantities in saved", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 2));
    act(() => result.current.saveForLater(LINE_ID));
    act(() => result.current.addItem(product(), 4));
    act(() => result.current.saveForLater(LINE_ID));
    expect(result.current.savedItems).toHaveLength(1);
    expect(result.current.savedItems[0].quantity).toBe(6);
  });

  it("removeSaved drops the line without touching the cart", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 2));
    act(() => result.current.addItem(product({ id: "p2", code: "9999" }), 1));
    act(() => result.current.saveForLater(LINE_ID));
    act(() => result.current.removeSaved(LINE_ID));
    expect(result.current.savedItems).toHaveLength(0);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].product.code).toBe("9999");
  });

  it("saved list survives a reload (own localStorage bucket)", () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => first.result.current.addItem(product(), 3));
    act(() => first.result.current.saveForLater(LINE_ID));
    first.unmount(); // unmount flushes the persist timeout

    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.savedItems).toHaveLength(1);
    expect(second.result.current.savedItems[0].product.name).toBe("JACK DANIELS BLACK");
    expect(second.result.current.items).toHaveLength(0);
  });

  it("clearCart leaves saved items alone", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 2));
    act(() => result.current.saveForLater(LINE_ID));
    act(() => result.current.addItem(product({ id: "p2", code: "9999" }), 1));
    act(() => result.current.clearCart());
    expect(result.current.items).toHaveLength(0);
    expect(result.current.savedItems).toHaveLength(1);
  });
});
