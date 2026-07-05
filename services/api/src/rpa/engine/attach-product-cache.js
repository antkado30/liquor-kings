/**
 * attach-product-cache — merge cached MILO productIds onto cart items so the
 * engine can skip per-code /products/code resolves (the per-bottle bottleneck).
 *
 * PURE + defensive. This is a money-path seam: a wrong code→productId match
 * would order the WRONG bottle, so the rules are strict —
 *   - EXACT code match only (string-normalized on both sides).
 *   - attach ONLY when BOTH a non-empty productId AND an object distributor
 *     are present; anything partial/malformed → item passes through untouched
 *     and the engine resolves it live (byte-identical to the un-cached path).
 *   - never throws, never mutates the input items.
 *
 * @param {Array<{code: string|number, quantity: number}>} items  cart items
 * @param {Array<{code: string|number, milo_product_id: string|null, milo_distributor: object|null}>} cacheRows
 *   rows from mlcc_items (code, milo_product_id, milo_distributor)
 * @returns {{ items: Array, hits: number }}
 *   items: same array with `miloProduct: {id, distributor}` added on cache hits;
 *   hits: how many items were pre-mapped.
 */
export function attachMiloProductCache(items, cacheRows) {
  const safeItems = Array.isArray(items) ? items : [];
  const rows = Array.isArray(cacheRows) ? cacheRows : [];

  /** @type {Map<string, {id: string, distributor: object}>} */
  const byCode = new Map();
  for (const r of rows) {
    if (!r || r.code == null) continue;
    const pid = r.milo_product_id;
    const dist = r.milo_distributor;
    if (pid == null || String(pid).trim() === "") continue;
    if (dist == null || typeof dist !== "object" || Array.isArray(dist)) continue;
    byCode.set(String(r.code), { id: String(pid), distributor: dist });
  }

  let hits = 0;
  const merged = safeItems.map((item) => {
    if (!item || item.code == null) return item;
    const cached = byCode.get(String(item.code));
    if (!cached) return item;
    hits += 1;
    return { ...item, miloProduct: cached };
  });

  return { items: merged, hits };
}
