/**
 * #29 guard-wiring pins (2026-08-10): addItemGuarded is the guarded
 * door in front of the cart. Clean adds pass instantly; duplicate/big
 * adds PARK (nothing enters the cart) until confirm; cancel drops the
 * add entirely. The decision math itself is pinned in add-guard.test.
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
    name: "TITOS HANDMADE VODKA",
    ada_number: "417",
    ada_name: "ADA 417",
    licensee_price: 19.99,
    bottle_size_ml: 750,
    ...overrides,
  } as MlccProduct;
}

beforeEach(() => {
  localStorage.clear();
});

describe("addItemGuarded (#29)", () => {
  it("clean small add goes straight into the cart, no prompt", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItemGuarded(product(), 3));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].quantity).toBe(3);
    expect(result.current.pendingAdd).toBeNull();
  });

  it("duplicate add parks — cart untouched until confirm", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItemGuarded(product(), 3));
    act(() => result.current.addItemGuarded(product(), 3));

    expect(result.current.items[0].quantity).toBe(3); // NOT 6 yet
    expect(result.current.pendingAdd?.verdict.kind).toBe("duplicate");
    expect(result.current.pendingAdd?.verdict.message).toContain("already have 3");

    act(() => result.current.confirmPendingAdd());
    expect(result.current.items[0].quantity).toBe(6);
    expect(result.current.pendingAdd).toBeNull();
  });

  it("cancel drops the add entirely", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItemGuarded(product(), 2));
    act(() => result.current.addItemGuarded(product(), 5));
    act(() => result.current.cancelPendingAdd());
    expect(result.current.items[0].quantity).toBe(2);
    expect(result.current.pendingAdd).toBeNull();
  });

  it("big line parks even with an empty cart (dollar tripwire)", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    // 30 x $19.99 = $599.70 ≥ $500 AND 30 ≥ 24 units
    act(() => result.current.addItemGuarded(product(), 30));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.pendingAdd?.verdict.kind).toBe("big_line");
    act(() => result.current.confirmPendingAdd());
    expect(result.current.items[0].quantity).toBe(30);
  });

  it("different size = different line = no duplicate prompt", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItemGuarded(product(), 3));
    act(() =>
      result.current.addItemGuarded(
        product({ id: "p2", code: "5678", bottle_size_ml: 1750 }),
        3,
      ),
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.pendingAdd).toBeNull();
  });

  it("raw addItem stays unguarded (bulk/restore surfaces)", () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.addItem(product(), 3));
    act(() => result.current.addItem(product(), 3));
    expect(result.current.items[0].quantity).toBe(6);
    expect(result.current.pendingAdd).toBeNull();
  });
});
