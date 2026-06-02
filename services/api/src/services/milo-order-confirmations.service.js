/**
 * MILO order confirmations service (task #41, 2026-06-02).
 *
 * Reads from the `historyOrders` array Stage 5 captures off
 * /milo/account/orders and writes one row per (executionRun, ADA) to
 * `public.milo_order_confirmations`. The table is the queryable source
 * of truth for the Orders page + future assistant tools; the worker's
 * evidence column remains the audit trail, but consumers shouldn't have
 * to grep jsonb to surface a confirmation number.
 *
 * The persistence is best-effort — if Supabase rejects the insert for any
 * reason, we log and move on. NEVER fail the underlying RPA run for a
 * confirmation-persistence error; the run already succeeded by the time
 * we reach this code.
 */

import {
  ADA_MINIMUM_ORDER_LITERS,
  KNOWN_ADAS,
} from "../mlcc/milo-ordering-rules.js";

void ADA_MINIMUM_ORDER_LITERS; // kept for parity with rule-aware callers

/**
 * Try to find the ADA number for a "distributor_raw" string like
 * "NWS Michigan, Inc." Falls back to KNOWN_ADAS keys.
 */
function inferAdaNumberFromName(name) {
  const s = String(name ?? "").toLowerCase();
  if (!s) return null;
  for (const [adaNumber, adaName] of Object.entries(KNOWN_ADAS)) {
    if (s.includes(String(adaName).toLowerCase().slice(0, 6))) {
      return adaNumber;
    }
  }
  return null;
}

/**
 * Coerce a money-ish input to a number with 2-decimal precision. Returns
 * null for non-finite / unparseable input.
 */
function toMoneyNumber(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Build the row payload(s) for milo_order_confirmations from a successful
 * Stage 5 result. Returns an array of objects ready to upsert.
 *
 * @param {object} args
 * @param {string} args.storeId
 * @param {string} args.executionRunId
 * @param {object} args.checkedOut - return shape from rpa/stages/checkout.js
 * @param {Array}  [args.sessionAdaOrders] - session.adaOrders from Stage 4 (for cross-ref)
 */
export function buildMiloConfirmationRows({
  storeId,
  executionRunId,
  checkedOut,
  sessionAdaOrders,
}) {
  if (!storeId || !executionRunId || !checkedOut) return [];

  const historyOrders = Array.isArray(checkedOut.historyOrders)
    ? checkedOut.historyOrders
    : [];
  const confirmationMap =
    checkedOut.confirmationNumbers && typeof checkedOut.confirmationNumbers === "object"
      ? checkedOut.confirmationNumbers
      : {};
  const adaOrders = Array.isArray(sessionAdaOrders) ? sessionAdaOrders : [];

  // Build a quick lookup of Stage 4 ADA breakdown by ADA number so we
  // can fill in any missing names. Stage 4's adaOrders carry the
  // authoritative ada_name from MILO.
  const adaOrderByNumber = new Map();
  for (const ada of adaOrders) {
    const number = ada?.adaNumber ?? ada?.ada_number;
    if (number != null) adaOrderByNumber.set(String(number), ada);
  }

  const rows = [];

  // Walk historyOrders — that's the rich source. Each block = one ADA.
  for (let i = 0; i < historyOrders.length; i += 1) {
    const ho = historyOrders[i];
    if (!ho) continue;
    const distributorRaw = String(ho.distributorRaw ?? "").trim() || null;
    const inferredAdaNumber = distributorRaw
      ? inferAdaNumberFromName(distributorRaw)
      : null;
    const adaNumber = inferredAdaNumber ?? null;
    const stage4Ada = adaNumber ? adaOrderByNumber.get(adaNumber) : null;
    const adaName =
      (stage4Ada?.adaName ?? stage4Ada?.ada_name) ||
      (adaNumber && KNOWN_ADAS[adaNumber]) ||
      distributorRaw ||
      null;

    // Confirmation # source order: historyOrders.confirmationNumber first
    // (parsed directly from MILO), then the confirmationMap by ADA number
    // (where matching succeeded), then null. We skip rows entirely if
    // there's no confirmation number — those are noise we can't make
    // queryable.
    let confirmationNumber = ho.confirmationNumber ?? null;
    if (!confirmationNumber && adaNumber && confirmationMap[adaNumber]) {
      confirmationNumber = confirmationMap[adaNumber];
    }
    if (!confirmationNumber) continue;

    const orderNumber = ho.orderNumber ?? null;
    const placedAt = ho.placedIso ?? null;
    const deliveryDate = ho.deliveryRaw
      ? parseDeliveryDate(ho.deliveryRaw)
      : null;
    const lineItems = Array.isArray(ho.lineItems) ? ho.lineItems : [];

    rows.push({
      store_id: storeId,
      execution_run_id: executionRunId,
      ada_number: adaNumber,
      ada_name: adaName,
      confirmation_number: String(confirmationNumber),
      order_number: orderNumber ? String(orderNumber) : null,
      placed_at: placedAt,
      delivery_date: deliveryDate,
      // submitted_at uses table default (now())
      net_total: toMoneyNumber(ho.total),
      gross_total: toMoneyNumber(ho.subtotal),
      liquor_tax: null, // not parsed today; column reserved for future
      discount: null, // not parsed today
      line_items: lineItems,
      line_item_count: lineItems.length,
      distributor_raw: distributorRaw,
      status_at_placement: ho.status ?? null,
    });
  }

  return rows;
}

/**
 * Try to parse "Delivery: 06/09/2026" / "06/09/2026" / "2026-06-09" into
 * an ISO date string. Returns null on unparseable input — the column
 * tolerates null cleanly.
 */
function parseDeliveryDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // ISO first
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US mm/dd/yyyy
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Persist Stage 5 confirmations to the database. Best-effort: logs and
 * swallows errors so a persistence failure can never sink an otherwise
 * successful order submission. Returns a summary the caller can include
 * in evidence for traceability.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase - service-role client
 * @param {string} args.storeId
 * @param {string} args.executionRunId
 * @param {object} args.checkedOut
 * @param {Array} [args.sessionAdaOrders]
 * @returns {Promise<{ persisted: number, skipped: number, error: string | null }>}
 */
export async function persistMiloOrderConfirmations({
  supabase,
  storeId,
  executionRunId,
  checkedOut,
  sessionAdaOrders,
}) {
  const rows = buildMiloConfirmationRows({
    storeId,
    executionRunId,
    checkedOut,
    sessionAdaOrders,
  });
  if (rows.length === 0) {
    return { persisted: 0, skipped: 0, error: "no_confirmable_rows" };
  }

  /*
    upsert on (execution_run_id, ada_number). The unique partial index
    guards us from duplicate inserts if the worker retries. A re-emit
    with the same payload is a noop; a re-emit with new data (rare —
    Stage 5 doesn't run twice for the same run) overwrites the prior
    row. Either way the database stays consistent.
  */
  const { data, error } = await supabase
    .from("milo_order_confirmations")
    .upsert(rows, {
      onConflict: "execution_run_id,ada_number",
      ignoreDuplicates: false,
    })
    .select("id");

  if (error) {
    console.warn(
      `[milo-confirmations] upsert failed for run ${executionRunId} (continuing): ${error.message}`,
    );
    return { persisted: 0, skipped: rows.length, error: error.message };
  }
  const persisted = Array.isArray(data) ? data.length : rows.length;
  return { persisted, skipped: 0, error: null };
}
