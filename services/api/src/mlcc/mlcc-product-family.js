/**
 * MLCC product-line family grouping for scanner size tabs.
 * When brand_family is set, group by brand_family (+ category when present).
 * When brand_family is null/empty, group by normalized name base + category + ADA name.
 */

/** @param {string} s */
export function sanitizeIlikeForFamily(s) {
  return String(s).replace(/%/g, "").replace(/_/g, "");
}

/**
 * Strip trailing size-only tokens; keep (HOL), flavor words, and core line name.
 * @param {string | null | undefined} name
 */
export function normalizeMlccNameBaseForFamily(name) {
  let s = String(name ?? "").trim();
  s = s.replace(/\s+(PT|FTH|LTR|QTR|50ML|375ML|750ML|1000ML|1750ML)$/gi, "");
  s = s.replace(/\s+\d+(?:\.\d+)?\s*ML\s*$/i, "");
  s = s.replace(/\s+\d+(?:\.\d+)?\s*L\s*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Short prefix for a broad name ilike pool (first two words of normalized base).
 * @param {{ name?: string | null }} anchor
 */
export function familyNameSearchPrefix(anchor) {
  const base = normalizeMlccNameBaseForFamily(anchor?.name ?? "");
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]} ${words[1]}`;
  return words[0] ?? "";
}

/**
 * Same family as anchor when name base, category, and ADA name align (brand_family path handled separately).
 * Rows with missing category/ADA when anchor has them are excluded on purpose.
 * @param {Record<string, unknown>} anchor
 * @param {Record<string, unknown>} row
 */
export function rowInSameFamilyAsAnchor(anchor, row) {
  const b1 = normalizeMlccNameBaseForFamily(/** @type {string} */ (anchor.name ?? "")).toLowerCase();
  const b2 = normalizeMlccNameBaseForFamily(/** @type {string} */ (row.name ?? "")).toLowerCase();
  if (!b1 || !b2 || b1 !== b2) return false;

  const c1 = String(anchor.category ?? "").trim();
  const c2 = String(row.category ?? "").trim();
  if (c1 && c2 && c1.toLowerCase() !== c2.toLowerCase()) return false;
  if (c1 && !c2) return false;
  if (!c1 && c2) return false;

  const a1 = String(anchor.ada_name ?? "").trim();
  const a2 = String(row.ada_name ?? "").trim();
  if (a1 && a2 && a1.toLowerCase() !== a2.toLowerCase()) return false;
  if (a1 && !a2) return false;
  if (!a1 && a2) return false;

  return true;
}

/**
 * @param {Record<string, unknown>} anchor
 * @param {Record<string, unknown>[]} rows
 */
export function filterToFamily(anchor, rows) {
  const bf = String(anchor.brand_family ?? "").trim();
  if (bf) {
    const cat = String(anchor.category ?? "").trim();
    return rows.filter((r) => {
      if (String(r.brand_family ?? "").trim() !== bf) return false;
      if (cat) {
        const rc = String(r.category ?? "").trim();
        if (rc !== cat) return false;
      }
      return true;
    });
  }
  return rows.filter((r) => rowInSameFamilyAsAnchor(anchor, r));
}
