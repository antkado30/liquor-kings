/**
 * engine-order-sync — pull MILO's CURRENT order truth back into LK.
 * (#36 Phase A, 2026-08-08.)
 *
 * Why this exists (first-order night, 2026-08-05): Tony caught a 150-unit
 * accidental line by reading MILO's own pages, fixed it with MILO's "Edit
 * order" — and LK kept showing the as-placed numbers ($5,209.14) while
 * MILO's truth was $2,029.14. engine-orders.js deliberately records the
 * order AS PLACED and says so: "ADA edits arrive later and belong to a
 * future reconciliation feature." This is that feature.
 *
 * Design:
 *   - Placement columns on milo_order_confirmations stay IMMUTABLE.
 *     Current MILO state lands in synced_* columns (migration 20260808).
 *   - Matching is by confirmation_number (the load-bearing identifier),
 *     scoped to the store. Rows MILO no longer returns are left alone.
 *   - MILO orders with NO local row are IMPORTED (execution_run_id NULL,
 *     origin 'milo_sync') — orders placed outside LK (e.g. by hand in
 *     MILO) join the history instead of being invisible. This also gives
 *     backfilled July rows their line items via synced_line_items.
 *   - READ-ONLY against MILO (GET /users/orders). Nothing here can touch
 *     a cart, a checkout, or a submit — same guarantee as engine-orders.
 *
 * Money: numerics normalized to cents with the same round2 the engine
 * uses; the penny doctrine (display exact, never round) is the UI's law.
 */

import { getNodeMiloSession, invalidateNodeMiloSession } from "./milo-node-session.js";
import { fetchMiloOrders } from "./engine-orders.js";
import { KNOWN_ADAS } from "../../mlcc/milo-ordering-rules.js";

const round2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const dateOrNull = (v) => {
  const s = strOrNull(v);
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * One MILO API order → the sync view: BOTH placement-time (original*) and
 * current fields, because the sync writer needs current for synced_* and
 * original to backfill placement holes on rows born without them.
 * Pure; tolerant of half-shaped input (null, never throw).
 */
export function normalizeMiloApiOrderForSync(o) {
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
    adaNumber: strOrNull(o.distributor?.referenceNumber),
    distributorRaw: strOrNull(o.distributor?.name),
    licenseNumber: strOrNull(o.licenseNumber),
    placedIso,
    // Placement-time money (what net_total/gross_total mean on the row).
    originalGross: round2(o.originalTotal ?? o.total),
    originalNet: round2(o.originalNetTotalAmt ?? o.netTotalAmt),
    originalDeliveryDate: dateOrNull(o.originalDeliveryDate),
    // CURRENT money — drifts when the ADA or the owner edits after placement.
    currentGross: round2(o.total),
    currentNet: round2(o.netTotalAmt),
    currentDeliveryDate: dateOrNull(o.anticipatedDeliveryDate) ?? dateOrNull(o.originalDeliveryDate),
    status: o.adaConfirmed === true ? "Confirmed" : null,
    updatedByAda: o.updatedByAda === true,
    lineItems,
    lineItemCount: lineItems.length,
  };
}

/**
 * Decide what the sync writes, purely. Matching is by trimmed
 * confirmation_number.
 *
 * @param {object} args
 * @param {Array<{id: string, confirmation_number: string,
 *   placed_at?: string|null, order_number?: string|null,
 *   delivery_date?: string|null, net_total?: number|null,
 *   gross_total?: number|null}>} args.localRows  this store's confirmation rows
 * @param {Array<object>} args.apiOrders  normalizeMiloApiOrderForSync outputs
 * @param {string} args.nowIso
 * @param {string} args.storeId  stamped onto imported rows
 * @returns {{updates: Array<{id: string, patch: object}>,
 *   imports: Array<object>, matched: number, unmatchedLocal: number}}
 */
export function buildSyncPlan({ localRows, apiOrders, nowIso, storeId }) {
  const locals = Array.isArray(localRows) ? localRows : [];
  const orders = (Array.isArray(apiOrders) ? apiOrders : []).filter(
    (o) => o && o.confirmationNumber,
  );

  const localByConf = new Map();
  for (const row of locals) {
    const key = strOrNull(row?.confirmation_number);
    if (key && !localByConf.has(key)) localByConf.set(key, row);
  }

  const updates = [];
  const imports = [];
  const matchedConfs = new Set();

  for (const o of orders) {
    const local = localByConf.get(o.confirmationNumber);
    const syncedFields = {
      synced_at: nowIso,
      synced_status: o.status,
      synced_updated_by_ada: o.updatedByAda,
      synced_net_total: o.currentNet,
      synced_gross_total: o.currentGross,
      synced_delivery_date: o.currentDeliveryDate,
      synced_line_items: o.lineItems,
      synced_line_item_count: o.lineItemCount,
    };

    if (local) {
      matchedConfs.add(o.confirmationNumber);
      const patch = { ...syncedFields };
      // Backfill placement HOLES only — never overwrite a captured
      // placement fact (immutability doctrine). Rows born from the
      // evidence backfill carry nulls here; MILO's original* fields ARE
      // the placement record for them.
      if (local.placed_at == null && o.placedIso) patch.placed_at = o.placedIso;
      if (local.order_number == null && o.orderNumber) patch.order_number = o.orderNumber;
      if (local.delivery_date == null && o.originalDeliveryDate) {
        patch.delivery_date = o.originalDeliveryDate;
      }
      if (local.net_total == null && o.originalNet != null) patch.net_total = o.originalNet;
      if (local.gross_total == null && o.originalGross != null) {
        patch.gross_total = o.originalGross;
      }
      updates.push({ id: local.id, patch });
    } else {
      // Order exists in MILO but not in LK — placed by hand, or history
      // that predates us. Import it so the Orders page tells the whole
      // truth. Placement lines were never captured for these, so
      // line_items stays [] (honest) and synced_line_items carries the
      // current truth.
      imports.push({
        store_id: storeId,
        execution_run_id: null,
        ada_number: o.adaNumber,
        ada_name: (o.adaNumber && KNOWN_ADAS[o.adaNumber]) || o.distributorRaw || null,
        confirmation_number: o.confirmationNumber,
        order_number: o.orderNumber,
        placed_at: o.placedIso,
        delivery_date: o.originalDeliveryDate,
        net_total: o.originalNet,
        gross_total: o.originalGross,
        line_items: [],
        line_item_count: 0,
        distributor_raw: o.distributorRaw,
        status_at_placement: null,
        origin: "milo_sync",
        ...syncedFields,
      });
    }
  }

  const unmatchedLocal = locals.filter(
    (r) => !matchedConfs.has(strOrNull(r?.confirmation_number)),
  ).length;

  return { updates, imports, matched: matchedConfs.size, unmatchedLocal };
}

/**
 * Run one full order sync for a store: MILO login (cached node session) →
 * GET /users/orders → plan → apply → stamp stores.last_order_sync_at.
 *
 * Throws MiloNodeLoginError on auth problems (caller classifies).
 * Returns a summary for logs/evidence. DB write failures on individual
 * rows are counted, logged, and never abort the rest of the sync.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase service-role
 * @param {string} args.storeId
 * @param {string} args.username  decrypted MILO credential
 * @param {string} args.password
 * @param {object} [args.transport] injectable for tests
 * @param {string} [args.nowIso]    injectable clock for tests
 */
export async function runMiloOrderSyncForStore({
  supabase,
  storeId,
  username,
  password,
  transport,
  nowIso,
}) {
  const startedAt = Date.now();
  const stamp = nowIso ?? new Date().toISOString();

  const session = await getNodeMiloSession({ storeId, username, password, transport });
  const res = await fetchMiloOrders(session.transport, {
    token: session.token,
    groupId: session.groupId,
  });
  if (!res?.ok || !Array.isArray(res.body)) {
    // A dead orders read may mean a poisoned token — drop the cached
    // session so the next attempt logs in fresh (worker doctrine).
    invalidateNodeMiloSession(storeId, "order_sync_fetch_failed");
    return {
      ok: false,
      reason: `orders_fetch_failed_${res?.status ?? 0}`,
      ms: Date.now() - startedAt,
    };
  }

  const apiOrders = res.body.map(normalizeMiloApiOrderForSync).filter(Boolean);

  const { data: localRows, error: readErr } = await supabase
    .from("milo_order_confirmations")
    .select("id, confirmation_number, placed_at, order_number, delivery_date, net_total, gross_total")
    .eq("store_id", storeId);
  if (readErr) {
    return { ok: false, reason: `local_read_failed: ${readErr.message}`, ms: Date.now() - startedAt };
  }

  const plan = buildSyncPlan({ localRows, apiOrders, nowIso: stamp, storeId });

  let updated = 0;
  let updateErrors = 0;
  for (const u of plan.updates) {
    const { error } = await supabase
      .from("milo_order_confirmations")
      .update(u.patch)
      .eq("id", u.id);
    if (error) {
      updateErrors += 1;
      console.warn(`[order-sync] update failed for row ${u.id}: ${error.message}`);
    } else {
      updated += 1;
    }
  }

  let imported = 0;
  let importErrors = 0;
  if (plan.imports.length > 0) {
    const { data, error } = await supabase
      .from("milo_order_confirmations")
      .insert(plan.imports)
      .select("id");
    if (error) {
      importErrors = plan.imports.length;
      console.warn(`[order-sync] import insert failed (continuing): ${error.message}`);
    } else {
      imported = Array.isArray(data) ? data.length : plan.imports.length;
    }
  }

  const { error: stampErr } = await supabase
    .from("stores")
    .update({ last_order_sync_at: stamp })
    .eq("id", storeId);
  if (stampErr) {
    console.warn(`[order-sync] last_order_sync_at stamp failed: ${stampErr.message}`);
  }

  return {
    ok: true,
    miloOrders: apiOrders.length,
    matched: plan.matched,
    updated,
    updateErrors,
    imported,
    importErrors,
    unmatchedLocal: plan.unmatchedLocal,
    ms: Date.now() - startedAt,
  };
}
