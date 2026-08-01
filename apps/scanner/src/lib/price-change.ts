/**
 * Price memory — the "was $X" decision (2026-08-01).
 *
 * The ingestor remembers what a bottle cost before the current book
 * (`previous_licensee_price`, see the API-side nextPreviousLicenseePrice)
 * and stamps `price_changed_at` when any price column moves. This module
 * is the ONLY place that turns those two columns into a visible chip, so
 * the rules live here once:
 *
 *   1. Both prices must exist — no history, no chip. New items never
 *      chip (their previous is null by construction).
 *   2. The move must be a real cent: amounts are compared in integer
 *      cents, so float noise (12.99 vs 12.9900000001) can never chip.
 *   3. The change must be RECENT (within PRICE_CHANGE_WINDOW_DAYS of
 *      price_changed_at). Book prices move roughly monthly; two weeks
 *      is long enough for every reorder cycle to see it and short
 *      enough that the store isn't stared at by ancient news. A
 *      missing/unparseable timestamp HIDES the chip — better no chip
 *      than a permanently stale one.
 *
 * Known accepted edge (documented on the ingestor side too): a book
 * that moves only base/min-shelf re-stamps price_changed_at, which can
 * resurface a carried licensee memory for one window. The number shown
 * is still a real former shelf price.
 *
 * Pure module — no React, no fetch — so vitest pins it dead simple.
 */

export const PRICE_CHANGE_WINDOW_DAYS = 14;

export interface PriceChange {
  direction: "up" | "down";
  /** The former licensee price (what the chip prints after "was"). */
  was: number;
  /** The current licensee price (already on screen next to the chip). */
  now: number;
  /** Signed move in integer cents (now − was): +150 = up $1.50. */
  deltaCents: number;
}

function cents(n: number): number {
  return Math.round(n * 100);
}

function isMoney(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Decide the chip for one product. `nowMs` is injectable for tests;
 * callers in the app omit it.
 */
export function priceChangeFor(
  product: {
    licensee_price: number | null;
    previous_licensee_price?: number | null;
    price_changed_at?: string | null;
  },
  nowMs: number = Date.now(),
): PriceChange | null {
  const now = product.licensee_price;
  const was = product.previous_licensee_price;
  if (!isMoney(now) || !isMoney(was)) return null;

  const deltaCents = cents(now) - cents(was);
  if (deltaCents === 0) return null;

  const changedAt = product.price_changed_at;
  if (typeof changedAt !== "string" || changedAt.trim() === "") return null;
  const changedMs = Date.parse(changedAt);
  if (Number.isNaN(changedMs)) return null;

  // Negative elapsed (device clock behind the server) still shows —
  // hiding a fresh change over clock skew is the worse failure.
  const elapsedMs = nowMs - changedMs;
  if (elapsedMs > PRICE_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;

  return {
    direction: deltaCents > 0 ? "up" : "down",
    was,
    now,
    deltaCents,
  };
}
