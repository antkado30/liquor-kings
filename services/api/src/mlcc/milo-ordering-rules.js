/**
 * MLCC (Michigan Liquor Control Commission) OLO ordering rules.
 * Source: https://www.michigan.gov/lara (official MLCC user manuals, April 2026)
 * See docs/milo-reference/README.md for the full source PDFs.
 */

/**
 * Split case rules by bottle size.
 * Each entry lists the allowed multiples for an order of that size.
 * Numbers represent number of bottles that constitute a valid order quantity.
 *
 * Example: 750ml allows [1, 3, 6], meaning valid order quantities are
 * 1, 3, 6, or any multiple thereof (since each is a valid split case size
 * up to a full case of 12).
 *
 * 100ml, 50ml, and 70000-series products allow NO splits — must be ordered
 * as full case (empty array = full case only, derived from pack size).
 */
export const SPLIT_CASE_RULES_BY_SIZE_ML = Object.freeze({
  1750: [1, 3],
  1000: [1, 3, 6],
  750: [1, 3, 6],
  375: [3, 6, 12],
  200: [12, 24],
  100: [], // full case only
  50: [], // full case only
});

/**
 * Code-based rule overrides. 70000-series products have no splits allowed
 * regardless of size.
 * @param {string|number} code - MLCC product code
 * @returns {boolean} true if code is in 70000 series
 */
export function is70000Series(code) {
  const n = Number(String(code ?? "").trim());
  return Number.isFinite(n) && n >= 70000 && n < 80000;
}

/**
 * Minimum order size per ADA (distributor), in liters.
 * Every ADA on a single order must meet this minimum independently.
 * If Cart has items from NWS Michigan totaling 8L and General Wine & Liquor
 * totaling 15L, the NWS portion is invalid; General Wine is fine.
 */
export const ADA_MINIMUM_ORDER_LITERS = 9;

/**
 * Known ADAs (Authorized Distribution Agents) in Michigan.
 * Used for cart grouping display and validation messages.
 */
export const KNOWN_ADAS = Object.freeze({
  "321": "NWS Michigan",
  "221": "General Wine & Liquor",
});

/**
 * Validate a quantity against split case rules for a given size.
 * Returns { valid: boolean, reason?: string, suggestedAlternatives?: number[] }.
 *
 * @param {number} quantity - Quantity requested
 * @param {number} sizeML - Bottle size in ml
 * @param {string|number} code - MLCC product code (for 70000-series check)
 * @returns {{valid: boolean, reason?: string, suggestedAlternatives?: number[]}}
 */
export function validateQuantityForSize(quantity, sizeML, code) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
    return { valid: false, reason: "Quantity must be a positive integer" };
  }

  // 70000-series: full case only
  if (is70000Series(code)) {
    return {
      valid: false,
      reason: "70000-series products require full-case orders (limited availability)",
    };
  }

  const allowedMultiples = SPLIT_CASE_RULES_BY_SIZE_ML[sizeML];
  if (!allowedMultiples) {
    // Unknown size — don't block, but warn
    return {
      valid: true,
      reason: `Size ${sizeML}ml is not in MLCC split case table; unable to verify rule compliance`,
    };
  }

  // Empty array means no splits — full case only (quantity must equal case size)
  if (allowedMultiples.length === 0) {
    return {
      valid: false,
      reason: `Size ${sizeML}ml does not allow split cases; must order full case`,
    };
  }

  // Valid if quantity is one of the allowed multiples OR a multiple of the LARGEST
  // allowed (indicating a full case or multiple full cases)
  const largest = Math.max(...allowedMultiples);
  if (allowedMultiples.includes(q)) return { valid: true };
  if (q % largest === 0) return { valid: true };

  // Suggest the nearest allowed quantities above and below
  const suggestions = [];
  const below = allowedMultiples.filter((n) => n < q).sort((a, b) => b - a)[0];
  if (below != null) suggestions.push(below);
  const above = allowedMultiples.find((n) => n > q);
  if (above != null) suggestions.push(above);
  // Also suggest nearest full-case multiples
  const fullCaseMultipleBelow = Math.floor(q / largest) * largest;
  const fullCaseMultipleAbove = Math.ceil(q / largest) * largest;
  if (fullCaseMultipleBelow >= largest && !suggestions.includes(fullCaseMultipleBelow)) {
    suggestions.push(fullCaseMultipleBelow);
  }
  if (!suggestions.includes(fullCaseMultipleAbove)) {
    suggestions.push(fullCaseMultipleAbove);
  }

  return {
    valid: false,
    reason: `Quantity ${q} is not a valid split for ${sizeML}ml. Allowed splits: ${allowedMultiples.join(", ")}, or multiples of ${largest} (full case)`,
    suggestedAlternatives: suggestions.sort((a, b) => a - b),
  };
}

/**
 * Check that each ADA in the cart has at least 9 liters total.
 * @param {Array<{ada_number?: string, bottle_size_ml: number, quantity: number}>} cartItems
 * @returns {{ valid: boolean, adaBreakdown: Record<string, {liters: number, meetsMinimum: boolean}>, failingAdas: string[] }}
 */
export function validateAdaMinimums(cartItems) {
  const byAda = {};
  for (const item of cartItems) {
    const ada = String(item.ada_number ?? "unknown");
    const liters = ((Number(item.bottle_size_ml) || 0) * (Number(item.quantity) || 0)) / 1000;
    if (!byAda[ada]) byAda[ada] = { liters: 0, meetsMinimum: false };
    byAda[ada].liters += liters;
  }
  const failingAdas = [];
  for (const ada of Object.keys(byAda)) {
    byAda[ada].meetsMinimum = byAda[ada].liters >= ADA_MINIMUM_ORDER_LITERS;
    if (!byAda[ada].meetsMinimum) failingAdas.push(ada);
  }
  return { valid: failingAdas.length === 0, adaBreakdown: byAda, failingAdas };
}

/**
 * Validate a full cart (array of items) against all MILO rules.
 * @param {Array<{code: string|number, bottle_size_ml: number, quantity: number, ada_number?: string}>} cartItems
 * @returns {{ valid: boolean, errors: Array<{code: string|number, reason: string, suggestedAlternatives?: number[]}>, adaBreakdown: Record<string, {liters: number, meetsMinimum: boolean}> }}
 */
export function validateCart(cartItems) {
  const errors = [];
  for (const item of cartItems) {
    const result = validateQuantityForSize(item.quantity, item.bottle_size_ml, item.code);
    if (!result.valid) {
      errors.push({
        code: item.code,
        reason: result.reason,
        suggestedAlternatives: result.suggestedAlternatives,
      });
    }
  }
  const adaCheck = validateAdaMinimums(cartItems);
  if (!adaCheck.valid) {
    for (const ada of adaCheck.failingAdas) {
      const adaName = KNOWN_ADAS[ada] || `ADA ${ada}`;
      errors.push({
        code: `ADA_${ada}`,
        reason: `${adaName} order is ${adaCheck.adaBreakdown[ada].liters.toFixed(2)} liters; minimum is ${ADA_MINIMUM_ORDER_LITERS}L`,
      });
    }
  }
  return { valid: errors.length === 0, errors, adaBreakdown: adaCheck.adaBreakdown };
}
