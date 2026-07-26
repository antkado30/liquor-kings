/**
 * MoreFromBrand pins (2026-07-26):
 *   1. Brand mode shows "More from {BRAND}" with one row per family.
 *   2. Similar mode (thin brand fallback) shows "More like this".
 *   3. No data / empty data → the section renders NOTHING (fail-soft —
 *      suggestions may never break the card that's already open).
 *   4. Tapping a row loads that family and hands it to the parent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MoreFromBrand } from "./MoreFromBrand";
import type { RelatedProducts } from "../api/catalog";

const { getRelatedMock, getFamilyMock } = vi.hoisted(() => ({
  getRelatedMock: vi.fn(),
  getFamilyMock: vi.fn(),
}));

vi.mock("../api/catalog", () => ({
  getRelatedProducts: getRelatedMock,
  getProductFamily: getFamilyMock,
}));

const product = (code: string, name: string) =>
  ({
    id: `id-${code}`,
    code,
    name,
    brand_family: "SMIRNOFF",
    category: "VODKA",
    ada_number: "141",
    ada_name: "GWL",
    proof: 80,
    bottle_size_label: "750 ML",
    bottle_size_ml: 750,
    case_size: 12,
    licensee_price: 12.35,
    min_shelf_price: 15,
    base_price: 12,
    container: "GL",
    pack_count: null,
    is_new_item: false,
    imageUrl: null,
    last_price_book_date: null,
    is_active: true,
  }) as never;

const related = (mode: "brand" | "similar"): RelatedProducts => ({
  mode,
  brand: mode === "brand" ? "SMIRNOFF" : null,
  items: [
    { product: product("100", "SMIRNOFF RASPBERRY"), sizes_count: 3, from_price: 9.99 },
    { product: product("200", "SMIRNOFF GREEN APPLE"), sizes_count: 1, from_price: 12.35 },
  ],
});

beforeEach(() => {
  getRelatedMock.mockReset();
  getFamilyMock.mockReset();
});

describe("MoreFromBrand", () => {
  it("brand mode: 'More from BRAND' header + one row per family", async () => {
    getRelatedMock.mockResolvedValue(related("brand"));
    render(<MoreFromBrand anchorCode="1" />);
    expect(await screen.findByText("More from SMIRNOFF")).toBeTruthy();
    expect(screen.getByText("SMIRNOFF RASPBERRY")).toBeTruthy();
    expect(screen.getByText("3 sizes · from $9.99")).toBeTruthy();
    expect(screen.getByText("1 size · from $12.35")).toBeTruthy();
  });

  it("similar mode (thin brand): 'More like this' header", async () => {
    getRelatedMock.mockResolvedValue(related("similar"));
    render(<MoreFromBrand anchorCode="1" />);
    expect(await screen.findByText("More like this")).toBeTruthy();
  });

  it("fail-soft: null or empty data renders NOTHING", async () => {
    getRelatedMock.mockResolvedValue(null);
    const { container, rerender, unmount } = render(<MoreFromBrand anchorCode="1" />);
    await waitFor(() => expect(container.querySelector(".morefrom")).toBeNull());
    unmount();

    getRelatedMock.mockResolvedValue({ mode: "brand", brand: "X", items: [] });
    const second = render(<MoreFromBrand anchorCode="2" />);
    await waitFor(() =>
      expect(second.container.querySelector(".morefrom")).toBeNull(),
    );
    void rerender;
  });

  it("tap: loads the tapped family and hands it to the parent", async () => {
    getRelatedMock.mockResolvedValue(related("brand"));
    const fam = { baseName: "SMIRNOFF RASPBERRY", sizes: [product("100", "SMIRNOFF RASPBERRY")] };
    getFamilyMock.mockResolvedValue(fam);
    const onOpen = vi.fn();

    render(<MoreFromBrand anchorCode="1" onOpenProduct={onOpen} />);
    fireEvent.click(await screen.findByText("SMIRNOFF RASPBERRY"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(fam, "100"));
    expect(getFamilyMock).toHaveBeenCalledWith("100");
  });
});
