/**
 * order-sync-display — pure display decisions for synced orders
 * (#36 Phase A, 2026-08-08).
 *
 * Doctrine: once a row has been synced, MILO's CURRENT number is what the
 * owner sees first — the placement number stays visible as "placed $X"
 * only when they differ (first-order night: placed $5,209.14, MILO truth
 * $2,029.14 after Tony's edit; both facts, clearly labeled, no guessing).
 * Penny doctrine everywhere: comparisons are integer-cents, display is
 * exact.
 */

export type SyncedOrderLike = {
  net_total?: number | null;
  gross_total?: number | null;
  delivery_date?: string | null;
  line_item_count?: number | null;
  synced_at?: string | null;
  synced_status?: string | null;
  synced_updated_by_ada?: boolean | null;
  synced_net_total?: number | null;
  synced_gross_total?: number | null;
  synced_delivery_date?: string | null;
  synced_line_item_count?: number | null;
};

export type OrderMoneyView = {
  /** The headline number: MILO's current truth when synced, else placement. */
  current: number | null;
  /** Placement-time net (falls back to gross when net was never captured). */
  placed: number | null;
  /** True when the synced number differs from placement by >= 1 cent. */
  edited: boolean;
  /** True when the edit made the order cheaper (Tony's 8/5 case). */
  editedDown: boolean;
  /** MILO reported the ADA touched this order (surfaced in detail copy). */
  adaTouched: boolean;
  synced: boolean;
};

const cents = (n: number | null | undefined): number | null => {
  // Null-check BEFORE Number(): Number(null) is 0, and treating a missing
  // placement total as $0.00 would flag every backfilled row as "edited".
  if (n == null) return null;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

export function orderMoneyView(o: SyncedOrderLike): OrderMoneyView {
  const synced = o.synced_at != null;
  const placed = o.net_total ?? o.gross_total ?? null;
  const syncedNet = o.synced_net_total ?? o.synced_gross_total ?? null;
  const current = synced && syncedNet != null ? syncedNet : placed;

  const pc = cents(placed);
  const sc = synced ? cents(syncedNet) : null;
  const edited = pc != null && sc != null && pc !== sc;

  return {
    current,
    placed,
    edited,
    editedDown: edited && (sc as number) < (pc as number),
    adaTouched: o.synced_updated_by_ada === true,
    synced,
  };
}

/** Delivery date: MILO's current promise wins once synced. */
export function orderDeliveryDate(o: SyncedOrderLike): string | null {
  return (o.synced_at != null ? o.synced_delivery_date : null) ?? o.delivery_date ?? null;
}

/** Line count for list rows: current count once synced, placement before. */
export function orderLineCount(o: SyncedOrderLike): number {
  if (o.synced_at != null && o.synced_line_item_count != null) {
    return o.synced_line_item_count;
  }
  return o.line_item_count ?? 0;
}

type LineLike = {
  lineTotal?: number | null;
  lineSubtotal?: number | null;
} & Record<string, unknown>;

/**
 * Line money: the browser parser era wrote `lineTotal`, the node engine
 * writes `lineSubtotal`. One accessor so no row ever shows "—" because
 * of a field-name era.
 */
export function lineMoney(li: LineLike): number | null {
  const v = li.lineSubtotal ?? li.lineTotal;
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

export type DetailLinesView<T> = {
  lines: T[];
  /** 'synced' = MILO's current lines; 'placed' = as captured at submit. */
  source: "synced" | "placed";
};

/**
 * Which line list the detail page shows. Synced lines win when present —
 * they are MILO's current truth AND the only lines backfilled rows have.
 */
export function detailLines<T>(detail: {
  line_items?: T[] | null;
  synced_line_items?: T[] | null;
}): DetailLinesView<T> {
  const synced = Array.isArray(detail.synced_line_items) ? detail.synced_line_items : [];
  if (synced.length > 0) return { lines: synced, source: "synced" };
  const placed = Array.isArray(detail.line_items) ? detail.line_items : [];
  return { lines: placed, source: "placed" };
}

/** "just now" / "4m ago" / "3h ago" / "2d ago" — for the sync caption. */
export function timeAgoShort(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
