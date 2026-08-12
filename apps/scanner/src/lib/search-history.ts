/**
 * Search history (2026-08-10, Tony: "i need a clear button wherever we
 * search something and a history of what we searched").
 *
 * One shared memory for every search box. Recorded at HIGH-SIGNAL
 * moments only (the caller decides — typically when a search leads to
 * a tap/add, not on every keystroke), deduped case-insensitively,
 * most-recent first, capped. localStorage per device, same scoping as
 * the cart.
 */

const KEY = "lk-search-history-v1";
const MAX = 8;

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAX);
  } catch {
    return [];
  }
}

export function recordSearch(query: string): string[] {
  const q = query.trim();
  if (q.length < 2) return loadSearchHistory();
  const next = [
    q,
    ...loadSearchHistory().filter((h) => h.toLowerCase() !== q.toLowerCase()),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* full/blocked storage never breaks search */
  }
  return next;
}

export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
