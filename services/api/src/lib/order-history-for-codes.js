/**
 * "You've ordered this before" (2026-08-12, Amazon-polish sweep).
 *
 * Pure scan over a store's MILO confirmations answering, per MLCC code:
 * how many ORDERS contained it, when the most recent one was placed,
 * and how many the store bought that time. Powers the ProductCard line
 * that turns "do I already get this? how many do I usually get?" into
 * a fact on screen instead of a walk to the back room.
 *
 * Truth rules:
 *   - synced_line_items (post-sync MILO truth) beats line_items when a
 *     sync has landed for that order — same preference the Orders UI
 *     makes. Falls back to the placement snapshot otherwise.
 *   - A code appearing on two lines of ONE order counts once (it is
 *     one order), with quantities summed for the "last time" number.
 *   - Rows are sorted here (placed_at, then created_at, desc) — the
 *     caller doesn't have to promise an order.
 *   - Codes normalize by trimming + stripping leading zeros so
 *     "0123" in an old confirmation still matches catalog code "123".
 */

export function normalizeCode(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * Every MLCC code this store has EVER put on an order (bounded scan) —
 * the resolver's "this store actually buys this bottle" signal
 * (2026-08-12, the captain-morgan-iced-tea whiff). Pure over rows so
 * it pins in tests; same synced-truth preference as the history scan.
 */
export function collectOrderedCodes(rows) {
  const out = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const synced = Array.isArray(row?.synced_line_items)
      ? row.synced_line_items
      : null;
    const lines =
      synced && synced.length > 0
        ? synced
        : Array.isArray(row?.line_items)
          ? row.line_items
          : [];
    for (const li of lines) {
      const code = normalizeCode(li?.liquorCode);
      if (code) out.add(code);
    }
  }
  return out;
}

/**
 * Fetch the ordered-code Set for a store (last 60 confirmations — same
 * bound as the history endpoint). FAIL-SOFT by design: any error returns
 * an empty Set, because this signal only ever breaks ties — resolving
 * must never break because history was unreachable.
 */
export async function fetchOrderedCodeSet(supabase, storeId) {
  if (!storeId) return new Set();
  try {
    const { data, error } = await supabase
      .from("milo_order_confirmations")
      .select("line_items, synced_line_items")
      .eq("store_id", storeId)
      .order("placed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      console.warn(`[order-history] ordered-code fetch failed (soft): ${error.message}`);
      return new Set();
    }
    return collectOrderedCodes(Array.isArray(data) ? data : []);
  } catch (e) {
    console.warn(`[order-history] ordered-code fetch threw (soft): ${e?.message ?? e}`);
    return new Set();
  }
}

function rowWhen(row) {
  return row?.placed_at ?? row?.created_at ?? null;
}

export function buildOrderHistoryForCodes(rows, codes) {
  const wanted = new Set(
    (Array.isArray(codes) ? codes : [])
      .map(normalizeCode)
      .filter((c) => c != null),
  );
  const out = {};
  if (wanted.size === 0) return out;

  const sorted = (Array.isArray(rows) ? [...rows] : []).sort((a, b) => {
    const aw = rowWhen(a) ?? "";
    const bw = rowWhen(b) ?? "";
    return aw < bw ? 1 : aw > bw ? -1 : 0;
  });

  for (const row of sorted) {
    const synced = Array.isArray(row?.synced_line_items)
      ? row.synced_line_items
      : null;
    const lines =
      synced && synced.length > 0
        ? synced
        : Array.isArray(row?.line_items)
          ? row.line_items
          : [];
    const when = rowWhen(row);

    /** code -> summed qty within THIS order (multi-line same-code orders). */
    const inThisOrder = new Map();
    for (const li of lines) {
      const code = normalizeCode(li?.liquorCode);
      if (!code || !wanted.has(code)) continue;
      const qty = Number(li?.quantity);
      const prev = inThisOrder.get(code) ?? { qty: 0, sawQty: false };
      if (Number.isFinite(qty)) {
        prev.qty += qty;
        prev.sawQty = true;
      }
      inThisOrder.set(code, prev);
    }

    for (const [code, { qty, sawQty }] of inThisOrder) {
      const cur = out[code];
      if (!cur) {
        // Rows walk newest → oldest, so the FIRST sighting is the latest order.
        out[code] = {
          times_ordered: 1,
          last_ordered_at: when,
          last_quantity: sawQty ? qty : null,
        };
      } else {
        cur.times_ordered += 1;
      }
    }
  }
  return out;
}
