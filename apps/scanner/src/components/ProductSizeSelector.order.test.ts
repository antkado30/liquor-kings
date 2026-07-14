import { describe, expect, it } from "vitest";
import { orderSizesForDisplay, pickInitialSizeByCode } from "./ProductSizeSelector";
import type { MlccProduct } from "../types";

/*
  Tony's chip order, pinned with the real Tito's family that decided it
  (2026-07-14 device walkthrough): singles small → large with the biggest
  at the far right, then ALL packs together at the tail. "We had it on
  the right track then the packs came out of nowhere."
*/

function p(code: string, ml: number | null, packCount: number | null, container = "glass"): MlccProduct {
  return {
    id: code,
    code,
    name: "TITO'S HANDMADE VODKA",
    brand_family: null,
    category: "VODKA",
    ada_number: "321",
    ada_name: "NWS Michigan",
    proof: 80,
    bottle_size_label: ml != null ? `${ml} ML` : null,
    bottle_size_ml: ml,
    case_size: null,
    licensee_price: null,
    min_shelf_price: null,
    base_price: null,
    container,
    pack_count: packCount,
    is_new_item: false,
    imageUrl: null,
  } as unknown as MlccProduct;
}

// The real Tito's lineup, deliberately scrambled like the server sends it
// (packs interleaved among singles by bottle size).
const tito = [
  p("17426", 50, null, "plastic"), // 50 plastic single
  p("7127", 50, null), // 50 glass single
  p("30837", 50, 4), // 50 glass 4-pack
  p("21328", 50, 12), // 50 glass 12-pack
  p("36584", 100, null), // 100 single
  p("36585", 100, 4), // 100 4-pack
  p("7128", 200, null), // 200 single
  p("7156", 375, null), // 375 single
  p("2980", 750, null), // 750 single
  p("2981", 1000, null), // 1000 single
  p("2982", 1750, null), // 1750 single
];

describe("orderSizesForDisplay", () => {
  it("singles small→large first, then ALL packs at the tail (Tito's pin)", () => {
    const codes = orderSizesForDisplay(tito).map((x) => x.code);
    expect(codes).toEqual([
      "7127", // 50 glass
      "17426", // 50 plastic (same size: glass before plastic)
      "36584", // 100
      "7128", // 200
      "7156", // 375
      "2980", // 750
      "2981", // 1000
      "2982", // 1750 — biggest single, far right of the singles
      "30837", // 50 · 4-pack — packs begin
      "21328", // 50 · 12-pack (same size: smaller pack first)
      "36585", // 100 · 4-pack
    ]);
  });

  it("GIFT PACK combos ride with the packs at the tail", () => {
    const combo = { ...p("55555", 750, null), bottle_size_label: "750 ML · GIFT PACK" };
    const codes = orderSizesForDisplay([combo, p("2980", 750, null)]).map((x) => x.code);
    expect(codes).toEqual(["2980", "55555"]);
  });

  it("is pure — does not mutate the input array", () => {
    const input = [...tito];
    orderSizesForDisplay(input);
    expect(input.map((x) => x.code)).toEqual(tito.map((x) => x.code));
  });

  it("null sizes sink to the end of their group, never crash", () => {
    const weird = [p("B", null, null), p("A", 50, null)];
    expect(orderSizesForDisplay(weird).map((x) => x.code)).toEqual(["A", "B"]);
  });
});

describe("pickInitialSizeByCode", () => {
  it("scanned code always wins, even a pack", () => {
    expect(pickInitialSizeByCode(tito, "21328").code).toBe("21328");
  });
  it("no code → smallest SINGLE, never a pack", () => {
    expect(pickInitialSizeByCode(tito).code).toBe("7127");
  });
});
