/**
 * "More from this brand" ranking (2026-07-26, TONY-WANTS: design locked
 * via Q&A the same day).
 *
 * Pure functions — the route stays thin and the ranking law stays
 * testable without Supabase:
 *   - Ranking = Tony's hybrid: the all-LK-stores order aggregate
 *     (mlcc_items.ordered_count, bumped by every confirmed LK order —
 *     "Michigan-wide, but collect data from stores to see what actually
 *     is top") with scans as the tiebreak.
 *   - One entry per FAMILY (flavor/variant), never per size; tapping a
 *     row opens that family's full product card client-side.
 *   - Combos, inactive rows, and unkeyed rows are never suggestions.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The family's face: most-ordered size wins, scans break ties, 750ml
 * settles what's left (the shelf-standard size), code keeps it stable.
 */
export function pickRepresentative(members) {
  return [...members].sort(
    (a, b) =>
      num(b.ordered_count) - num(a.ordered_count) ||
      num(b.scan_count) - num(a.scan_count) ||
      (a.bottle_size_ml === 750 ? -1 : 0) - (b.bottle_size_ml === 750 ? -1 : 0) ||
      String(a.code).localeCompare(String(b.code)),
  )[0];
}

/**
 * Group raw catalog rows into suggestion families. Drops the anchor's own
 * family (never suggest what's already open), combos, inactive rows, and
 * rows with no family_key (can't group what has no identity).
 */
export function groupIntoFamilies(rows, { excludeFamilyKey = null } = {}) {
  const byFam = new Map();
  for (const r of rows || []) {
    const key = String(r?.family_key ?? "").trim();
    if (!key) continue;
    if (excludeFamilyKey && key === excludeFamilyKey) continue;
    if (r.is_combo === true) continue;
    if (r.is_active === false) continue;
    if (!byFam.has(key)) byFam.set(key, []);
    byFam.get(key).push(r);
  }
  const families = [];
  for (const [key, members] of byFam.entries()) {
    families.push({
      family_key: key,
      representative: pickRepresentative(members),
      sizes_count: new Set(members.map((m) => String(m.code))).size,
      from_price: members.reduce((min, m) => {
        const p = Number(m.licensee_price);
        if (!Number.isFinite(p) || p <= 0) return min;
        return min == null || p < min ? p : min;
      }, null),
      ordered: members.reduce((s, m) => s + num(m.ordered_count), 0),
      scanned: members.reduce((s, m) => s + num(m.scan_count), 0),
    });
  }
  return families;
}

/** Rank families: LK-fleet orders first, scans tiebreak, name settles. */
export function rankFamilies(families, limit = 6) {
  return [...families]
    .sort(
      (a, b) =>
        b.ordered - a.ordered ||
        b.scanned - a.scanned ||
        String(a.representative?.name ?? "").localeCompare(
          String(b.representative?.name ?? ""),
        ),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * Price band for the thin-brand fallback: same kind, similar money
 * ("if you're buying this, these move too"). No anchor price → no band
 * (never guess with money).
 */
export function priceBandFor(anchorPrice) {
  const p = Number(anchorPrice);
  if (!Number.isFinite(p) || p <= 0) return null;
  return { min: Math.max(1, p * 0.5), max: p * 2 };
}

/**
 * Brand prefixes from a raw MLCC name (2026-07-26, the Jim Beam finding:
 * brand_family is NULL for most of the catalog - the ingestor only
 * preserves it, nothing populates it). MLCC names lead with the brand
 * ("JIM BEAM PL", "SKYY INFUSION CITRUS"), so leading-token prefixes
 * recover the lineup: try the two-token prefix first ("JIM BEAM"), fall
 * back to one token ("SKYY") when the brand is a single word. Tokens
 * under 3 chars are too generic to trust alone.
 */
export function brandPrefixesFor(name) {
  const tokens = String(name ?? "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  if (tokens.length >= 2) out.push(`${tokens[0]} ${tokens[1]}`);
  if (tokens[0] && tokens[0].length >= 3 && !out.includes(tokens[0])) {
    out.push(tokens[0]);
  }
  return out;
}

/** Escape ILIKE wildcards so a name like "100% AGAVE" can never glob. */
export function escapeIlike(s) {
  return String(s).replace(/[\\%_]/g, (m) => `\\${m}`);
}
