import { describe, it, expect } from "vitest";

import {
  buildPlaywrightSelectorFromHint,
  isProbeUiTextUnsafe,
  shouldBlockHttpRequest,
} from "../src/workers/mlcc-browser-add-by-code-probe.js";

describe("shouldBlockHttpRequest", () => {
  it("blocks mutation methods to cart/order-like URLs", () => {
    const b = shouldBlockHttpRequest(
      "https://vendor.example/api/cart/add",
      "POST",
    );
    expect(b.block).toBe(true);
  });

  it("allows GET navigation to generic pages", () => {
    const b = shouldBlockHttpRequest("https://vendor.example/home", "GET");
    expect(b.block).toBe(false);
  });
});

describe("buildPlaywrightSelectorFromHint", () => {
  it("prefers id when valid", () => {
    expect(buildPlaywrightSelectorFromHint({ id: "skuInput", name: "x" })).toBe(
      "#skuInput",
    );
  });

  it("falls back to name when id missing", () => {
    expect(buildPlaywrightSelectorFromHint({ id: null, name: "mlcc_code" })).toBe(
      '[name="mlcc_code"]',
    );
  });

  it("returns null when not constructible", () => {
    expect(buildPlaywrightSelectorFromHint({})).toBe(null);
  });
});

describe("isProbeUiTextUnsafe", () => {
  it("flags checkout and add-to-cart labels", () => {
    expect(isProbeUiTextUnsafe("Add to cart").unsafe).toBe(true);
    expect(isProbeUiTextUnsafe("Checkout").unsafe).toBe(true);
    expect(isProbeUiTextUnsafe("Validate order").unsafe).toBe(true);
  });

  it("allows neutral labels", () => {
    expect(isProbeUiTextUnsafe("Add by code").unsafe).toBe(false);
    expect(isProbeUiTextUnsafe("Enter code").unsafe).toBe(false);
  });
});
