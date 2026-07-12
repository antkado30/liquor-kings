import { describe, expect, it } from "vitest";
import { containerDisplay, nonGlassContainerSuffix, packCountSuffix } from "./container-label";

/*
  The label chain is order-path language: chip → cart line → confirm
  modal. A wrong suffix here puts a wrong word in front of a real order,
  so every branch is pinned. packCountSuffix added 2026-07-12 after the
  Tito's audit (three identical "50 ML · Glass" chips = unlabeled packs).
*/

describe("containerDisplay", () => {
  it("capitalizes a known material", () => {
    expect(containerDisplay("plastic")).toBe("Plastic");
    expect(containerDisplay("glass")).toBe("Glass");
  });
  it("returns null for empty/unknown input — never guesses", () => {
    expect(containerDisplay(null)).toBeNull();
    expect(containerDisplay(undefined)).toBeNull();
    expect(containerDisplay("")).toBeNull();
    expect(containerDisplay("   ")).toBeNull();
  });
});

describe("nonGlassContainerSuffix", () => {
  it("labels non-glass, stays quiet for glass and unknown", () => {
    expect(nonGlassContainerSuffix("plastic")).toBe(" · Plastic");
    expect(nonGlassContainerSuffix("glass")).toBe("");
    expect(nonGlassContainerSuffix(null)).toBe("");
  });
});

describe("packCountSuffix", () => {
  it("labels real multi-packs", () => {
    expect(packCountSuffix(12)).toBe(" · 12-pack");
    expect(packCountSuffix(4)).toBe(" · 4-pack");
    expect(packCountSuffix(2)).toBe(" · 2-pack");
  });
  it("stays quiet for singles and missing data — a single is the default", () => {
    expect(packCountSuffix(1)).toBe("");
    expect(packCountSuffix(0)).toBe("");
    expect(packCountSuffix(null)).toBe("");
    expect(packCountSuffix(undefined)).toBe("");
  });
  it("fails closed on garbage — NaN/negative/non-finite never label", () => {
    expect(packCountSuffix(Number.NaN)).toBe("");
    expect(packCountSuffix(-3)).toBe("");
    expect(packCountSuffix(Number.POSITIVE_INFINITY)).toBe("");
  });
});
