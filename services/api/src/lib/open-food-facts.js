/**
 * Open Food Facts UPC lookup (public API, no key).
 * Normalizes into the same product shape as {@link lookupUpcFromUpcitemdb} for scoring.
 */

/** Reject obvious non-spirits; many spirit rows have sparse OFF categories — keep lenient. */
const NON_SPIRIT_BLOCKLIST =
  /\b(baby|infant|diaper|pet food|dog food|cat food|litter|detergent|shampoo|vitamin gummy)\b/i;

const SPIRIT_HINT =
  /\b(whisk|whiskey|whisky|bourbon|vodka|rum|gin|tequila|mezcal|brandy|cognac|liqueur|spirit|wine|beer|alcohol|liquor|scotch|prosecco|champagne|sake|soju|cordial|aperitif|bitters|amaro|schnapps)\b/i;

/**
 * @param {string} s
 * @returns {string}
 */
function safeStr(s) {
  return String(s ?? "").trim();
}

/**
 * @param {string} upc
 * @returns {Promise<
 *   | {
 *       ok: true;
 *       product: {
 *         name: string;
 *         brand: string;
 *         category: string;
 *         rawSize: string;
 *         offersText: string;
 *         images: unknown;
 *         imageUrl: string | null;
 *       };
 *       raw: object;
 *     }
 *   | { ok: false; error: "not_found" | "not_beverage" | "network_error" }
 * >}
 */
export async function lookupUpcFromOpenFoodFacts(upc) {
  const code = safeStr(upc);
  if (!code) {
    return { ok: false, error: "not_found" };
  }

  let offJson;
  try {
    const ctrl = AbortSignal.timeout(8000);
    const offRes = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
      { signal: ctrl },
    );
    offJson = await offRes.json();
  } catch {
    return { ok: false, error: "network_error" };
  }

  if (offJson?.status !== 1 || !offJson.product) {
    return { ok: false, error: "not_found" };
  }

  const p = offJson.product;
  const categories = safeStr(p.categories);
  const tags = Array.isArray(p.categories_tags) ? p.categories_tags.join(" ") : "";
  const productName = safeStr(p.product_name);
  const genericName = safeStr(p.generic_name);
  const brands = safeStr(p.brands);
  const quantity = safeStr(p.quantity);

  const blob = `${categories} ${tags} ${productName} ${genericName} ${brands}`.toLowerCase();
  if (NON_SPIRIT_BLOCKLIST.test(blob)) {
    return { ok: false, error: "not_beverage" };
  }
  const nameBlob = `${productName} ${genericName} ${brands}`;
  if (
    !SPIRIT_HINT.test(blob) &&
    !SPIRIT_HINT.test(productName) &&
    !SPIRIT_HINT.test(genericName) &&
    !SPIRIT_HINT.test(nameBlob)
  ) {
    return { ok: false, error: "not_beverage" };
  }

  const nameGuess =
    productName ||
    genericName ||
    (brands ? `${brands} product`.trim() : "") ||
    (categories
      ? (categories.split(",").map((x) => x.trim()).filter(Boolean)[0] ?? "")
      : "") ||
    "";
  if (!nameGuess) {
    return { ok: false, error: "not_found" };
  }

  const categoryHints = [categories, tags].filter(Boolean).join(" ").slice(0, 500);
  const name = `${brands} ${nameGuess}`.trim() || nameGuess;
  const imageUrl =
    typeof p.image_front_url === "string" && p.image_front_url.trim()
      ? p.image_front_url.trim()
      : typeof p.image_url === "string" && p.image_url.trim()
        ? p.image_url.trim()
        : null;

  return {
    ok: true,
    product: {
      name,
      brand: brands,
      category: categoryHints,
      rawSize: quantity,
      offersText: quantity,
      images: p.images ?? [],
      imageUrl,
    },
    raw: offJson,
  };
}
