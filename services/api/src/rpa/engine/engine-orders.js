/**
 * engine-orders — MILO orders-history via the API, for the node submit path.
 *
 * SHAPE TRUTH (probed live on the worker, 2026-07-22 — real responses, not
 * guesses). `GET /users/orders?groupid=<groupId>` → 200 with an array of:
 *
 *   {
 *     orderNumber: 274509587,                      // number
 *     licenseNumber: "430342",
 *     placedOn: "2026-07-16T22:28:10.376Z",        // ISO — filterable!
 *     anticipatedDeliveryDate: "2026-07-21",
 *     confirmationNumber: "5806580",               // string
 *     distributor: { referenceNumber: "221", name: "General Wine & Liquor", ... },
 *     items: [ { product: { code: "3797", name: "PLATINUM 7X PL", ... },
 *                quantity: 6, unitPrice: 8.03, total: 48.18,
 *                orderType: "MILO", updatedByAda: true, ... } ],
 *     taxAmt, salesTaxAmt, discountAmt,
 *     total: 3998.07,            netTotalAmt: 3795.83,      // CURRENT (ADA may edit!)
 *     originalTotal: 3952.59,    originalNetTotalAmt: 3752.60, // AT PLACEMENT
 *     originalDeliveryDate: "2026-07-21",
 *     updatedByAda: true, adaConfirmed: true, orderType: "MILO"
 *   }
 *
 * Both 2026-07-16 confirmations (5806580 / 31002245) verified present, and
 * originalNetTotalAmt matched the postmortem's net to the penny.
 *
 * NOTE the without-groupid forms 400 — the groupid query param is required.
 *
 * The normalized output deliberately mirrors the browser Stage-5 parser's
 * `historyOrders` block shape (checkout.js parseOrdersHistoryPage) so
 * `persistMiloOrderConfirmations` consumes it UNCHANGED — one persistence
 * path, two capture mechanisms. `original*` fields win over current ones:
 * confirmation rows record the order AS PLACED; ADA edits arrive later and
 * belong to a future reconciliation feature, not the placement record.
 *
 * READ-ONLY MODULE. Nothing in here mutates a cart or submits anything.
 */

const round2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Fetch the account's order history via a MILO transport. Returns the raw
 * transport result ({ ms, status, ok, body }) — the caller decides how a
 * failure routes (on the submit backstop, a failed read = no confirmations =
 * submitted_unconfirmed, never a crash).
 */
export async function fetchMiloOrders(transport, { token, groupId, silent = true } = {}) {
  if (!transport?.call) throw new Error("fetchMiloOrders: transport is required");
  if (!token) throw new Error("fetchMiloOrders: token is required");
  if (groupId == null || String(groupId).trim() === "") {
    throw new Error("fetchMiloOrders: groupId is required");
  }
  return transport.call("GET", `/users/orders?groupid=${encodeURIComponent(groupId)}`, {
    token,
    label: "GET /users/orders (confirmations)",
    silent,
  });
}

/**
 * One MILO API order → one browser-parser-shaped historyOrders block.
 * Pure. Tolerant of missing fields (null, never throw) — a half-shaped
 * order still yields whatever confirmation data it carries.
 */
export function normalizeMiloApiOrder(o) {
  if (!o || typeof o !== "object") return null;
  const placedIso = strOrNull(o.placedOn);
  const items = Array.isArray(o.items) ? o.items : [];
  const lineItems = items.map((it) => ({
    liquorCode: strOrNull(it?.product?.code),
    productName: strOrNull(it?.product?.name),
    quantity: Number.isFinite(Number(it?.quantity)) ? Number(it.quantity) : null,
    unitPrice: round2(it?.unitPrice),
    lineSubtotal: round2(it?.total),
    orderType: strOrNull(it?.orderType),
  }));

  return {
    confirmationNumber: strOrNull(o.confirmationNumber),
    orderNumber: strOrNull(o.orderNumber),
    distributorRaw: strOrNull(o.distributor?.name),
    // Structured ADA number straight from MILO — the browser parser has to
    // INFER this from the distributor name; the API just hands it to us.
    adaNumber: strOrNull(o.distributor?.referenceNumber),
    licenseNumber: strOrNull(o.licenseNumber),
    placedRaw: placedIso,
    placedDate: placedIso ? placedIso.slice(0, 10) : null,
    placedIso,
    deliveryRaw: strOrNull(o.originalDeliveryDate) ?? strOrNull(o.anticipatedDeliveryDate),
    // Placement-time money truth: original* fields are the order AS PLACED;
    // bare total/netTotalAmt drift when the ADA edits (updatedByAda:true on
    // the real 7/16 order). subtotal maps to the persist service's
    // gross_total, total to its net_total — same orientation as the browser
    // parser's SUBTOTAL|TOTAL pair.
    subtotal: round2(o.originalTotal ?? o.total),
    total: round2(o.originalNetTotalAmt ?? o.netTotalAmt),
    status: o.adaConfirmed === true ? "Confirmed" : null,
    updatedByAda: o.updatedByAda === true,
    lineItems,
    lineItemCount: lineItems.length,
  };
}

/**
 * Pick which history orders belong to THE submit we just dispatched.
 *
 * Criteria (all structured — no date-string heuristics):
 *   - placedOn >= dispatchedAt − skewMs (clock skew tolerance; MILO stamped
 *     the 7/16 orders ~40s after our click, so the risk is MILO being
 *     slightly BEHIND our clock — the skew covers both directions)
 *   - licenseNumber matches when both sides have one
 *   - capped to expectedCount most-recent (one order per ADA with items;
 *     concurrent same-store runs are structurally impossible —
 *     one_running_run_per_store — so extras would be MILO weirdness and the
 *     cap keeps us from claiming someone else's order)
 *
 * @param {Array<object>} normalizedOrders  output of normalizeMiloApiOrder
 * @param {object} args
 * @param {string} args.dispatchedAtIso  timestamp captured immediately before the POST
 * @param {number} args.expectedCount    number of ADAs we submitted for (>=1)
 * @param {string} [args.licenseNumber]
 * @param {number} [args.skewMs]
 */
export function selectOrdersForSubmit(
  normalizedOrders,
  { dispatchedAtIso, expectedCount, licenseNumber, skewMs = 180_000 } = {},
) {
  const dispatchedMs = Date.parse(String(dispatchedAtIso ?? ""));
  if (!Number.isFinite(dispatchedMs)) return [];
  const cap = Number.isInteger(expectedCount) && expectedCount > 0 ? expectedCount : 1;
  const license = strOrNull(licenseNumber);

  const candidates = (Array.isArray(normalizedOrders) ? normalizedOrders : [])
    .filter((o) => {
      if (!o) return false;
      const placedMs = Date.parse(String(o.placedIso ?? ""));
      if (!Number.isFinite(placedMs)) return false; // no timestamp = not attributable to this submit
      if (placedMs < dispatchedMs - skewMs) return false;
      if (license && o.licenseNumber && o.licenseNumber !== license) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.placedIso) - Date.parse(a.placedIso));

  return candidates.slice(0, cap);
}

/**
 * Build the ADA-keyed confirmation map the persist service (and run
 * evidence) expects: { "221": "5806580", "321": "31002245" }. Falls back to
 * ada_<n> keys when an order carries no structured ADA number (persist then
 * still name-infers from distributorRaw).
 */
export function buildConfirmationMapFromOrders(selectedOrders) {
  const map = {};
  (Array.isArray(selectedOrders) ? selectedOrders : []).forEach((o, idx) => {
    if (!o?.confirmationNumber) return;
    const key = o.adaNumber ?? `ada_${idx + 1}`;
    map[key] = o.confirmationNumber;
  });
  return map;
}
