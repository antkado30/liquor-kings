/**
 * updates-feed — pure builder for the Updates bell feed (2026-08-05).
 *
 * Tony's design (locked same day): a bell next to the cart icon opens a
 * feed of EVERYTHING that happened, when it happened — price changes,
 * new bottles, catalog sync events, order events — without cramming the
 * Home tab. Home keeps its top smart cards; this feed is the full
 * chronology.
 *
 * Pure: the route hands in raw rows from the four sources; this module
 * shapes, merges, sorts (newest first), and caps. No supabase, no
 * clock — `nowMs` injected for the tests.
 */

const FEED_CAP = 60;

const KIND_LABELS = {
  full: "Full price book",
  new_item_list: "New Item Price List",
  retail_price_changes: "Retail Price Changes",
  ada_changes: "ADA Changes",
  upc_txt: "Barcode file (UPC)",
};

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toFixed(2)}`;
}

function sizeOf(row) {
  return row.bottle_size_label ?? (row.bottle_size_ml != null ? `${row.bottle_size_ml} mL` : null);
}

/**
 * @param {object} sources
 * @param {Array<object>} [sources.priceRows]  mlcc_items rows with price_changed_at
 * @param {Array<object>} [sources.newRows]    mlcc_items rows with is_new_item
 * @param {Array<object>} [sources.syncRows]   mlcc_price_book_runs complete rows
 * @param {Array<object>} [sources.orderRows]  milo_order_confirmations rows
 * @returns {Array<{id:string,type:string,title:string,body:string,at:string,meta:object}>}
 */
export function buildUpdatesFeed({ priceRows = [], newRows = [], syncRows = [], orderRows = [] } = {}) {
  const entries = [];

  for (const r of priceRows) {
    if (!r?.price_changed_at) continue;
    const size = sizeOf(r);
    const now = money(r.licensee_price);
    const was = money(r.previous_licensee_price);
    const shelf = money(r.min_shelf_price);
    const move = was && now && was !== now ? `Licensee ${was} → ${now}` : now ? `Licensee now ${now}` : "Price updated";
    entries.push({
      id: `price-${r.code}-${r.price_changed_at}`,
      type: "price_change",
      title: size ? `${r.name} (${size})` : String(r.name ?? r.code),
      body: shelf ? `${move} · shelf ${shelf}` : move,
      at: r.price_changed_at,
      meta: { code: r.code, was: r.previous_licensee_price ?? null, now: r.licensee_price ?? null },
    });
  }

  for (const r of newRows) {
    const at = r?.updated_at ?? r?.created_at;
    if (!at) continue;
    const size = sizeOf(r);
    const price = money(r.licensee_price);
    const scannable = r.upc != null && String(r.upc).trim() !== "";
    entries.push({
      id: `new-${r.code}-${at}`,
      type: "new_bottle",
      title: size ? `${r.name} (${size})` : String(r.name ?? r.code),
      body: `New in the MLCC book${price ? ` — ${price}` : ""}. ${
        scannable ? "Scannable now." : "Searchable now — barcode lands when MLCC posts it."
      }`,
      at,
      meta: { code: r.code, scannable },
    });
  }

  for (const r of syncRows) {
    if (!r?.completed_at) continue;
    const label = KIND_LABELS[r.kind] ?? "Catalog update";
    const bits = [];
    if (r.total_items != null) bits.push(`${r.total_items} items`);
    if (r.updated_items != null && r.updated_items > 0) bits.push(`${r.updated_items} price changes`);
    if (r.new_items != null && r.new_items > 0) bits.push(`${r.new_items} new`);
    entries.push({
      id: `sync-${r.kind}-${r.completed_at}`,
      type: "catalog_sync",
      title: `${label} ingested${r.price_book_date ? ` (${r.price_book_date})` : ""}`,
      body: bits.length ? bits.join(" · ") : "Catalog updated automatically.",
      at: r.completed_at,
      meta: { kind: r.kind ?? "full" },
    });
  }

  for (const r of orderRows) {
    const at = r?.submitted_at ?? r?.placed_at;
    if (!at || !r?.confirmation_number) continue;
    const net = money(r.net_total);
    entries.push({
      id: `order-${r.confirmation_number}-${at}`,
      type: "order_event",
      title: `Order placed${r.ada_name ? ` — ${r.ada_name}` : ""}`,
      body: `#${r.confirmation_number}${net ? ` · ${net}` : ""}${
        r.delivery_date ? ` · delivery ${r.delivery_date}` : ""
      }`,
      at,
      meta: { confirmation: r.confirmation_number },
    });
  }

  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return entries.slice(0, FEED_CAP);
}

export { FEED_CAP };
