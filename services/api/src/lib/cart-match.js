/**
 * cart-match — pure logic deciding whether a MILO cart already EXACTLY matches
 * a requested order, and nothing else.
 *
 * This is the correctness core for the upcoming "skip re-add when unchanged"
 * RPA optimization. A false "match" would skip re-adding items and validate a
 * STALE cart — unacceptable. A false "no-match" only costs a harmless re-add.
 * So the bias is ALWAYS toward false: any ambiguity or malformed input returns
 * { match: false } with a descriptive reason. Never guess.
 *
 * Pure: no imports of Playwright / db / DOM / anything. Plain array logic.
 */

/**
 * @typedef {Object} CartLine
 * @property {string | number} code
 * @property {number} quantity
 */

/**
 * @typedef {Object} CartMatchResult
 * @property {boolean} match   - true ONLY on an exact, unambiguous 1:1 match.
 * @property {string} reason   - machine-readable reason code (see rules).
 */

/**
 * A finite, positive integer quantity. Rejects NaN, Infinity, negatives,
 * zero, and non-integers (e.g. 2.5). Booleans count as non-numbers.
 *
 * @param {unknown} q
 * @returns {boolean}
 */
function isValidQuantity(q) {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (!Number.isInteger(q)) return false;
  return q > 0;
}

/**
 * Decide whether `requestedItems` and `cartItems` describe the identical cart:
 * the same set of product codes, identical quantity per code, and nothing extra
 * on either side. Order does not matter.
 *
 * Rules (return { match: false, reason } unless ALL hold):
 *  1. Each code is normalized via String(code).trim(); a blank normalized code
 *     anywhere → "malformed_code".
 *  2. Every quantity is a finite integer > 0; otherwise → "malformed_qty".
 *  3. Duplicate normalized codes within EITHER list → "duplicate_code".
 *  4. Empty requestedItems → "empty_request".
 *  5. Different number of distinct codes between the two → "count_mismatch".
 *  6. A requested code missing from the cart → "missing:<code>".
 *     An extra cart code not requested → "extra:<code>".
 *  7. A code present on both but with different quantity → "qty_mismatch:<code>".
 *  8. Codes match 1:1 AND every quantity is equal → { match: true, reason: "exact_match" }.
 *
 * @param {CartLine[] | null | undefined} requestedItems
 * @param {CartLine[] | null | undefined} cartItems
 * @returns {CartMatchResult}
 */
export function cartExactlyMatchesRequest(requestedItems, cartItems) {
  const request = Array.isArray(requestedItems) ? requestedItems : [];
  const cart = Array.isArray(cartItems) ? cartItems : [];

  // Rule 4: never skip work on an empty request. (Covers "both empty" too.)
  if (request.length === 0) {
    return { match: false, reason: "empty_request" };
  }

  // Rules 1–3: build a normalized map per list. Any malformed code/qty or
  // duplicate stops us immediately — never guess.
  /** @param {CartLine[]} list @returns {{ok:true,map:Map<string,number>}|{ok:false,reason:string}} */
  const buildMap = (list) => {
    const map = new Map();
    for (const item of list) {
      if (!item || typeof item !== "object") {
        return { ok: false, reason: "malformed_code" };
      }
      // Rule 1: normalize + reject blank codes.
      const code = String(item.code ?? "").trim();
      if (code === "") {
        return { ok: false, reason: "malformed_code" };
      }
      // Rule 2: finite integer > 0.
      if (!isValidQuantity(item.quantity)) {
        return { ok: false, reason: "malformed_qty" };
      }
      // Rule 3: duplicate code within this list → ambiguous.
      if (map.has(code)) {
        return { ok: false, reason: "duplicate_code" };
      }
      map.set(code, item.quantity);
    }
    return { ok: true, map };
  };

  const reqBuilt = buildMap(request);
  if (!reqBuilt.ok) return { match: false, reason: reqBuilt.reason };
  const cartBuilt = buildMap(cart);
  if (!cartBuilt.ok) return { match: false, reason: cartBuilt.reason };

  const reqMap = reqBuilt.map;
  const cartMap = cartBuilt.map;

  // Rule 5: distinct-code count must match.
  if (reqMap.size !== cartMap.size) {
    return { match: false, reason: "count_mismatch" };
  }

  // Rules 6 & 7: walk the request. A missing cart code → "missing:<code>";
  // a present-but-different quantity → "qty_mismatch:<code>".
  for (const [code, qty] of reqMap) {
    const cartQty = cartMap.get(code);
    if (cartQty === undefined) {
      return { match: false, reason: `missing:${code}` };
    }
    if (cartQty !== qty) {
      return { match: false, reason: `qty_mismatch:${code}` };
    }
  }

  // Rule 6 (extra side): sizes are equal and every requested code is present
  // with equal qty, so there cannot be an extra cart code — but check
  // explicitly to stay conservative and self-documenting. (With equal sizes
  // and a full request→cart match, this loop never fires; it is a guard.)
  for (const code of cartMap.keys()) {
    if (!reqMap.has(code)) {
      return { match: false, reason: `extra:${code}` };
    }
  }

  // Rule 8: exact 1:1 match.
  return { match: true, reason: "exact_match" };
}
