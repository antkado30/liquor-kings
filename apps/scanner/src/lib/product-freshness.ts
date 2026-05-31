/**
 * Product freshness / discontinuation heuristic (task #44, 2026-05-30).
 *
 * MLCC doesn't publish a "this SKU is discontinued" flag. We have to
 * infer it from price-book history: products that show up in every
 * weekly book are fresh; products that haven't appeared in 30+ days
 * are almost certainly gone.
 *
 * Inputs we have to work with:
 *   - `last_price_book_date`: the most recent price book that contained
 *     this product (set by the ingestor, see mlcc-price-book-ingestor.js)
 *   - `latestPriceBookDate`: the most recent price book WE'VE ingested
 *     (returned by /price-book/status)
 *   - `is_active`: server-side flag (defaults true; reserved for future
 *     explicit deactivation — today nothing flips it)
 *
 * Returns one of three statuses with a user-facing message. UI uses
 * `status` to pick a visual treatment (info / warn / error) and shows
 * `message` to the user.
 *
 * Thresholds (subject to revision as we get more data):
 *   - 0-13 days behind latest: "fresh" (no banner)
 *   - 14-29 days behind latest: "aging" (yellow info — "may be out of
 *     stock or limited availability")
 *   - 30+ days behind latest: "likely discontinued" (red warn — "this
 *     bottle hasn't appeared in MLCC's last ~4 weeks of price books")
 *
 * If `is_active === false`, we override to "discontinued" regardless
 * of date — that's an explicit server signal.
 */

export type ProductFreshness = {
  status: "fresh" | "aging" | "likely_discontinued";
  /** Days between product.last_price_book_date and the latest book.
   *  Null when we can't compute (missing date on one side). */
  daysBehindLatest: number | null;
  /** Short message safe to render to the user. Null when status is "fresh". */
  message: string | null;
};

/**
 * Parse YYYY-MM-DD to a Date at UTC midnight. Returns null on invalid
 * input.
 */
function parseIsoDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute freshness for a product given the latest price-book date we
 * know about. Pure function — no fetches.
 *
 * @param product - Must have `last_price_book_date`; `is_active` is
 *   honored if present.
 * @param latestPriceBookDate - The latest book date in our DB (ISO
 *   YYYY-MM-DD), from /price-book/status. Null means we don't know
 *   the latest date yet, in which case we return "fresh" — we can't
 *   accuse a product of being old when we don't know what "old" means.
 */
export function computeProductFreshness(
  product: {
    last_price_book_date?: string | null;
    is_active?: boolean;
  },
  latestPriceBookDate: string | null | undefined,
): ProductFreshness {
  // Explicit server signal — beats every heuristic.
  if (product.is_active === false) {
    return {
      status: "likely_discontinued",
      daysBehindLatest: null,
      message:
        "MLCC marked this product inactive. It cannot be ordered until reactivated.",
    };
  }

  const productDate = parseIsoDate(product.last_price_book_date);
  const latestDate = parseIsoDate(latestPriceBookDate);

  // Missing data on either side → can't compute. Trust the catalog
  // (don't false-positive a perfectly good bottle).
  if (!productDate || !latestDate) {
    return { status: "fresh", daysBehindLatest: null, message: null };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(
    0,
    Math.round((latestDate.getTime() - productDate.getTime()) / msPerDay),
  );

  if (days >= 30) {
    return {
      status: "likely_discontinued",
      daysBehindLatest: days,
      message: `This bottle hasn't appeared in an MLCC price book for ${days} days — it's likely discontinued or temporarily out of catalog. Verify with your distributor before ordering.`,
    };
  }
  if (days >= 14) {
    return {
      status: "aging",
      daysBehindLatest: days,
      message: `Last seen in an MLCC price book ${days} days ago. May be limited availability — verify before placing a large order.`,
    };
  }
  return { status: "fresh", daysBehindLatest: days, message: null };
}
