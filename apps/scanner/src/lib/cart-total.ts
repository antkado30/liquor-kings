/**
 * cart-total — which number the cart shows (TONY-WANTS 7/16 #3).
 *
 * Order Day 2026-07-16: "after I validated the price didn't change to what it
 * would actually be." The cart footer kept showing the client-side sum
 * (Σ licensee_price × qty) even after a green MLCC check returned the real
 * net (tonight: $5,338.26 MLCC vs $5,338.33 client — a 7-cent gap, and it can
 * be larger with discounts). Once MILO has priced THIS cart, MILO's net is the
 * truth; show it.
 *
 * Honesty rules baked in:
 *   - MLCC net shows ONLY when the checked cart still matches what's on screen
 *     (cartMatchesGreenCheck). Any edit re-locks to the client estimate — we
 *     NEVER show a stale MLCC price for a cart MILO hasn't seen.
 *   - No fresh check, or a non-finite net → fall back to the client sum,
 *     labeled as an estimate so the operator knows it isn't MLCC-blessed.
 */

export type DisplayedTotal = {
  value: number;
  /** Short label for the total row ("MLCC net" vs "Est. total"). */
  label: string;
  /** True when `value` is MILO's authoritative net (not the client estimate). */
  isMlccNet: boolean;
};

export function resolveDisplayedTotal(input: {
  clientTotal: number;
  /** order_summary.netTotal from a succeeded validate, or null. */
  miloNetTotal: number | null | undefined;
  /** hashCart(currentCart) === lastGreenCheck.cartHash (cart MILO priced is on screen). */
  cartMatchesGreenCheck: boolean;
}): DisplayedTotal {
  const { clientTotal, miloNetTotal, cartMatchesGreenCheck } = input;
  const netOk =
    cartMatchesGreenCheck &&
    typeof miloNetTotal === "number" &&
    Number.isFinite(miloNetTotal) &&
    miloNetTotal >= 0;

  if (netOk) {
    return { value: miloNetTotal as number, label: "MLCC net", isMlccNet: true };
  }
  return { value: clientTotal, label: "Est. total", isMlccNet: false };
}
