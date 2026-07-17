/**
 * oos-display — human names for out-of-stock lines (TONY-WANTS 7/16 #1).
 *
 * Order Day 2026-07-16, live from the store: the check-result sheet showed
 * "32181 × 3 — marked out-of-stock by MILO" and Tony asked the only
 * question that matters: "how am I supposed to know what that is?"
 *
 * MILO's OOS section often reports bare liquor codes (no product name).
 * But every OOS line IS a cart line — the cart already knows its name and
 * size. This helper joins the two so no surface ever renders a naked code.
 * The code stays visible as a suffix (operators phone distributors with
 * codes), it just never stands alone.
 */

type OosLike = {
  code?: string | null;
  productName?: string | null;
};

type CartLineLike = {
  product: {
    code: string;
    name: string;
    bottle_size_label?: string | null;
  };
};

/**
 * "OLD CROW · 1750 ML · #9528" — name from the cart (authoritative),
 * falling back to MILO's productName, falling back to the bare code
 * only when we truly know nothing else.
 */
export function oosDisplayLabel(item: OosLike, cartItems: readonly CartLineLike[]): string {
  const code = item.code != null && String(item.code).trim() !== "" ? String(item.code).trim() : null;
  const fromCart = code
    ? cartItems.find((line) => line.product.code === code)
    : undefined;

  if (fromCart) {
    const size = fromCart.product.bottle_size_label?.trim();
    return [fromCart.product.name, size, code ? `#${code}` : null]
      .filter((p): p is string => !!p && p !== "")
      .join(" · ");
  }

  const milo = item.productName != null && String(item.productName).trim() !== ""
    ? String(item.productName).trim()
    : null;
  if (milo) return code ? `${milo} · #${code}` : milo;
  return code ? `#${code}` : "Unknown item";
}
