import { describe, it, expect } from "vitest";
import { resolveDisplayedTotal } from "./cart-total";

/**
 * TONY-WANTS 7/16 #3 — show MILO's real net once the cart is priced, but
 * NEVER a stale MLCC price for an edited cart.
 */
describe("resolveDisplayedTotal", () => {
  it("shows MLCC net when the checked cart matches what's on screen", () => {
    const r = resolveDisplayedTotal({
      clientTotal: 5338.33,
      miloNetTotal: 5338.26,
      cartMatchesGreenCheck: true,
    });
    expect(r.isMlccNet).toBe(true);
    expect(r.value).toBe(5338.26);
    expect(r.label).toBe("MLCC net");
  });

  it("falls back to the client estimate when the cart was edited after the check", () => {
    const r = resolveDisplayedTotal({
      clientTotal: 5000,
      miloNetTotal: 5338.26, // stale — belongs to a different cart
      cartMatchesGreenCheck: false,
    });
    expect(r.isMlccNet).toBe(false);
    expect(r.value).toBe(5000);
    expect(r.label).toBe("Est. total");
  });

  it("falls back when there is no MILO net yet", () => {
    const r = resolveDisplayedTotal({
      clientTotal: 1200,
      miloNetTotal: null,
      cartMatchesGreenCheck: true,
    });
    expect(r.isMlccNet).toBe(false);
    expect(r.value).toBe(1200);
  });

  it("ignores a non-finite or negative net (fails safe to client sum)", () => {
    for (const bad of [NaN, Infinity, -1] as number[]) {
      const r = resolveDisplayedTotal({
        clientTotal: 800,
        miloNetTotal: bad,
        cartMatchesGreenCheck: true,
      });
      expect(r.isMlccNet).toBe(false);
      expect(r.value).toBe(800);
    }
  });

  it("shows a $0.00 MLCC net (valid) when MILO genuinely priced it to zero", () => {
    const r = resolveDisplayedTotal({
      clientTotal: 10,
      miloNetTotal: 0,
      cartMatchesGreenCheck: true,
    });
    expect(r.isMlccNet).toBe(true);
    expect(r.value).toBe(0);
  });
});
