/**
 * Cart validation against MLCC ordering rules.
 *
 * Shared logic for: the assistant's `validate_cart` tool AND the
 * `POST /cart/:storeId/validate` endpoint the scanner calls for live
 * per-ADA validation as the operator builds a cart.
 *
 * Takes a list of `{ code, quantity }`, enriches each code with size +
 * ADA from `mlcc_items`, then runs the shared `validateCart` rule engine
 * (per-ADA 9L minimum + per-size split-case rules).
 */

import { validateCart as validateCartRules } from "../mlcc/milo-ordering-rules.js";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<{ code: string|number, quantity: number }>} items
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   valid?: boolean,
 *   errors?: Array<object>,
 *   adaBreakdown?: Record<string, { liters: number, meetsMinimum: boolean }>,
 *   itemsValidated?: Array<object>,
 *   unknownCodes?: string[],
 * }>}
 */
export async function validateCartByCodes(supabase, items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return { ok: false, error: "items must be a non-empty array" };
  }

  const codes = [
    ...new Set(
      list.map((i) => String(i?.code ?? "").trim()).filter(Boolean),
    ),
  ];
  if (codes.length === 0) {
    return { ok: false, error: "no valid product codes in items" };
  }

  const { data, error } = await supabase
    .from("mlcc_items")
    .select("code,name,size_ml,ada_number,case_size")
    .in("code", codes);
  if (error) {
    return { ok: false, error: `catalog lookup failed: ${error.message}` };
  }

  const byCode = new Map((data ?? []).map((r) => [String(r.code), r]));
  const unknownCodes = codes.filter((c) => !byCode.has(c));

  // Build the { code, bottle_size_ml, quantity, ada_number } shape that
  // validateCart expects, enriching each requested code from the catalog.
  const cartItems = [];
  for (const item of list) {
    const code = String(item?.code ?? "").trim();
    const meta = byCode.get(code);
    if (!meta) continue;
    cartItems.push({
      code,
      name: meta.name,
      bottle_size_ml: Number(meta.size_ml),
      quantity: Number(item?.quantity),
      ada_number: meta.ada_number,
      // case_size lets the rule engine validate full-case-only sizes
      // (50/100ml): a valid order is a whole multiple of the case.
      case_size:
        meta.case_size != null && Number(meta.case_size) > 0
          ? Number(meta.case_size)
          : undefined,
    });
  }

  if (cartItems.length === 0) {
    return {
      ok: false,
      error: "none of the cart codes were found in the MLCC catalog",
      unknownCodes,
    };
  }

  const result = validateCartRules(cartItems);
  return {
    ok: true,
    valid: result.valid,
    errors: result.errors,
    adaBreakdown: result.adaBreakdown,
    itemsValidated: cartItems.map((i) => ({
      code: i.code,
      name: i.name,
      quantity: i.quantity,
      size_ml: i.bottle_size_ml,
      ada_number: i.ada_number,
    })),
    unknownCodes: unknownCodes.length ? unknownCodes : undefined,
  };
}
