/**
 * NRS POS export → upc_mappings importer.
 *
 * Two-tier matching pipeline:
 *
 * TIER 1 (direct UPC match): For each Liquor row, look up mlcc_items.upc.
 * Yields little on a fresh catalog because MLCC's price book doesn't include
 * UPCs natively — but instantly maps any UPC that's been confirmed by prior
 * customer scans or UPCitemdb caching.
 *
 * TIER 2 (name + size + brand fuzzy match): For unmatched rows, extract size
 * from the product name (the NRS `size` column is unreliable), find candidate
 * mlcc_items at that exact size, score by brand-token overlap with penalties
 * for gift packs / promos / limited editions / flavor variants when the NRS
 * name doesn't mention a flavor. Auto-confirm when there's a clear winner.
 * Queue ambiguous matches for review (Phase 2C: review UI, future session).
 *
 * Both tiers write to upc_mappings with confidence_source set so we can audit
 * which path each mapping came from.
 *
 * Token expansion for Tier 2 scoring (added 2026-05-08):
 * The scoring engine now mirrors the unified token-AND search in
 * price-book.routes.js. Each NRS token expands via three layers:
 *   1. The literal token
 *   2. Brand aliases from BRAND_ALIAS_MAP (e.g. stoli ↔ stolichnaya, vanilla ↔ vanil)
 *   3. Auto-prefix shortening for tokens 6+ chars (catches MLCC truncations
 *      we haven't manually aliased — "vanilla" tries "vanill" and "vanil")
 * A token "matches" an MLCC item when ANY of its variants appears in the
 * MLCC name. This recovers the hundreds of NRS rows that didn't match
 * before because MLCC stores names like "STOLICHNAYA VANIL" without the
 * full word.
 */

import { resolveSearchAliases } from "../mlcc/mlcc-brand-aliases.js";

const NRS_UPC_RE = /^="(.*)"$/;
const BATCH_SIZE = 100;

// Tier 2 scoring constants
const SCORE_BRAND_TOKEN_MATCH = 25;     // per matching brand/key token
const SCORE_ALL_TOKENS_PRESENT = 20;     // bonus when EVERY NRS token appears in MLCC name
const PENALTY_GIFT_PROMO = 60;           // gift packs, promos, limited editions
const PENALTY_FLAVOR_MISMATCH = 35;      // MLCC has flavor word, NRS doesn't
const PENALTY_LONG_NAME = 0.4;           // per character — slight preference for shorter (canonical) names
const TIER2_AUTO_CONFIRM_THRESHOLD = 60; // top score to auto-confirm
const TIER2_AUTO_CONFIRM_LEAD = 20;      // top must beat second by this many points

/** Patterns that indicate a non-canonical SKU (gift packs, limited editions, etc). */
const GIFT_PROMO_RE = /\bW\/|\bGIFT\b|\bPROMO\b|\bDECANTER\b|\bHERITAGE\b|\bLIMITED\b|\bLTD\b|\bWFS\b|\bGLS\b|\bSEQUIN\b|\bRTS\b/i;

/** Flavor / variant keywords commonly seen in MLCC product names. */
const FLAVOR_RE = /\b(APPLE|HONEY|CHERRY|VANILLA|VANILIA|COCONUT|PEACH|MANGO|LEMON|LIME|BERRY|MELON|ORANGE|CITRUS|RASPBERRI?Y?|STRAWBERRY|GRAPE|PINEAPPLE|WATERMELON|CINNAMON|CARAMEL|GINGER|CUCUMBER|PEPPER|PEPPAR|MOJITO|MARGARITA|TABASCO|JALAPENO)\b/i;

/**
 * Words to strip when normalizing brand tokens.
 *
 * IMPORTANT — asymmetry vs. price-book.routes.js SEARCH_STOP_WORDS:
 * The interactive search drops liquor TYPE words (vodka, rum, gin, etc.)
 * because user queries often include them while MLCC names don't, and a
 * forced match would zero the result set. NRS scoring is the OPPOSITE
 * problem: NRS export AND MLCC catalog both routinely include the type
 * word, so dropping it costs both sides a +25 per-token-match contribution
 * (verified on 2026-05-08 import: dropping type words regressed
 * tier2NameSizeMatches from 4,169 to 3,810). Keep the strip set tight here.
 */
const STRIP_TOKENS = new Set([
  "ml", "l", "oz", "pk", "pack", "the", "of", "and", "with", "w",
  "pl", "plastic", "bottle", "bottles", "case", "single", "sgl",
]);

/**
 * Expand a single brand/name token into all variants that should count as a
 * match against an MLCC item. Mirrors `expandTokenForSearch` in
 * price-book.routes.js so NRS scoring uses the same token-equivalence rules
 * the search bar does.
 *
 * Three layers:
 *   1. The literal token (always)
 *   2. Brand aliases from BRAND_ALIAS_MAP via resolveSearchAliases
 *      (e.g. "stolichnaya" → "stoli", "vanilla" → "vanil"/"vanilia")
 *   3. Auto-prefix shortening for tokens 6+ chars long: also try the first
 *      N-1 and N-2 chars (≥4 floor). Catches MLCC truncations we haven't
 *      manually aliased ("smirnoff" → "smirnof", "smirno").
 *
 * Returns lowercase variants. Caller compares against lowercased MLCC tokens
 * / name. Empty array if the token sanitizes away.
 */
function expandTokenForMatch(token) {
  const base = String(token ?? "").trim().toLowerCase();
  if (!base) return [];
  const variants = new Set();
  variants.add(base);

  // Layer 1 — explicit aliases (resolveSearchAliases takes a normalized term
  // and returns variants with each known common phrase swapped for its MLCC
  // equivalent — and vice-versa, since both directions of every pair are in
  // the map.)
  for (const aliasV of resolveSearchAliases(base)) {
    const v = String(aliasV ?? "").trim().toLowerCase();
    if (v) variants.add(v);
  }

  // Layer 2 — auto-prefix shortening for 6+-char tokens (≥4 floor)
  if (base.length >= 6) {
    for (const cut of [1, 2]) {
      const prefix = base.slice(0, base.length - cut);
      if (prefix.length >= 4) variants.add(prefix);
    }
  }

  return Array.from(variants);
}

/**
 * Strip the Excel formula wrapping NRS uses to preserve leading zeros on UPCs.
 * Examples:
 *   "=""200001000003"""  →  "200001000003"
 *   "200001000003"       →  "200001000003"  (already clean)
 */
export function cleanNrsUpc(rawUpc) {
  if (rawUpc == null) return "";
  let value = String(rawUpc).trim();
  // Excel formula form: ="..."
  const match = value.match(NRS_UPC_RE);
  if (match) value = match[1];
  // Strip any quotes / whitespace that survived
  value = value.replace(/^"|"$/g, "").trim();
  // UPCs are numeric only; reject anything else
  if (!/^\d+$/.test(value)) return "";
  return value;
}

/**
 * Minimal CSV parser that handles RFC-4180 style quoting (NRS uses standard CSV
 * with quoted fields containing commas). Returns array of arrays (rows of cells).
 *
 * We don't pull in a CSV library because (a) we control the format and (b)
 * the NRS export is well-behaved standard CSV.
 */
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      cells.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  cells.push(cur);
  return cells;
}

/**
 * Parse NRS CSV text into an array of liquor-only rows with cleaned UPCs.
 * Returns: [{ upc, name, department, sizeColumn, priceCents }, ...]
 *
 * Side effects: counts skipped rows by reason for the report.
 */
export function parseNrsCsv(csvText) {
  const lines = String(csvText).split(/\r?\n/);
  if (lines.length === 0) {
    return { liquorRows: [], stats: { totalLines: 0, headerFound: false } };
  }

  const header = parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  const idx = {
    upc: header.indexOf("upc"),
    department: header.indexOf("department"),
    name: header.indexOf("name"),
    size: header.indexOf("size"),
    cents: header.indexOf("cents"),
  };

  if (idx.upc === -1 || idx.department === -1 || idx.name === -1) {
    return {
      liquorRows: [],
      stats: {
        totalLines: lines.length,
        headerFound: false,
        error:
          "Required columns missing (Upc / Department / Name). Header was: " +
          header.join(", "),
      },
    };
  }

  const liquorRows = [];
  const stats = {
    totalLines: lines.length - 1,
    nonLiquor: 0,
    emptyOrInvalidUpc: 0,
    parseErrors: 0,
  };

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    let cells;
    try {
      cells = parseCsvLine(line);
    } catch {
      stats.parseErrors += 1;
      continue;
    }
    const department = (cells[idx.department] || "").trim();
    if (department.toLowerCase() !== "liquor") {
      stats.nonLiquor += 1;
      continue;
    }
    const upc = cleanNrsUpc(cells[idx.upc]);
    if (!upc || upc.length < 8) {
      stats.emptyOrInvalidUpc += 1;
      continue;
    }
    liquorRows.push({
      upc,
      name: (cells[idx.name] || "").trim(),
      department,
      sizeColumn: idx.size >= 0 ? (cells[idx.size] || "").trim() : "",
      priceCents:
        idx.cents >= 0 && cells[idx.cents] ? Number(cells[idx.cents]) : null,
    });
  }

  return { liquorRows, stats };
}

/**
 * Extract bottle size in milliliters from a product name.
 *
 * Handles common formats:
 *   "750ML" / "750 ML" / "750 mL" → 750
 *   "1.75L" / "1.75 L" / "1750 ML" → 1750
 *   "1L" / "1 L" / "1000 ML" → 1000
 *   "375 ML" → 375
 *
 * Multi-pack indicators (e.g. "12PK 50ML") return null — those are non-standard
 * SKUs we don't want to auto-confirm. Tier 2 review can handle them later.
 *
 * Returns size_ml integer or null if no clean size could be extracted.
 */
export function extractSizeFromName(name) {
  if (!name) return null;
  const upper = String(name).toUpperCase();
  // Reject multi-packs — different SKU class
  if (/\b\d+\s*P[KP]\b|\b\d+\s*PACK\b/i.test(upper)) return null;
  // Try liter form first ("1.75L", "1L", "0.75L")
  const lMatch = upper.match(/(\d+(?:\.\d+)?)\s*L\b/);
  if (lMatch) {
    const liters = Number(lMatch[1]);
    if (Number.isFinite(liters) && liters > 0 && liters < 10) {
      return Math.round(liters * 1000);
    }
  }
  // Try ml form ("750 ML", "200ML", "50 ML")
  const mlMatch = upper.match(/(\d+)\s*ML\b/);
  if (mlMatch) {
    const ml = Number(mlMatch[1]);
    if (Number.isFinite(ml) && ml > 0 && ml < 10000) return ml;
  }
  return null;
}

/**
 * Tokenize a product name into brand/variant tokens we can match against.
 * Strips size markers, common stop-words, and punctuation. Lowercases.
 *
 * "SMIRNOFF 80 PL 200 ML" → ["smirnoff", "80"]
 * "DETROIT CITY HARDHEAD GIN 750ML" → ["detroit", "city", "hardhead", "gin"]
 */
export function tokenizeName(name) {
  if (!name) return [];
  return String(name)
    .toLowerCase()
    .replace(/\d+\s*ml\b/gi, "")
    .replace(/\d+(?:\.\d+)?\s*l\b/gi, "")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => !STRIP_TOKENS.has(t))
    // drop pure-numeric junk under 2 digits but keep proof numbers like "80", "100"
    .filter((t) => !/^\d$/.test(t));
}

/**
 * Score how well an MLCC item matches a tokenized NRS query.
 * Higher = better match. Returns {score, reasons[]}.
 *
 * Token matching uses the unified expansion rule shared with search:
 * each NRS token expands via aliases + auto-prefix, and the token counts as
 * matched if ANY variant appears in the MLCC name (substring) OR the
 * MLCC tokens (exact). This bridges MLCC truncations like
 * VANILLA→VANIL, RASPBERRY→RASPBERRI, MANDARIN→MANDRIN that the old
 * exact-match scorer missed.
 */
function scoreMlccCandidate(nrsTokens, nrsHasFlavor, mlccItem) {
  const mlccName = String(mlccItem.name || "");
  const mlccTokens = tokenizeName(mlccName);
  const mlccLower = mlccName.toLowerCase();
  const reasons = [];
  let score = 0;

  // Per-token brand match: every NRS token (or any of its alias / auto-prefix
  // variants) that appears in MLCC name counts as 1 match.
  let matched = 0;
  for (const tok of nrsTokens) {
    const variants = expandTokenForMatch(tok);
    let hit = false;
    for (const v of variants) {
      if (mlccTokens.includes(v) || mlccLower.includes(v)) {
        hit = true;
        break;
      }
    }
    if (hit) matched += 1;
  }
  score += matched * SCORE_BRAND_TOKEN_MATCH;
  if (matched > 0) reasons.push(`token_match:${matched}/${nrsTokens.length}`);

  // Bonus when ALL NRS tokens are present
  if (nrsTokens.length > 0 && matched === nrsTokens.length) {
    score += SCORE_ALL_TOKENS_PRESENT;
    reasons.push("all_tokens_present");
  }

  // Penalty for gift packs, limited editions, promos
  if (GIFT_PROMO_RE.test(mlccName)) {
    score -= PENALTY_GIFT_PROMO;
    reasons.push("penalty:gift_promo");
  }

  // Penalty: MLCC has flavor word, NRS doesn't
  const mlccHasFlavor = FLAVOR_RE.test(mlccName);
  if (mlccHasFlavor && !nrsHasFlavor) {
    score -= PENALTY_FLAVOR_MISMATCH;
    reasons.push("penalty:flavor_mismatch");
  }

  // Slight penalty for longer names (prefer canonical short names)
  score -= mlccName.length * PENALTY_LONG_NAME;

  return { score, reasons };
}

/**
 * Try to match an NRS row against MLCC catalog using name + size + brand.
 *
 * @param {object} nrsRow {upc, name, ...}
 * @param {object[]} mlccBySize Map of size_ml → array of mlcc_items at that size
 * @returns {object} { tier: 1|2|3, mlccCode?, score?, candidates?, reason }
 */
function matchByNameAndSize(nrsRow, mlccBySize) {
  const sizeMl = extractSizeFromName(nrsRow.name);
  if (sizeMl == null) {
    return { tier: 3, reason: "no_size_extractable_from_name" };
  }
  const candidates = mlccBySize.get(sizeMl);
  if (!candidates || candidates.length === 0) {
    return { tier: 3, reason: `no_mlcc_items_at_size_${sizeMl}ml` };
  }

  const nrsTokens = tokenizeName(nrsRow.name);
  if (nrsTokens.length === 0) {
    return { tier: 3, reason: "no_brand_tokens_extracted" };
  }
  const nrsHasFlavor = FLAVOR_RE.test(nrsRow.name);

  // Score every candidate at the matching size
  const scored = candidates
    .map((c) => ({
      mlccItem: c,
      ...scoreMlccCandidate(nrsTokens, nrsHasFlavor, c),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { tier: 3, reason: "all_candidates_scored_zero_or_lower" };
  }

  const top = scored[0];
  const second = scored[1] ?? null;
  const lead = second ? top.score - second.score : Infinity;

  if (top.score >= TIER2_AUTO_CONFIRM_THRESHOLD && lead >= TIER2_AUTO_CONFIRM_LEAD) {
    return {
      tier: 1,
      mlccCode: String(top.mlccItem.code),
      mlccName: top.mlccItem.name,
      score: Math.round(top.score),
      lead: Math.round(lead),
      reasons: top.reasons,
    };
  }

  if (top.score >= TIER2_AUTO_CONFIRM_THRESHOLD) {
    return {
      tier: 2,
      reason: "ambiguous_top_candidates",
      topThree: scored.slice(0, 3).map((s) => ({
        code: String(s.mlccItem.code),
        name: s.mlccItem.name,
        score: Math.round(s.score),
      })),
    };
  }

  return {
    tier: 3,
    reason: `top_score_${Math.round(top.score)}_below_threshold_${TIER2_AUTO_CONFIRM_THRESHOLD}`,
  };
}

/**
 * Load all mlcc_items into memory grouped by size_ml.
 * 13,828 rows × ~200 bytes each ≈ 2.5MB — trivial.
 * One DB roundtrip beats 9,378 per-row queries by orders of magnitude.
 *
 * IMPORTANT: PostgREST has a hard server-side max of 1000 rows per request,
 * regardless of `range`. We must page in 1000-row chunks until we get back
 * fewer than 1000 (the natural last-page signal).
 */
async function loadAllMlccItemsBySize(supabase) {
  const PAGE = 1000;
  let allRows = [];
  let from = 0;
  let pageCount = 0;
  const MAX_PAGES = 200; // safety: 200,000 rows max — way past current ~13.8K
  while (pageCount < MAX_PAGES) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("id, code, name, size_ml, ada_number")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`mlcc_items load failed at offset ${from}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE) break; // last page — got fewer than full
    from += PAGE;
    pageCount += 1;
  }
  const bySize = new Map();
  for (const row of allRows) {
    const size = Number(row.size_ml);
    if (!Number.isFinite(size) || size <= 0) continue;
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(row);
  }
  return { bySize, totalLoaded: allRows.length };
}

/**
 * For a batch of NRS UPCs, find which ones already exist in mlcc_items.upc.
 * Returns Map<upc, mlccItem>.
 */
async function findMlccItemsByUpcBatch(supabase, upcs) {
  if (upcs.length === 0) return new Map();
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("id, code, name, size_ml, ada_number, upc")
    .in("upc", upcs);
  if (error) {
    throw new Error(`mlcc_items batch lookup failed: ${error.message}`);
  }
  const byUpc = new Map();
  for (const row of data ?? []) {
    if (row.upc) byUpc.set(String(row.upc), row);
  }
  return byUpc;
}

/**
 * Pull the underlying cause chain off a thrown error. Node's fetch wraps
 * network failures as `TypeError: fetch failed` with the real cause on
 * `error.cause` (e.g. ECONNRESET, ETIMEDOUT). The Supabase client surfaces
 * this as an opaque message — we want the cause too.
 */
function describeError(e) {
  if (!e) return "unknown_error";
  const parts = [];
  parts.push(e.message ?? String(e));
  if (e.code) parts.push(`code=${e.code}`);
  if (e.cause) {
    const c = e.cause;
    parts.push(`cause=${c.message ?? String(c)}`);
    if (c.code) parts.push(`cause.code=${c.code}`);
    if (c.errno) parts.push(`cause.errno=${c.errno}`);
    if (c.syscall) parts.push(`cause.syscall=${c.syscall}`);
  }
  return parts.join(" | ");
}

/**
 * Attempt a chunk upsert; on failure, fall back to per-row upserts so a single
 * problematic row can't take down the whole batch. Returns counts + structured
 * error list.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Array<{upc:string,mlcc_code:string,confidence_source:string,confirmed_by:string|null}>} chunk
 */
async function tryUpsertChunkWithFallback(supabase, chunk) {
  const errors = [];
  let succeeded = 0;
  let failed = 0;

  // First try: upsert the whole chunk
  try {
    const { error } = await supabase
      .from("upc_mappings")
      .upsert(chunk, { onConflict: "upc" });
    if (!error) {
      return { succeeded: chunk.length, failed: 0, errors: [] };
    }
    errors.push({
      mode: "chunk",
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
      code: error.code ?? null,
    });
  } catch (e) {
    errors.push({ mode: "chunk", message: describeError(e) });
  }

  // Fall back: per-row writes so one bad row doesn't kill the rest
  for (const row of chunk) {
    try {
      const { error } = await supabase
        .from("upc_mappings")
        .upsert([row], { onConflict: "upc" });
      if (error) {
        failed += 1;
        errors.push({
          mode: "row",
          upc: row.upc,
          mlcc_code: row.mlcc_code,
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
          code: error.code ?? null,
        });
      } else {
        succeeded += 1;
      }
    } catch (e) {
      failed += 1;
      errors.push({
        mode: "row",
        upc: row.upc,
        mlcc_code: row.mlcc_code,
        message: describeError(e),
      });
    }
  }
  return { succeeded, failed, errors };
}

/**
 * For a batch of UPCs, find which ones already have an authoritative
 * upc_mappings row (so we don't pointlessly write duplicates).
 * Returns Set<upc>.
 */
async function findExistingUpcMappingsBatch(supabase, upcs) {
  if (upcs.length === 0) return new Set();
  const { data, error } = await supabase
    .from("upc_mappings")
    .select("upc")
    .in("upc", upcs);
  if (error) {
    throw new Error(`upc_mappings batch lookup failed: ${error.message}`);
  }
  const existing = new Set();
  for (const row of data ?? []) {
    if (row.upc) existing.add(String(row.upc));
  }
  return existing;
}

/**
 * Top-level NRS bulk import runner. Phase 2A scope: Tier 1 direct UPC matches only.
 *
 * @param {object} supabase Supabase client (service role)
 * @param {string} csvText  Full NRS CSV text
 * @param {object} options
 * @param {boolean} [options.dryRun] If true, don't write upc_mappings — just report what WOULD happen
 * @param {string} [options.confirmedBy] Optional user id for confirmed_by column
 * @returns Report object
 */
export async function runNrsImport(supabase, csvText, options = {}) {
  const dryRun = options.dryRun === true;
  const confirmedBy = options.confirmedBy ?? "nrs_import";
  const startedAt = new Date().toISOString();

  const { liquorRows, stats } = parseNrsCsv(csvText);

  if (stats.error) {
    return {
      ok: false,
      error: stats.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const report = {
    startedAt,
    finishedAt: null,
    dryRun,
    parse: {
      totalLines: stats.totalLines,
      nonLiquorRows: stats.nonLiquor,
      emptyOrInvalidUpc: stats.emptyOrInvalidUpc,
      parseErrors: stats.parseErrors,
      liquorRowCount: liquorRows.length,
    },
    matching: {
      duplicatesInExport: 0,
      directUpcMatches: 0,
      alreadyMappedSkipped: 0,
      tier2NameSizeMatches: 0,
      tier2Ambiguous: 0,
      tier3NoMatch: 0,
    },
    write: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      writeErrors: [],
    },
    needsReview: 0,
    sampleAutoConfirmedTier2: [],
    sampleAmbiguous: [],
    sampleSkipped: [],
  };

  // De-duplicate UPCs within the export (NRS sometimes has same UPC twice with
  // different names — we just need the UPC for direct matching).
  const seenUpcs = new Set();
  const dedupedRows = [];
  for (const row of liquorRows) {
    if (seenUpcs.has(row.upc)) {
      report.matching.duplicatesInExport += 1;
      continue;
    }
    seenUpcs.add(row.upc);
    dedupedRows.push(row);
  }

  // ---- TIER 1: direct UPC match in batches of 100
  // Track which rows didn't match by direct UPC so Tier 2 can attempt name+size match.
  const tier2Candidates = [];
  for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + BATCH_SIZE);
    const upcs = batch.map((r) => r.upc);

    const [byUpc, alreadyMapped] = await Promise.all([
      findMlccItemsByUpcBatch(supabase, upcs),
      findExistingUpcMappingsBatch(supabase, upcs),
    ]);

    const insertRows = [];
    for (const row of batch) {
      const mlccItem = byUpc.get(row.upc);
      if (!mlccItem) {
        // No direct UPC match — defer to Tier 2 (name + size + brand)
        tier2Candidates.push(row);
        continue;
      }
      report.matching.directUpcMatches += 1;
      if (alreadyMapped.has(row.upc)) {
        report.matching.alreadyMappedSkipped += 1;
        continue;
      }
      insertRows.push({
        upc: row.upc,
        mlcc_code: String(mlccItem.code),
        confidence_source: "nrs_import_direct_upc",
        confirmed_by: confirmedBy,
      });
    }

    if (insertRows.length > 0 && !dryRun) {
      report.write.attempted += insertRows.length;
      const { error: insertErr } = await supabase
        .from("upc_mappings")
        .upsert(insertRows, { onConflict: "upc" });
      if (insertErr) {
        report.write.failed += insertRows.length;
        report.write.writeErrors.push({
          phase: "tier1",
          batch: i / BATCH_SIZE,
          message: insertErr.message,
        });
      } else {
        report.write.succeeded += insertRows.length;
      }
    } else if (insertRows.length > 0 && dryRun) {
      report.write.attempted += insertRows.length;
      report.write.succeeded += insertRows.length;
    }
  }

  // ---- TIER 2: name + size + brand fuzzy match for everything Tier 1 missed
  // Load ALL mlcc_items into memory once, group by size_ml. ~13.8K rows is trivial.
  let mlccBySize;
  try {
    const loaded = await loadAllMlccItemsBySize(supabase);
    mlccBySize = loaded.bySize;
    report.matching.mlccCatalogLoaded = loaded.totalLoaded;
  } catch (e) {
    report.write.writeErrors.push({
      phase: "tier2_load",
      message: e instanceof Error ? e.message : String(e),
    });
    mlccBySize = new Map();
  }

  // Pre-fetch which Tier 2 UPCs are already mapped so we don't overwrite blindly.
  // Batch in chunks of BATCH_SIZE — PostgREST IN (...) URLs blow past length
  // limits past ~200 entries. Merge results into one Set.
  const tier2Upcs = tier2Candidates.map((r) => r.upc);
  const tier2AlreadyMapped = new Set();
  for (let i = 0; i < tier2Upcs.length; i += BATCH_SIZE) {
    const slice = tier2Upcs.slice(i, i + BATCH_SIZE);
    const found = await findExistingUpcMappingsBatch(supabase, slice);
    for (const upc of found) tier2AlreadyMapped.add(upc);
  }

  const tier2InsertRows = [];
  for (const row of tier2Candidates) {
    const result = matchByNameAndSize(row, mlccBySize);
    if (result.tier === 1) {
      report.matching.tier2NameSizeMatches += 1;
      if (report.sampleAutoConfirmedTier2.length < 25) {
        report.sampleAutoConfirmedTier2.push({
          upc: row.upc,
          nrsName: row.name,
          mlccCode: result.mlccCode,
          mlccName: result.mlccName,
          score: result.score,
          lead: result.lead,
        });
      }
      if (tier2AlreadyMapped.has(row.upc)) {
        report.matching.alreadyMappedSkipped += 1;
        continue;
      }
      tier2InsertRows.push({
        upc: row.upc,
        mlcc_code: result.mlccCode,
        confidence_source: "nrs_import_name_size_match",
        confirmed_by: confirmedBy,
      });
    } else if (result.tier === 2) {
      report.matching.tier2Ambiguous += 1;
      if (report.sampleAmbiguous.length < 15) {
        report.sampleAmbiguous.push({
          upc: row.upc,
          nrsName: row.name,
          topThree: result.topThree,
        });
      }
    } else {
      report.matching.tier3NoMatch += 1;
      if (report.sampleSkipped.length < 15) {
        report.sampleSkipped.push({
          upc: row.upc,
          nrsName: row.name,
          reason: result.reason,
        });
      }
    }
  }

  // Write Tier 2 auto-confirms in small chunks. Smaller chunks reduce blast
  // radius if one row triggers an upsert error (the whole chunk gets retried
  // per-row on failure). The previous CHUNK=500 lost 26 rows in one failed
  // call when "fetch failed" hit, so cut it down and add per-row fallback.
  if (tier2InsertRows.length > 0) {
    const CHUNK = 50;
    for (let i = 0; i < tier2InsertRows.length; i += CHUNK) {
      const chunk = tier2InsertRows.slice(i, i + CHUNK);
      if (dryRun) {
        report.write.attempted += chunk.length;
        report.write.succeeded += chunk.length;
        continue;
      }
      report.write.attempted += chunk.length;
      const chunkResult = await tryUpsertChunkWithFallback(supabase, chunk);
      report.write.succeeded += chunkResult.succeeded;
      report.write.failed += chunkResult.failed;
      for (const err of chunkResult.errors) {
        report.write.writeErrors.push({
          phase: "tier2",
          chunkIndex: i / CHUNK,
          ...err,
        });
      }
    }
  }

  report.needsReview = report.matching.tier2Ambiguous;
  report.finishedAt = new Date().toISOString();

  return { ok: true, report };
}
