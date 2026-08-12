/**
 * Recently viewed (2026-08-12, Amazon-polish sweep — GTM standing item 1).
 *
 * Every ProductCard open records the family here; the Scanner idle
 * screen shows the strip. One card per FAMILY (deduped case-insensitively
 * on baseName) so checking three sizes of Tito's doesn't fill the strip
 * with triplicates — the entry keeps the LAST size looked at, and a
 * re-view moves the family to the front. localStorage per device, same
 * scoping as the cart and search history.
 */

export type RecentlyViewedEntry = {
  /** MLCC code of the last size viewed — reopen path: getProductByCode(code). */
  code: string;
  /** Family title for the card ("Tito's Handmade Vodka"). */
  baseName: string;
  image_url: string | null;
  /** Price of the last size viewed, for the strip's price line. */
  licensee_price: number | null;
  bottle_size_label: string | null;
  category: string | null;
};

const KEY = "lk-recently-viewed-v1";
const MAX = 12;

export function loadRecentlyViewed(): RecentlyViewedEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentlyViewedEntry =>
          typeof x === "object" &&
          x != null &&
          typeof (x as RecentlyViewedEntry).code === "string" &&
          typeof (x as RecentlyViewedEntry).baseName === "string" &&
          (x as RecentlyViewedEntry).baseName.trim() !== "",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(entry: RecentlyViewedEntry): RecentlyViewedEntry[] {
  if (entry.code.trim() === "" || entry.baseName.trim() === "") {
    return loadRecentlyViewed();
  }
  const next = [
    entry,
    ...loadRecentlyViewed().filter(
      (e) => e.baseName.toLowerCase() !== entry.baseName.toLowerCase(),
    ),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* full/blocked storage never breaks a product view */
  }
  return next;
}

export function clearRecentlyViewed(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
