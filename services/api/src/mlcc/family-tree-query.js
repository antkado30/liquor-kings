/**
 * family-tree-query — pure helpers for the /items/:code/family endpoint's
 * family_key fast path (wiring phase of docs/lk/catalog-family-tree-plan.md,
 * 2026-07-11).
 *
 * The 7/1 engine (family-key.js) computed + backfilled family_key /
 * container / pack_count / is_combo for all 13,828 prod rows and was
 * audit-validated (0 over-merges, 644 orphans healed). These helpers turn
 * those columns into the family tree the ProductCard renders, replacing
 * the legacy per-tap ILIKE pool + JS filter (slow, ADA-split, 500-row cap,
 * duplicate size rows — root causes #3/#4/#5 in the plan).
 *
 * All functions are PURE (no I/O) so they unit-test hard. The route owns
 * the queries; this owns the decisions.
 *
 * Policy encoded here (decided with Tony 2026-07-01):
 * - ONE family per product line; ADA does NOT split families.
 * - One entry per CODE — the same code under 2+ ADAs collapses to a
 *   single chip (ordering downstream still resolves code+ADA itself).
 * - Combos join a tree ONLY as the anchor (scan a gift pack → see the
 *   real family; view a regular bottle → gift packs don't clutter it).
 * - Truncated-combo fallback adopts a longer key ONLY when exactly one
 *   candidate exists — an ambiguous guess risks a false merge, the one
 *   failure mode worse than a split (zero tolerance, plan §safety).
 */

/**
 * Escape a string for use inside a PostgREST/SQL LIKE pattern so it
 * matches literally: backslash first, then % and _.
 * @param {string} s
 * @returns {string}
 */
export function escapeLikePattern(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/**
 * Minimum anchor-key length before the truncated-combo prefix fallback
 * may even be attempted ("TITO'S HAN…" yes, "E&J" no — short keys would
 * prefix-match half the catalog).
 */
export const COMBO_PREFIX_FALLBACK_MIN_LEN = 10;

/**
 * Truncated-combo fallback key selection. MLCC truncates long combo
 * names ("TITO'S HANDMADE VODK/50ML …"), so the combo's computed key is
 * a PREFIX of the real family key. Given the distinct non-combo keys
 * that start with the anchor's key, adopt the real family ONLY when the
 * evidence is unambiguous:
 *   - anchor key is at least COMBO_PREFIX_FALLBACK_MIN_LEN chars, AND
 *   - exactly ONE distinct candidate key exists (after dropping the
 *     anchor's own key).
 * Anything else → null (stay a singleton; honest beats guessed).
 *
 * @param {string} anchorKey
 * @param {Array<string|null|undefined>} candidateKeys distinct or not — deduped here
 * @returns {string|null}
 */
export function pickComboPrefixFallbackKey(anchorKey, candidateKeys) {
  const key = String(anchorKey ?? "").trim();
  if (key.length < COMBO_PREFIX_FALLBACK_MIN_LEN) return null;
  const distinct = new Set();
  for (const raw of candidateKeys ?? []) {
    const c = typeof raw === "string" ? raw.trim() : "";
    if (!c || c === key) continue;
    if (!c.startsWith(key)) continue; // defense: caller's LIKE should already guarantee this
    distinct.add(c);
  }
  if (distinct.size !== 1) return null;
  return [...distinct][0];
}

/**
 * Assemble the family members from the anchor row + the rows fetched by
 * family_key (+category). Applies, in order:
 *   1. Anchor always belongs (even if inactive or a combo) and wins the
 *      dedupe for its own code.
 *   2. Non-anchor COMBO rows are dropped (anchor-only combo policy).
 *   3. One entry per CODE — lowest ada_number wins for determinism when
 *      the same code exists under multiple ADAs (plan root-cause #4:
 *      duplicate size chips).
 *   4. Sorted by bottle_size_ml ascending (parity with the legacy path).
 *
 * @param {{ code?: unknown, is_combo?: unknown }} anchor full mlcc_items row
 * @param {Array<{ code?: unknown, ada_number?: unknown, is_combo?: unknown, bottle_size_ml?: unknown }>} rows
 * @returns {object[]} deduped, sorted member rows (anchor included)
 */
export function familyMembersFromRows(anchor, rows) {
  const anchorCode = String(anchor?.code ?? "").trim();
  /** @type {Map<string, object>} */
  const byCode = new Map();

  /*
    The anchor ROW is seated first and is untouchable: rows from the
    fetch are never "the anchor" just because they share its code — a
    same-code twin under another ADA is a different row, and letting it
    displace the anchor was the bug Tony's test run caught on
    2026-07-11 ("anchor row wins the dedupe" red). Identity ≠ code.
  */
  if (anchor && anchorCode) byCode.set(anchorCode, anchor);

  for (const row of rows ?? []) {
    const code = String(row?.code ?? "").trim();
    if (!code) continue;
    if (row?.is_combo === true) continue; // combos join only as the anchor (already seated)
    if (code === anchorCode) continue; // the anchor's code is settled — twins never displace it
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, row);
      continue;
    }
    // Same code under multiple ADAs → lowest ada_number wins, numerically
    // when both parse (141 < 321), lexicographically otherwise.
    const a = String(existing?.ada_number ?? "").trim();
    const b = String(row?.ada_number ?? "").trim();
    if (b === "") continue;
    const aNum = Number(a);
    const bNum = Number(b);
    const bWins =
      a === "" ||
      (Number.isFinite(aNum) && Number.isFinite(bNum) ? bNum < aNum : b < a);
    if (bWins) byCode.set(code, row);
  }

  return [...byCode.values()].sort(
    (a, b) => (Number(a?.bottle_size_ml) || 0) - (Number(b?.bottle_size_ml) || 0),
  );
}

/**
 * True when the family spans more than one container material. Drives
 * the Tony rule: a size sold in both glass and plastic renders as TWO
 * labeled chips — the label is NEVER hidden in a mixed family (his fear:
 * ordering glass, receiving plastic).
 *
 * NULL/missing container is treated as "glass" — the engine's default;
 * rows written before the engine simply weren't marked.
 *
 * @param {Array<{ container?: unknown }>} members
 * @returns {boolean}
 */
export function familyHasMixedContainers(members) {
  const materials = new Set();
  for (const m of members ?? []) {
    const c = typeof m?.container === "string" && m.container.trim() !== ""
      ? m.container.trim().toLowerCase()
      : "glass";
    materials.add(c);
    if (materials.size > 1) return true;
  }
  return false;
}

/**
 * Grouped search (plan §C, wired 2026-07-11): collapse relevance-ordered
 * search rows into family cards — "search 'tito' → ONE card, all sizes"
 * (the competitor's UX bar, done on OUR precomputed key).
 *
 * Rules:
 * - Group identity = family_key + category (same pair the tree endpoint
 *   uses — ~20 keys legitimately span 2 categories).
 * - Rows with NO family_key (pre-engine ingest) become singleton groups
 *   keyed by code — never silently dropped.
 * - COMBO rows always form their OWN singleton card (real name, own
 *   price): folding a gift pack into the base family card would make it
 *   unreachable, because the tree only shows a combo when it's the
 *   anchor. Tapping the combo card anchors the tree AT the combo.
 * - Input order is relevance order; groups keep the order of their
 *   first-seen row, and that first row is the group's representative
 *   (drives the thumbnail + the tap-through anchor).
 * - Price range over licensee_price (nulls ignored); sizeCount counts
 *   DISTINCT codes (one code = one chip in the tree after its dedupe).
 *
 * @param {Array<object>} rows relevance-ordered mlcc_items rows
 * @returns {Array<{
 *   familyKey: string, category: string|null, baseName: string,
 *   sizeCount: number, minPrice: number|null, maxPrice: number|null,
 *   mixedContainers: boolean, isCombo: boolean, representative: object,
 * }>}
 */
export function groupRowsIntoFamilies(rows) {
  /** @type {Map<string, { key: string, members: object[], combo: boolean }>} */
  const groups = new Map();

  for (const row of rows ?? []) {
    const code = String(row?.code ?? "").trim();
    if (!code) continue;
    const familyKey = String(row?.family_key ?? "").trim();
    const category = String(row?.category ?? "").trim();
    const isCombo = row?.is_combo === true;

    const groupId = isCombo
      ? `combo:${code}`
      : familyKey
        ? `fam:${familyKey}|${category}`
        : `code:${code}|${category}`;

    const existing = groups.get(groupId);
    if (existing) {
      existing.members.push(row);
    } else {
      groups.set(groupId, { key: familyKey, members: [row], combo: isCombo });
    }
  }

  const out = [];
  for (const g of groups.values()) {
    const rep = g.members[0];
    const codes = new Set();
    let minPrice = null;
    let maxPrice = null;
    // Distinct size labels, kept with their ml so we can order small→large
    // for the catalog card chips (2026-07-12 design pass). Combos are
    // singletons whose "size" is really the pack — no chips for them.
    const sizeByLabel = new Map(); // label -> ml (for sort)
    for (const m of g.members) {
      codes.add(String(m?.code ?? "").trim());
      if (!g.combo) {
        const ml = typeof m?.bottle_size_ml === "number" ? m.bottle_size_ml : null;
        const label =
          (typeof m?.bottle_size_label === "string" && m.bottle_size_label.trim()) ||
          (ml != null ? `${ml} ML` : "");
        if (label && !sizeByLabel.has(label)) sizeByLabel.set(label, ml ?? Infinity);
      }
      // Strict number check — Number(null) is 0 and 0 is "finite", so a
      // loose coercion would quietly turn a missing price into "$0.00"
      // on the card (caught by the unit suite 2026-07-11). A null price
      // contributes NOTHING to the range; it never invents a dollar value.
      const p = m?.licensee_price;
      if (typeof p === "number" && Number.isFinite(p)) {
        if (minPrice === null || p < minPrice) minPrice = p;
        if (maxPrice === null || p > maxPrice) maxPrice = p;
      }
    }
    const sizes = [...sizeByLabel.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([label]) => label);
    out.push({
      familyKey: g.key,
      category: String(rep?.category ?? "").trim() || null,
      // Combo cards show their real (full) name; family cards show the
      // clean normalized base — same convention as the tree's baseName.
      baseName: g.combo
        ? String(rep?.name ?? "")
        : g.key || String(rep?.name ?? ""),
      sizeCount: codes.size,
      sizes,
      minPrice,
      maxPrice,
      mixedContainers: g.combo ? false : familyHasMixedContainers(g.members),
      isCombo: g.combo,
      representative: rep,
    });
  }
  return out;
}
