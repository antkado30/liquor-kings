/**
 * Price-memory chip pins (2026-08-01). The chip must only ever show a
 * real, recent, ≥1¢ move — these pins hold each gate shut.
 */
import { describe, expect, it } from "vitest";
import { priceChangeFor, PRICE_CHANGE_WINDOW_DAYS } from "./price-change";

const NOW = Date.parse("2026-08-01T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

const product = (over: Record<string, unknown> = {}) => ({
  licensee_price: 12.99,
  previous_licensee_price: 11.49,
  price_changed_at: daysAgo(2),
  ...over,
}) as {
  licensee_price: number | null;
  previous_licensee_price?: number | null;
  price_changed_at?: string | null;
};

describe("priceChangeFor", () => {
  it("shows a recent increase with the real former price", () => {
    const c = priceChangeFor(product(), NOW);
    expect(c).toEqual({ direction: "up", was: 11.49, now: 12.99, deltaCents: 150 });
  });

  it("shows a recent decrease", () => {
    const c = priceChangeFor(product({ licensee_price: 10.99 }), NOW);
    expect(c?.direction).toBe("down");
    expect(c?.deltaCents).toBe(-50);
  });

  it("no history → no chip (covers every brand-new item)", () => {
    expect(priceChangeFor(product({ previous_licensee_price: null }), NOW)).toBe(null);
    expect(priceChangeFor(product({ previous_licensee_price: undefined }), NOW)).toBe(null);
  });

  it("no current price → no chip", () => {
    expect(priceChangeFor(product({ licensee_price: null }), NOW)).toBe(null);
  });

  it("sub-cent float noise is not a move", () => {
    expect(
      priceChangeFor(
        product({ licensee_price: 12.99, previous_licensee_price: 12.990000000000002 }),
        NOW,
      ),
    ).toBe(null);
  });

  it("a one-cent move IS a move", () => {
    const c = priceChangeFor(product({ previous_licensee_price: 12.98 }), NOW);
    expect(c?.deltaCents).toBe(1);
  });

  it("fades after the recency window", () => {
    expect(
      priceChangeFor(product({ price_changed_at: daysAgo(PRICE_CHANGE_WINDOW_DAYS + 1) }), NOW),
    ).toBe(null);
    // …but still shows the day before it expires.
    expect(
      priceChangeFor(product({ price_changed_at: daysAgo(PRICE_CHANGE_WINDOW_DAYS - 1) }), NOW),
    ).not.toBe(null);
  });

  it("missing or garbage price_changed_at hides the chip (never a stale-forever chip)", () => {
    expect(priceChangeFor(product({ price_changed_at: null }), NOW)).toBe(null);
    expect(priceChangeFor(product({ price_changed_at: "" }), NOW)).toBe(null);
    expect(priceChangeFor(product({ price_changed_at: "not-a-date" }), NOW)).toBe(null);
  });

  it("tolerates device clock skew (timestamp slightly in the future still shows)", () => {
    expect(priceChangeFor(product({ price_changed_at: daysAgo(-0.02) }), NOW)).not.toBe(null);
  });
});
