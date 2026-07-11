/**
 * cart-lines-hash — canonical content identity for an execution run's
 * cart lines (run-dedupe, 2026-07-11).
 *
 * WHY THIS EXISTS: two triggers with identical lines for the same store
 * are the SAME check. On order day 7/9 the background pre-validate and
 * the foreground "Check Order" tap raced each other into duplicate
 * validate_only runs (4 runs in 66 seconds) — duplicate MILO work and
 * duplicate push banners. The existing one-active-per-cart guard cannot
 * see this: every trigger flips its cart active→submitted, so the next
 * sync creates a FRESH cart row and each duplicate rides its own
 * cart_id. Content is the identity, not the cart row.
 *
 * The hash is stamped into payload_snapshot.metadata.cart_lines_hash at
 * run creation and used by createExecutionRunFromCart to return an
 * identical in-flight validate_only run instead of creating a twin.
 *
 * DESIGN RULES (doctrine §18-20 — one truth, deterministic, invariants):
 * - Deterministic: same lines → same hash, regardless of item order.
 * - Fail toward "no dedupe": ANY malformed line (missing code, bad
 *   quantity) returns null. A null hash means the run is never deduped —
 *   an extra MILO check is waste; a wrongly-merged check is a lie.
 * - Versioned ("v1:" prefix): if the algorithm ever changes, old
 *   in-flight rows can never false-match new ones.
 *
 * Input shape = the REAL execution payload items built by
 * cart-execution-payload.service.js buildItemsAndSummary():
 *   { cartItemId, bottleId, mlcc_item_id, quantity,
 *     bottle: { id, name, mlcc_code, ... } }
 * The MLCC code lives at item.bottle.mlcc_code — NOT item.code. (Shape
 * verified against the builder on 2026-07-11; fixtures in the unit test
 * mirror it. Lesson from the 2026-07-08 run_type bug: fixtures copy prod
 * shapes, never invent them.)
 */

/**
 * Compute the canonical lines hash for a payload's items array.
 *
 * @param {Array<{ quantity: unknown, bottle?: { mlcc_code?: unknown } }>} items
 * @returns {string|null} "v1:<code>:<qty>|<code>:<qty>|..." (entries
 *   sorted lexicographically) or null when the input cannot be hashed
 *   safely (not an array, empty, or any line missing a code / carrying a
 *   non-positive-integer quantity).
 */
export function computeCartLinesHash(items) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const entries = [];
  for (const item of items) {
    const rawCode = item?.bottle?.mlcc_code;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    if (!code) return null;

    const qty = item?.quantity;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) {
      return null;
    }

    entries.push(`${code}:${qty}`);
  }

  entries.sort();
  return `v1:${entries.join("|")}`;
}
