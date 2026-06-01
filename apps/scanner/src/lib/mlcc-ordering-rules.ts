/**
 * Client-side mirror of `services/api/src/mlcc/milo-ordering-rules.js`.
 *
 * Used by the scanner UI to show "here's how MLCC lets you order this
 * bottle" at scan time — BEFORE the user picks a quantity. Surfaces:
 *   - Allowed split-case quantities (e.g. 750ml: 1, 3, 6, or 12)
 *   - Full-case-only sizes (50ml/100ml: order in multiples of the
 *     product's case size)
 *   - 70000-series special case (limited availability, full case only)
 *
 * Why mirror server rules here instead of fetching them?
 *   - The rule tables are tiny (7 entries) and effectively static. The
 *     cost of a network round-trip per ProductCard open would dwarf the
 *     ~20 bytes of "duplicated" data.
 *   - Tony scans bottles at the shelf — the snappier the card opens
 *     the better the UX. Zero-latency rule rendering matters.
 *   - When the server-side rule table changes (rare), we bump the
 *     client copy too. Both files cite the same MLCC PDF source so
 *     drift is easy to spot.
 *
 * If/when the rules become more dynamic (per-ADA overrides, time-
 * windowed special cases), this file becomes a fetch from /mlcc/rules.
 * For now: static.
 */

/**
 * Allowed order quantities per bottle size, in ml.
 * Empty array = full case only (no splits).
 * Mirror of SPLIT_CASE_RULES_BY_SIZE_ML in milo-ordering-rules.js.
 */
const SPLIT_CASE_RULES: Record<number, number[]> = {
  1750: [1, 3],
  1000: [1, 3, 6],
  750: [1, 3, 6],
  375: [3, 6, 12],
  200: [12, 24],
  100: [],
  50: [],
};

/**
 * 70000-series products are "limited availability" — MLCC requires
 * them to be ordered as full cases regardless of bottle size. Code is
 * the canonical signal (not category, not flag).
 */
function is70000Series(code: string | null | undefined): boolean {
  const n = Number(String(code ?? "").trim());
  return Number.isFinite(n) && n >= 70000 && n < 80000;
}

export type OrderingRuleDisplay = {
  /**
   * One-line primary rule the user sees first. Always present.
   * Examples:
   *   "Order in 1, 3, 6, or 12 bottles per case"
   *   "Full case only — order in multiples of 60"
   *   "Limited item — full case only (12 per case)"
   */
  primary: string;
  /**
   * Secondary line shown smaller below the primary. Used for context
   * the user might want but isn't strictly necessary to act on.
   * Examples:
   *   "Case size: 12"
   *   "Distributor: NWS Michigan (9 L minimum per order)"
   */
  secondary: string | null;
  /**
   * True when the rule means "you can't pick any quantity you want" —
   * used to hint to callers (e.g. the quantity stepper might want to
   * snap to allowed values). We don't enforce that here; we just
   * surface enough metadata for callers to do it later (task #45).
   */
  isConstrained: boolean;
  /**
   * The allowed bottle counts for a split-case size (e.g. [1,3,6,12]).
   * Empty array = full case only. null = no rule known.
   */
  allowedSplits: number[] | null;
  /**
   * Full-case bottle count when known. Useful for "order in multiples
   * of N" messaging and for future quantity-stepper enforcement.
   */
  caseSize: number | null;
};

/**
 * Compute the display rule for a single product. Pure function — given
 * the same product, returns the same result every time. No side effects,
 * no fetches.
 *
 * @param product - The MLCC product the user is looking at. Must have
 *   at minimum a code; bottle_size_ml and case_size are optional but
 *   the rule gets less informative without them.
 */
export function getOrderingRuleDisplay(product: {
  code: string;
  bottle_size_ml?: number | null;
  case_size?: number | null;
  ada_name?: string | null;
}): OrderingRuleDisplay {
  const size = Number(product.bottle_size_ml ?? 0);
  const caseSize = Number(product.case_size ?? 0);

  // 70000-series — limited availability, full case only regardless of size.
  if (is70000Series(product.code)) {
    return {
      primary:
        caseSize > 0
          ? `Limited item — full case only (${caseSize} per case)`
          : "Limited item — full case only",
      secondary: product.ada_name
        ? `Distributor: ${product.ada_name}`
        : null,
      isConstrained: true,
      allowedSplits: [],
      caseSize: caseSize > 0 ? caseSize : null,
    };
  }

  const allowedSplits = SPLIT_CASE_RULES[size];

  // Unknown size — rare, but we don't want to lie about rules. Show
  // case size if we have it, otherwise admit we don't know.
  if (!allowedSplits) {
    return {
      primary:
        caseSize > 0
          ? `Case size: ${caseSize} — split rules not in MLCC table for ${size}ml`
          : "MLCC ordering rules not available for this size",
      secondary: product.ada_name
        ? `Distributor: ${product.ada_name}`
        : null,
      isConstrained: false,
      allowedSplits: null,
      caseSize: caseSize > 0 ? caseSize : null,
    };
  }

  // Full-case-only size (50ml / 100ml). Need a known case size to be
  // useful — otherwise we can't tell the user how to order.
  if (allowedSplits.length === 0) {
    if (caseSize > 0) {
      return {
        primary: `Full case only — order in multiples of ${caseSize}`,
        secondary: product.ada_name
          ? `Distributor: ${product.ada_name}`
          : null,
        isConstrained: true,
        allowedSplits: [],
        caseSize,
      };
    }
    return {
      primary: `Full case only — case size unknown, contact distributor`,
      secondary: product.ada_name
        ? `Distributor: ${product.ada_name}`
        : null,
      isConstrained: true,
      allowedSplits: [],
      caseSize: null,
    };
  }

  // Standard split-case size. Show all allowed splits + the full-case
  // count so user knows the largest valid increment.
  // De-dup in case caseSize is already in the allowed list (e.g. 12 in [1,3,6,12]).
  const allRoutes = [...allowedSplits];
  if (caseSize > 0 && !allRoutes.includes(caseSize)) {
    allRoutes.push(caseSize);
  }
  allRoutes.sort((a, b) => a - b);

  const primary =
    caseSize > 0
      ? `Order ${allRoutes.join(", ")} bottles (full case = ${caseSize})`
      : `Order ${allowedSplits.join(", ")} bottles, or any full case`;

  return {
    primary,
    secondary: product.ada_name
      ? `Distributor: ${product.ada_name} · 9 L minimum per order`
      : "9 L minimum per order from this distributor",
    isConstrained: true,
    allowedSplits: [...allowedSplits],
    caseSize: caseSize > 0 ? caseSize : null,
  };
}

/**
 * Enumerate the valid order quantities for a product, in ascending
 * order. Used by the ProductCard's constrained qty stepper (task #45,
 * 2026-05-31) so the user can only land on quantities MLCC will accept
 * — no more typing 5 bottles of a 750ml that allows splits of 1/3/6/12.
 *
 * Three branches:
 *   - Unknown size: returns empty array. Caller falls back to a free
 *     1-99 input (current behavior — don't lie about rules we don't
 *     have for this size).
 *   - Split-case size (e.g. 750ml [1, 3, 6, 12]): returns the explicit
 *     splits PLUS multiples of the largest (full case) up to maxN.
 *     Result for 750ml: [1, 3, 6, 12, 24, 36, ..., 480].
 *   - Full-case-only size (e.g. 100ml × 48): returns multiples of the
 *     case size up to maxN. Result: [48, 96, 144, ..., 480].
 *
 * `maxN` defaults to 500 — covers every realistic order. A store
 * placing >500 bottles of a single SKU is sufficiently unusual that
 * forcing them to do a separate cart line is fine.
 *
 * @param rule - The display rule from getOrderingRuleDisplay (carries
 *   allowedSplits + caseSize already, so we don't redo the lookup).
 * @param maxN - Hard ceiling on enumerated quantities. Defaults to 500.
 */
export function generateValidQuantities(
  rule: OrderingRuleDisplay,
  maxN: number = 500,
): number[] {
  if (rule.allowedSplits === null) return [];

  if (rule.allowedSplits.length === 0) {
    // Full-case-only size. Need a known case size to enumerate.
    const cs = rule.caseSize ?? 0;
    if (cs <= 0) return [];
    const result: number[] = [];
    for (let n = cs; n <= maxN; n += cs) result.push(n);
    return result;
  }

  // Split-case size. Combine explicit allowed splits with multiples of
  // the largest one (the full-case stand-in per the milo-ordering-rules
  // engine). Dedup + sort because explicit splits and case multiples
  // can overlap (e.g. 12 is both in [1,3,6,12] AND a multiple of 12).
  const explicit = [...rule.allowedSplits];
  const largest = Math.max(...explicit);
  const set = new Set<number>(explicit);
  for (let n = largest; n <= maxN; n += largest) set.add(n);
  return [...set].sort((a, b) => a - b);
}

/**
 * Step through the valid quantities by delta. Returns the next/previous
 * valid quantity from `current`, or 0 if going below the smallest.
 *
 * Going UP from 0 jumps to the smallest valid (matches MLCC's actual UX
 * — user taps `+` once on a 50ml shot and qty jumps from 0 to 60).
 * Going DOWN at the smallest valid returns to 0 (so user can "deselect"
 * a quantity entirely without removing the line).
 *
 * @param current - Current quantity (may be 0).
 * @param delta - +1 to go up, -1 to go down. Other values are clamped.
 * @param validQuantities - From generateValidQuantities. Must be sorted ascending.
 */
export function stepValidQuantity(
  current: number,
  delta: number,
  validQuantities: number[],
): number {
  if (validQuantities.length === 0) {
    // No constraints. Fall back to ±1 with floor at 0.
    return Math.max(0, current + (delta > 0 ? 1 : -1));
  }
  if (delta > 0) {
    const above = validQuantities.find((n) => n > current);
    return above ?? validQuantities[validQuantities.length - 1];
  }
  if (delta < 0) {
    const below = [...validQuantities].reverse().find((n) => n < current);
    return below ?? 0;
  }
  return current;
}
