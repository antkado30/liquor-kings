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
 * Gift-combo SKU detector (Tony's Casamigos bug, 2026-06-10).
 *
 * MLCC names combo/value-added SKUs with "W/<extra>" segments, e.g.
 *   "CASAMIGOS REPOSADO W/50ML REPO W/"
 *   "CROWN ROYAL W/HOLIDAY BAG W/"
 *   "BLACK VELVET APPLE/50ML PEACH W/"   (slash+digit form)
 *   "REDNECK RIVIERIA/2 MASON JARS W/"
 * These are real, orderable SKUs but they are NOT their own product line —
 * scanning one must still show the base product's full size family.
 * @param {string | null | undefined} name
 */
export function isMlccComboName(name) {
  const s = String(name ?? "");
  return /\sW\//i.test(s) || /\/\s*\d/.test(s);
}

/**
 * Strip trailing size-only tokens; keep (HOL), flavor words, and core line name.
 * Combo "W/..." segments are cut FIRST so a gift-combo SKU normalizes to its
 * base product line ("CASAMIGOS REPOSADO W/50ML REPO W/" → "CASAMIGOS
 * REPOSADO") and groups with the real size family.
 * @param {string | null | undefined} name
 */
export function normalizeMlccNameBaseForFamily(name) {
  let s = String(name ?? "").trim();
  // Cut at the first combo marker: " W/<anything>" or "/<digit><anything>".
  s = s.replace(/\sW\/.*$/i, "");
  s = s.replace(/\/\s*\d.*$/, "");
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
  /*
    Combo exclusion (2026-06-10): gift-combo SKUs ("...W/50ML REPO W/")
    normalize to the same base as the regular bottle, which is what lets a
    combo SCAN open the full size family. But the reverse must not happen —
    a regular Tito's card should NOT grow extra 750ML tabs for every gift
    combo. Combo rows only appear in a family when they ARE the anchor.
  */
  const keepRow = (r) => !isMlccComboName(r?.name) || r?.id === anchor?.id;
  const bf = String(anchor.brand_family ?? "").trim();
  if (bf) {
    const cat = String(anchor.category ?? "").trim();
    return rows.filter((r) => {
      if (!keepRow(r)) return false;
      if (String(r.brand_family ?? "").trim() !== bf) return false;
      if (cat) {
        const rc = String(r.category ?? "").trim();
        if (rc !== cat) return false;
      }
      return true;
    });
  }
  return rows.filter((r) => keepRow(r) && rowInSameFamilyAsAnchor(anchor, r));
}
