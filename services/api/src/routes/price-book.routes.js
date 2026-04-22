/**
 * Env tuning (UPC auto-match / picker):
 * - LK_CONFIDENT_MIN — minimum total score for confident single match (default 85)
 * - LK_CONFIDENT_LEAD — score lead over 2nd place required for confident when multiple rows (default 20)
 * - LK_PICKER_MIN — scores below this return low_confidence no-match (default 50)
 * - LK_PICKER_MAX — max ambiguous candidates returned (default 5)
 */
import express from "express";
import supabase from "../config/supabase.js";
import { extractBottleSizeMl, findMlccCandidatesForUpc, lookupUpcFromUpcitemdb } from "../lib/upcitemdb.js";
import { Sentry } from "../lib/sentry.js";
import { flagUpcMatchAsIncorrect, queueUpcMatchAudit } from "../mlcc/mlcc-upc-audit.js";
import { mlccCategoryMatchesAnyHint } from "../mlcc/mlcc-category-ontology.js";
import {
  extractCategoryHintsUpc,
  extractProofFromTitle,
  extractSizeFromTitle,
  scoreUpcToMlccCandidate,
} from "../mlcc/mlcc-upc-scoring.js";
import { BRAND_ALIAS_MAP, resolveSearchAliases } from "../mlcc/mlcc-brand-aliases.js";
import {
  familyNameSearchPrefix,
  filterToFamily,
  normalizeMlccNameBaseForFamily,
  sanitizeIlikeForFamily,
} from "../mlcc/mlcc-product-family.js";
import { getLatestPriceBookRun, ingestMlccPriceBook } from "../mlcc/mlcc-price-book-ingestor.js";

/** When true, picker confirmations persist UPC onto `mlcc_items` (local cache for future scans). */
const ENABLE_PICKER_SELECTION_CACHE = false;

/** When true, confident UPCitemdb/OFF matches persist `mlcc_items.upc` for future scans. */
const ENABLE_CONFIDENT_CACHE = process.env.ENABLE_CONFIDENT_CACHE !== "0";

const CONFIDENCE_THRESHOLDS = {
  auto_confident_min: Number(process.env.LK_CONFIDENT_MIN ?? 85),
  auto_confident_lead: Number(process.env.LK_CONFIDENT_LEAD ?? 20),
  picker_min: Number(process.env.LK_PICKER_MIN ?? 50),
  picker_max_candidates: Number(process.env.LK_PICKER_MAX ?? 5),
};
console.log("[price-book] confidence thresholds:", CONFIDENCE_THRESHOLDS);

const router = express.Router();

function requireServiceRole(req, res) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "Server misconfiguration" });
    return false;
  }
  const auth = req.headers.authorization?.trim();
  const expected = `Bearer ${key}`;
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/status", async (req, res) => {
  try {
    const latestRun = await getLatestPriceBookRun(supabase);
    const { data: newest, error: dErr } = await supabase
      .from("mlcc_items")
      .select("last_price_book_date")
      .not("last_price_book_date", "is", null)
      .order("last_price_book_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dErr) {
      return res.status(500).json({ ok: false, error: dErr.message });
    }

    let priceBookDate = null;
    let daysSinceUpdate = null;
    /** @type {"fresh"|"aging"|"stale"} */
    let status = "stale";
    const rawDate = newest?.last_price_book_date;
    if (rawDate != null && String(rawDate).trim() !== "") {
      priceBookDate = String(rawDate);
      const d0 = new Date(`${priceBookDate}T12:00:00.000Z`);
      const now = new Date();
      daysSinceUpdate = Math.max(0, Math.floor((now.getTime() - d0.getTime()) / 86400000));
      if (daysSinceUpdate < 7) status = "fresh";
      else if (daysSinceUpdate <= 14) status = "aging";
      else status = "stale";
    }

    res.json({
      ok: true,
      latestRun,
      priceBookDate,
      daysSinceUpdate,
      status,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/ingest", async (req, res) => {
  if (!requireServiceRole(req, res)) return;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const url = typeof body.url === "string" ? body.url : undefined;
    const dryRun = Boolean(body.dryRun);
    const result = await ingestMlccPriceBook(supabase, { url, dryRun });
    if (!result.ok) {
      return res.json({ ok: false, error: result.error || "Ingest failed" });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

function applyMlccItemsFilters(q, adaNumber, isNewItemQ) {
  let query = q;
  if (adaNumber) {
    query = query.eq("ada_number", adaNumber);
  }
  if (isNewItemQ === "true") {
    query = query.eq("is_new_item", true);
  } else if (isNewItemQ === "false") {
    query = query.eq("is_new_item", false);
  }
  return query;
}

/** Same semantics as `applyMlccItemsFilters` for in-memory rows (e.g. RPC results). */
function filterMlccRowsClientSide(rows, adaNumber, isNewItemQ) {
  return (rows ?? []).filter((row) => {
    if (adaNumber && String(row.ada_number ?? "").trim() !== adaNumber) return false;
    if (isNewItemQ === "true" && row.is_new_item !== true) return false;
    if (isNewItemQ === "false" && row.is_new_item !== false) return false;
    return true;
  });
}

/** Applies the legacy name / name_normalized / code OR filter for non-brand-key text search. */
function applyItemsOrSearchToQuery(q, search) {
  const original = escapeIlikeOrToken(search);
  const normalizedRaw = normalizeSearchTerm(search);
  const normalized = escapeIlikeOrToken(normalizedRaw);
  const aliasTerms = resolveSearchAliases(normalizedRaw);
  const aliasOrParts = aliasTerms.map(
    (t) => `name_normalized.ilike.%${escapeIlikeOrToken(t)}%`,
  );
  const aliasOrSuffix = aliasOrParts.length ? `,${aliasOrParts.join(",")}` : "";

  if (normalized && normalized !== original) {
    return q.or(
      `name.ilike.%${original}%,name.ilike.%${normalized}%,name_normalized.ilike.%${normalized}%,code.ilike.%${original}%${aliasOrSuffix}`,
    );
  }
  if (normalized) {
    return q.or(
      `name.ilike.%${original}%,name_normalized.ilike.%${normalized}%,code.ilike.%${original}%${aliasOrSuffix}`,
    );
  }
  return q.or(`name.ilike.%${original}%,code.ilike.%${original}%${aliasOrSuffix}`);
}

/** Escape %, _, \\ for ilike patterns; strip commas so .or() filter stays valid. */
function escapeIlikeOrToken(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "");
}

/**
 * Lowercase, strip punctuation (non-alphanumeric except spaces), collapse spaces, trim.
 * Matches DB name_normalized semantics for fuzzy search.
 */
function normalizeSearchTerm(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip % and _ from external strings used inside ilike patterns (defense in depth). */
function sanitizeIlikeValue(s) {
  return String(s).replace(/%/g, "").replace(/_/g, "");
}

/** Longest `BRAND_ALIAS_MAP` key contained in `normalizedRaw` (substring match). */
function findLongestContainedBrandKey(normalizedRaw) {
  const term = String(normalizedRaw ?? "").trim();
  if (!term) return null;
  let best = null;
  let bestLen = -1;
  for (const key of BRAND_ALIAS_MAP.keys()) {
    if (!key || term.length < key.length) continue;
    if (!term.includes(key)) continue;
    if (key.length > bestLen) {
      bestLen = key.length;
      best = key;
    }
  }
  return best;
}

function removeFirstSubstring(haystack, needle) {
  const h = String(haystack ?? "");
  const n = String(needle ?? "");
  if (!n) return h.trim();
  const i = h.indexOf(n);
  if (i < 0) return h.replace(/\s+/g, " ").trim();
  return (h.slice(0, i) + h.slice(i + n.length)).replace(/\s+/g, " ").trim();
}

const MULTI_TERM_BRAND_FETCH_CAP = 500;

/**
 * One query per MLCC-style brand variant; each row must match brand phrase and every suffix word on name_normalized.
 * @returns {Promise<{ rows: object[], error: Error | null }>}
 */
async function multiTermBrandSearch({
  supabase,
  brandKey,
  normalizedRaw,
  adaNumber,
  isNewItemQ,
}) {
  const suffixRaw = removeFirstSubstring(normalizedRaw, brandKey);
  const suffixWords = suffixRaw
    ? suffixRaw
        .split(/\s+/)
        .map((w) => sanitizeIlikeValue(w))
        .filter(Boolean)
    : [];

  const variants = BRAND_ALIAS_MAP.get(brandKey) ?? [];
  const brandCandidates = [];
  const seenBrand = new Set();
  for (const b of [brandKey, ...variants]) {
    const t = sanitizeIlikeValue(b);
    if (!t || seenBrand.has(t)) continue;
    seenBrand.add(t);
    brandCandidates.push(t);
  }

  const rowsById = new Map();

  for (const brandPart of brandCandidates) {
    let q = supabase.from("mlcc_items").select("*");
    q = applyMlccItemsFilters(q, adaNumber, isNewItemQ);
    q = q.ilike("name_normalized", `%${brandPart}%`);
    for (const w of suffixWords) {
      q = q.ilike("name_normalized", `%${w}%`);
    }
    const { data, error } = await q
      .order("scan_count", { ascending: false })
      .order("name", { ascending: true })
      .limit(MULTI_TERM_BRAND_FETCH_CAP);
    if (error) return { rows: [], error };
    for (const row of data ?? []) {
      if (row?.id && !rowsById.has(row.id)) rowsById.set(row.id, row);
    }
  }

  const merged = [...rowsById.values()].sort((a, b) => {
    const sa = Number(a.scan_count) || 0;
    const sb = Number(b.scan_count) || 0;
    if (sa !== sb) return sb - sa;
    const na = String(a.name ?? "");
    const nb = String(b.name ?? "");
    if (na !== nb) return na.localeCompare(nb);
    return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true });
  });
  return { rows: merged, error: null };
}

function queueUpcLookupLog(row) {
  try {
    void supabase
      .from("upc_lookups")
      .insert(row)
      .then(({ error }) => {
        if (error) console.log("[price-book-upc] upc_lookups log failed", error.message);
      });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log("[price-book-upc] upc_lookups log exception", m);
  }
}

/**
 * Fire-and-forget scan popularity bump for search ranking.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string | undefined} mlccId
 */
function incrementScanCount(sb, mlccId) {
  const id = mlccId != null ? String(mlccId).trim() : "";
  if (!id) return;
  void (async () => {
    try {
      const { data: cur, error: rErr } = await sb.from("mlcc_items").select("scan_count").eq("id", id).maybeSingle();
      if (rErr) throw rErr;
      const next = (Number(cur?.scan_count) || 0) + 1;
      const { error: uErr } = await sb
        .from("mlcc_items")
        .update({
          scan_count: next,
          last_scanned_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (uErr) throw uErr;
      if (process.env.DEBUG_UPC_FILTER === "1") {
        console.log("[price-book][DEBUG_UPC_FILTER]", JSON.stringify({ scan_increment: true, id, next }));
      }
    } catch (e) {
      if (typeof Sentry?.captureException === "function") {
        Sentry.captureException(e);
      }
    }
  })();
}

/**
 * Category keywords inferred from UPCitemdb / OFF product name for MLCC candidate filtering.
 * @param {string} productName
 * @returns {string[]}
 */
function extractCategoryHints(productName) {
  return extractCategoryHintsUpc(productName);
}

/**
 * @param {object[]} candidates mlcc_items rows
 * @param {string[]} hints from extractCategoryHints
 */
function filterMlccCandidatesByCategory(candidates, hints) {
  if (!hints || hints.length === 0) return [...candidates];
  return candidates.filter((c) => mlccCategoryMatchesAnyHint(c?.category, hints));
}

/**
 * @param {{ candidates?: object[] }} mlcc
 * @param {string} productName
 * @returns {{ candidates: object[]; confidenceWarning?: string; unfiltered: object[] }}
 */
function applyCategoryHintsToCandidates(mlcc, productName) {
  const unfiltered = [...(mlcc.candidates ?? [])];
  const hints = extractCategoryHints(productName);
  const strictFiltered = filterMlccCandidatesByCategory(unfiltered, hints);

  /** @type {object[]} */
  let candidates;
  /** @type {string | undefined} */
  let confidenceWarning;

  if (hints.length === 0) {
    candidates = unfiltered;
  } else if (strictFiltered.length > 0) {
    candidates = strictFiltered;
  } else if (unfiltered.length > 0) {
    candidates = [];
    confidenceWarning = "strict_filter_no_matches";
  } else {
    candidates = [];
  }

  if (process.env.DEBUG_UPC_FILTER === "1") {
    const path =
      hints.length === 0
        ? "hints_empty_pass_through"
        : strictFiltered.length > 0
          ? "hints_strict_ok"
          : unfiltered.length > 0
            ? "hints_strict_empty"
            : "unfiltered_empty";
    console.log(
      "[price-book-upc][DEBUG_UPC_FILTER]",
      JSON.stringify({
        productName,
        unfilteredCount: unfiltered.length,
        unfiltered: unfiltered.map((c) => ({
          code: c?.code ?? null,
          name: c?.name ?? null,
          category: c?.category ?? null,
        })),
        hints,
        strictFilteredCount: strictFiltered.length,
        finalCandidateCount: candidates.length,
        confidenceWarning: confidenceWarning ?? null,
        path,
      }),
    );
  }

  return { candidates, confidenceWarning, unfiltered };
}

/**
 * Collapse immediate repeated n-grams (3-, 2-, then 1-word), e.g. "A B A B C" → "A B C".
 * @param {string[]} words
 * @returns {string[]}
 */
function collapseRepeatedPhrases(words) {
  let w = [...words];
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    outer: for (let n = 3; n >= 1; n--) {
      for (let i = 0; i + 2 * n <= w.length; i++) {
        const a = w.slice(i, i + n).join(" ").toLowerCase();
        const b = w.slice(i + n, i + 2 * n).join(" ").toLowerCase();
        if (a === b) {
          w.splice(i + n, n);
          changed = true;
          break outer;
        }
      }
    }
    if (!changed) break;
  }
  return w;
}

/**
 * Dedupe repeated phrases and words, strip size/proof/bottle noise for search auto-fill.
 * @param {string} name
 * @returns {string}
 */
function cleanProductNameForSearch(name) {
  const raw = String(name ?? "").trim();
  let words = raw.split(/\s+/).filter(Boolean);
  words = collapseRepeatedPhrases(words);
  const out = [];
  for (const token of words) {
    const lw = token.toLowerCase();
    if (out.length && out[out.length - 1].toLowerCase() === lw) continue;
    out.push(token);
  }
  let s = out.join(" ");
  s = s.replace(/,\s*\d+(?:\.\d+)?\s*m\s*l\b/gi, "");
  s = s.replace(/,\s*\d+(?:\.\d+)?\s*l\b/gi, "");
  s = s.replace(/\(\s*\d+(?:\.\d+)?\s*%\s*abv\s*\)/gi, "");
  s = s.replace(/\(\s*\d+(?:\.\d+)?\s*proof\s*\)/gi, "");
  s = s.replace(/\b\d+(?:\.\d+)?\s*proof\b/gi, "");
  s = s.replace(/\b\d+(?:\.\d+)?\s*m\s*l\b/gi, "");
  s = s.replace(/\b\d+(?:\.\d+)?\s*l\b/gi, "");
  s = s.replace(/\s+Bottle\b/gi, " ");
  s = s.replace(/\bBottle\b$/i, "");
  s = s.replace(/\s+/g, " ").replace(/^[, ]+|[, ]+$/g, "").trim();
  return s;
}

function buildUpcData(upcItem) {
  const rawTitle = String(upcItem?.name ?? "").trim();
  const rawSize = String(upcItem?.rawSize ?? "").trim();
  const offersText = String(upcItem?.offersText ?? "").trim();
  const sizeResolution = extractSizeFromTitle({ rawTitle, rawSize, offersText });
  const size_ml = sizeResolution.preferredSize ?? extractBottleSizeMl(rawTitle);
  const plausible_sizes = Array.isArray(sizeResolution.plausibleSizes)
    ? sizeResolution.plausibleSizes
    : size_ml != null
      ? [size_ml]
      : [];
  const imageUrl =
    typeof upcItem?.imageUrl === "string" && upcItem.imageUrl.trim() ? upcItem.imageUrl.trim() : null;
  return {
    name: rawTitle,
    brand: String(upcItem?.brand ?? "").trim(),
    size_ml,
    plausible_sizes,
    sizePenalty: sizeResolution.penalty,
    proof: extractProofFromTitle(rawTitle),
    rawTitle,
    rawSize,
    offersText,
    imageUrl,
  };
}

/**
 * @param {ReturnType<typeof buildUpcData>} upcData
 * @param {object[]} pool
 * @param {Set<unknown>} strictCategoryPassIdSet
 * @param {boolean} hintsEmpty
 */
function scoreMlccPoolForUpc(upcData, pool, strictCategoryPassIdSet, hintsEmpty) {
  const scored = [];
  for (const row of pool) {
    const r = scoreUpcToMlccCandidate(upcData, row);
    scored.push({ row, ...r });
  }
  const allCandidateScores = scored.map((s) => ({
    code: String(s.row.code ?? ""),
    name: String(s.row.name ?? ""),
    score: s.total,
    disqualified: s.disqualified,
    reasons: s.reasons,
  }));

  const eligible = scored.filter(
    (s) => !s.disqualified && (hintsEmpty || strictCategoryPassIdSet.has(s.row.id)),
  );
  eligible.sort(
    (a, b) => b.total - a.total || String(a.row.code ?? "").localeCompare(String(b.row.code ?? "")),
  );
  return { scored, allCandidateScores, eligible };
}

/**
 * @param {Array<{ total: number; row: object; breakdown: object }>} sortedEligible
 * @param {typeof CONFIDENCE_THRESHOLDS} th
 */
function decideUpcMatchFromScores(sortedEligible, th) {
  if (!sortedEligible.length) return { mode: "none" };
  const top = sortedEligible[0];
  const second = sortedEligible[1];
  const pickerMin = th.picker_min;
  const confidentMin = th.auto_confident_min;
  const lead = th.auto_confident_lead;
  const maxAmb = th.picker_max_candidates;

  if (top.total < pickerMin) return { mode: "low_confidence", top };
  const single = sortedEligible.length === 1;
  const gap = second ? top.total - second.total : Infinity;
  if (top.total >= confidentMin && single) {
    const nameStrong = Number(top.breakdown?.nameSimilarityScore ?? 0) >= 7;
    const brandExact = String(top.breakdown?.brandSource ?? "") === "exact";
    const markerConflict = Boolean(top.breakdown?.markerConflict);
    if (nameStrong || (brandExact && !markerConflict)) return { mode: "confident", winner: top };
    return {
      mode: "ambiguous",
      topFive: [top],
      confidenceWarning: "single_candidate_requires_confirmation",
    };
  }
  if (top.total >= confidentMin && gap >= lead) return { mode: "confident", winner: top };
  if (
    (top.total >= pickerMin && top.total < confidentMin) ||
    (second != null && gap < lead)
  ) {
    return { mode: "ambiguous", topFive: sortedEligible.slice(0, maxAmb) };
  }
  return { mode: "confident", winner: top };
}

/**
 * @param {import("express").Response} res
 * @param {{ upc: string; upcItem: object; rawApiResponse: unknown; source: "upcitemdb" | "open_food_facts" }} ctx
 */
async function respondWithScoredUpcMatch(res, { upc, upcItem, rawApiResponse, source }) {
  const upcData = buildUpcData(upcItem);
  const mlcc = await findMlccCandidatesForUpc(
    supabase,
    { ...upcItem, size_ml: upcData.size_ml, plausible_sizes: upcData.plausible_sizes },
    { candidateLimit: 50 },
  );
  const { candidates: categoryPassRows, confidenceWarning, unfiltered } = applyCategoryHintsToCandidates(
    mlcc,
    upcItem.name,
  );
  const hintsEmpty = extractCategoryHints(upcItem.name).length === 0;
  const strictSet = new Set((categoryPassRows ?? []).map((r) => r.id));
  const cleanedName = cleanProductNameForSearch(upcData.rawTitle);
  const { allCandidateScores, eligible } = scoreMlccPoolForUpc(upcData, unfiltered, strictSet, hintsEmpty);

  const noMatchExtraWarning =
    confidenceWarning ??
    (!eligible.length && unfiltered.length > 0 ? "all_candidates_disqualified" : null);

  const topForBreakdown = eligible[0];
  const topScore = topForBreakdown ? topForBreakdown.total : 0;
  const topBreakdown = topForBreakdown ? topForBreakdown.breakdown : null;

  const decision = decideUpcMatchFromScores(eligible, CONFIDENCE_THRESHOLDS);
  const decisionConfidenceWarning = decision.confidenceWarning ?? null;

  if (process.env.DEBUG_UPC_FILTER === "1") {
    console.log(
      "[price-book-upc][DEBUG_UPC_FILTER]",
      JSON.stringify({
        phase: "decision",
        upc,
        source,
        decisionMode: decision.mode,
        eligibleCount: eligible.length,
        poolCount: unfiltered.length,
        confidenceWarning: confidenceWarning ?? decisionConfidenceWarning,
        noMatchExtraWarning,
        topScore,
      }),
    );
  }

  const auditBase = {
    upc,
    upcBrand: upcData.brand || null,
    upcProductName: cleanedName,
    upcProductNameRaw: upcData.rawTitle,
    allCandidateScores,
  };

  if (decision.mode === "confident" && decision.winner) {
    const match = decision.winner.row;
    const winnerBreakdown = decision.winner.breakdown ?? {};
    const cacheQuality =
      decision.winner.total >= 90 &&
      Number(winnerBreakdown.nameSimilarityScore ?? 0) >= 5 &&
      Number(winnerBreakdown.sizeScore ?? 0) === 20 &&
      !Boolean(winnerBreakdown.markerConflict)
        ? "high"
        : "provisional";

    let cached = false;
    if (ENABLE_CONFIDENT_CACHE && cacheQuality === "high") {
      const { error: upErr } = await supabase.from("mlcc_items").update({ upc }).eq("id", match.id);
      if (upErr) {
        console.log("[price-book-upc] mlcc_items upc cache update failed", upErr.message);
      } else {
        cached = true;
      }
    } else if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log(
        "[price-book-upc][DEBUG_UPC_FILTER]",
        JSON.stringify({
          phase: "cache_skip",
          upc,
          mlccCode: String(match.code ?? ""),
          cacheQuality,
          confidenceScore: decision.winner.total,
          breakdown: winnerBreakdown,
        }),
      );
    }
    const { data: refreshed } = await supabase.from("mlcc_items").select("*").eq("id", match.id).maybeSingle();
    const base = refreshed ?? { ...match };
    const product = { ...base, imageUrl: upcData.imageUrl ?? null };
    incrementScanCount(supabase, product.id);
    queueUpcLookupLog({
      upc,
      matched_mlcc_code: product.code ?? null,
      matched_product_name: product.name ?? null,
      source,
      raw_api_response: rawApiResponse ?? null,
    });
    console.log("[price-book-upc] matched via", source, "(confident)", product.id);

    queueUpcMatchAudit(supabase, {
      ...auditBase,
      matchedMlccCode: product.code != null ? String(product.code) : null,
      matchMode: "confident",
      confidenceScore: decision.winner.total,
      confidenceWarning: confidenceWarning ?? decisionConfidenceWarning,
      scoringBreakdown: decision.winner.breakdown,
      cached,
    });

    return res.json({
      ok: true,
      product,
      matchMode: "confident",
      confidenceScore: decision.winner.total,
      scoringBreakdown: decision.winner.breakdown,
      allCandidateScores,
      cacheQuality,
      upcProductName: upcItem.name,
      upcBrand: upcItem.brand,
      ...(confidenceWarning || decisionConfidenceWarning
        ? { confidenceWarning: confidenceWarning ?? decisionConfidenceWarning }
        : {}),
    });
  }

  if (decision.mode === "ambiguous" && decision.topFive?.length) {
    const img = upcData.imageUrl ?? null;
    const rows = decision.topFive.map((s) => ({ ...s.row, imageUrl: img }));
    queueUpcLookupLog({
      upc,
      matched_mlcc_code: null,
      matched_product_name: null,
      source,
      raw_api_response: rawApiResponse ?? null,
    });

    queueUpcMatchAudit(supabase, {
      ...auditBase,
      matchedMlccCode: null,
      matchMode: "ambiguous",
      confidenceScore: decision.topFive[0].total,
      confidenceWarning: confidenceWarning ?? decisionConfidenceWarning,
      scoringBreakdown: decision.topFive[0].breakdown,
      cached: false,
    });

    return res.json({
      ok: true,
      needsUserConfirmation: true,
      matchMode: "ambiguous",
      candidates: rows,
      upcProductName: upcItem.name,
      upcBrand: upcItem.brand,
      message: "Multiple products match. User must select.",
      confidenceScore: decision.topFive[0].total,
      scoringBreakdown: decision.topFive[0].breakdown,
      allCandidateScores,
      ...(confidenceWarning || decisionConfidenceWarning
        ? { confidenceWarning: confidenceWarning ?? decisionConfidenceWarning }
        : {}),
    });
  }

  let finalWarning = noMatchExtraWarning;
  if (decision.mode === "low_confidence") finalWarning = "low_confidence_match";

  queueUpcLookupLog({
    upc,
    matched_mlcc_code: null,
    matched_product_name: null,
    source,
    raw_api_response: rawApiResponse ?? null,
  });

  queueUpcMatchAudit(supabase, {
    ...auditBase,
    matchedMlccCode: null,
    matchMode: "no_match",
    confidenceScore: topScore,
    confidenceWarning: finalWarning,
    scoringBreakdown: topBreakdown,
    cached: false,
  });

  const noMatchBody = {
    ok: false,
    error: "upc_found_but_no_mlcc_match",
    productName: cleanedName,
    upcProductNameRaw: upcData.rawTitle,
    upcProductName: upcItem.name,
    upcBrand: upcItem.brand,
    hint: "search_by_name",
    confidenceScore: topScore,
    scoringBreakdown: topBreakdown,
    allCandidateScores,
  };
  if (finalWarning) noMatchBody.confidenceWarning = finalWarning;
  return res.json(noMatchBody);
}

export async function priceBookUpcFlagHandler(req, res) {
  try {
    const upc = String(req.params.upc ?? "").trim();
    if (!upc) {
      return res.status(400).json({ ok: false, error: "upc_required" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "user_says_wrong";
    if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log("[price-book-upc][DEBUG_UPC_FILTER]", JSON.stringify({ flag_request: true, upc, reason }));
    }
    const r = await flagUpcMatchAsIncorrect(supabase, upc, reason);
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: r.error ?? "flag_failed" });
    }
    return res.status(200).json({
      ok: true,
      message: "Match flagged; next scan will re-match from scratch.",
      clearedMlccCode: r.clearedMlccCode ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function priceBookUpcHandler(req, res) {
  try {
    const upc = String(req.params.upc ?? "").trim();
    if (!upc) {
      return res.status(400).json({ ok: false, error: "upc_required" });
    }
    console.log("[price-book-upc] lookup", upc);

    const { data: localRow, error: localErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("upc", upc)
      .limit(1)
      .maybeSingle();

    if (localErr) {
      console.log("[price-book-upc] db error", localErr.message);
      return res.status(500).json({ ok: false, error: localErr.message });
    }
    if (localRow) {
      console.log("[price-book-upc] local match", localRow.id);
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: localRow.code ?? null,
        matched_product_name: localRow.name ?? null,
        source: "local_cache",
        raw_api_response: null,
      });
      queueUpcMatchAudit(supabase, {
        upc,
        upcBrand: null,
        upcProductName: localRow.name ?? null,
        upcProductNameRaw: localRow.name ?? null,
        matchedMlccCode: localRow.code != null ? String(localRow.code) : null,
        matchMode: "local_cache",
        confidenceScore: 100,
        confidenceWarning: null,
        scoringBreakdown: null,
        allCandidateScores: [],
        cached: true,
      });
      incrementScanCount(supabase, localRow.id);
      return res.json({
        ok: true,
        product: { ...localRow, imageUrl: null },
        matchMode: "confident",
        confidenceScore: 100,
        scoringBreakdown: null,
        allCandidateScores: [],
        imageUrl: null,
      });
    }

    const upcDb = await lookupUpcFromUpcitemdb(upc);
    if (upcDb.ok && upcDb.product) {
      return respondWithScoredUpcMatch(res, {
        upc,
        upcItem: upcDb.product,
        rawApiResponse: upcDb.raw ?? null,
        source: "upcitemdb",
      });
    }

    const tryOff = upcDb.error === "not_found";
    if (!tryOff) {
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "upcitemdb",
        raw_api_response: { error: upcDb.error },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    let offJson;
    try {
      const ctrl = AbortSignal.timeout(5000);
      const offRes = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(upc)}.json`,
        { signal: ctrl },
      );
      offJson = await offRes.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("[price-book-upc] openfoodfacts fetch failed", msg);
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: "fetch_failed", message: msg },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    if (offJson?.status != 1 || !offJson.product) {
      console.log("[price-book-upc] openfoodfacts no product");
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: offJson ?? null },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    const p = offJson.product;
    const nameGuess =
      (typeof p.product_name === "string" && p.product_name.trim()) ||
      (typeof p.brands === "string" && p.brands.trim()) ||
      "";
    if (!nameGuess) {
      console.log("[price-book-upc] openfoodfacts missing name/brands");
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: "no_name" },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    const offBrands = typeof p.brands === "string" ? p.brands.trim() : "";
    const offUpcItem = {
      name: nameGuess.trim(),
      brand: offBrands,
      category: "",
      images: [],
    };
    return respondWithScoredUpcMatch(res, {
      upc,
      upcItem: offUpcItem,
      rawApiResponse: offJson,
      source: "open_food_facts",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[price-book-upc] unexpected", msg);
    return res.json({ ok: false, error: "upc_not_found" });
  }
}

router.post("/upc/:upc/confirm", async (req, res) => {
  if (!requireServiceRole(req, res)) return;
  try {
    const upc = String(req.params.upc ?? "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const mlccCode = typeof body.mlccCode === "string" ? body.mlccCode.trim() : "";
    if (!upc || !mlccCode) {
      return res.status(400).json({ ok: false, error: "upc_and_mlccCode_required" });
    }

    const { data: rows, error: selErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("code", mlccCode)
      .limit(1);

    if (selErr) {
      return res.status(500).json({ ok: false, error: selErr.message });
    }
    const row = rows?.[0];
    if (!row) {
      return res.json({ ok: false, error: "mlcc_code_not_found" });
    }

    let cached = false;
    if (ENABLE_PICKER_SELECTION_CACHE) {
      const { error: upErr } = await supabase.from("mlcc_items").update({ upc }).eq("id", row.id);
      if (upErr) {
        return res.status(500).json({ ok: false, error: upErr.message });
      }
      cached = true;
    } else {
      console.log(
        "[price-book-upc] confirm: picker selection applied for this scan only; UPC not persisted (ENABLE_PICKER_SELECTION_CACHE=false)",
        { upc, mlccCode },
      );
    }

    const { data: refreshed } = await supabase.from("mlcc_items").select("*").eq("id", row.id).maybeSingle();
    const product = refreshed ?? (ENABLE_PICKER_SELECTION_CACHE ? { ...row, upc } : row);

    const upcProductName =
      typeof body.upcProductName === "string" ? body.upcProductName.trim() || null : null;
    const upcBrand = typeof body.upcBrand === "string" ? body.upcBrand.trim() || null : null;
    queueUpcLookupLog({
      upc,
      matched_mlcc_code: product.code ?? null,
      matched_product_name: product.name ?? null,
      source: "manual_confirm",
      raw_api_response:
        upcProductName || upcBrand ? { upcProductName, upcBrand, cached } : { cached },
    });

    return res.json({ ok: true, product, cached });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

router.post("/upc/:upc/flag", priceBookUpcFlagHandler);
router.post("/upc/:upc/report-no-match", async (req, res) => {
  try {
    const upc = String(req.params.upc ?? "").trim();
    if (!upc) {
      return res.status(400).json({ ok: false, error: "upc_required" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const upcProductName =
      typeof body.upcProductName === "string" && body.upcProductName.trim()
        ? body.upcProductName.trim()
        : null;
    const upcBrand = typeof body.upcBrand === "string" && body.upcBrand.trim() ? body.upcBrand.trim() : null;
    queueUpcMatchAudit(supabase, {
      upc,
      upcBrand,
      upcProductName,
      upcProductNameRaw: upcProductName,
      matchedMlccCode: null,
      matchMode: "user_rejected_all_candidates",
      confidenceScore: 0,
      confidenceWarning: "user_rejected_all_candidates",
      scoringBreakdown: null,
      allCandidateScores: [],
      cached: false,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    if (typeof Sentry?.captureException === "function") {
      Sentry.captureException(e);
    }
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
router.get("/upc/:upc", priceBookUpcHandler);

router.get("/items/:code/family", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "code_required" });
    }

    const { data: anchor, error: aErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (aErr) {
      return res.status(500).json({ ok: false, error: aErr.message });
    }
    if (!anchor) {
      return res.json({ ok: false, error: "mlcc_code_not_found" });
    }

    let q = supabase.from("mlcc_items").select("*").eq("is_active", true);
    const cat = String(anchor.category ?? "").trim();
    if (cat) {
      q = q.eq("category", cat);
    }
    const adaName = String(anchor.ada_name ?? "").trim();
    if (adaName) {
      q = q.eq("ada_name", adaName);
    }
    const prefix = familyNameSearchPrefix(anchor);
    const safe = sanitizeIlikeForFamily(prefix);
    if (safe) {
      q = q.ilike("name", `%${safe}%`);
    }
    q = q.limit(500);
    const { data: pool, error: pErr } = await q;
    if (pErr) {
      return res.status(500).json({ ok: false, error: pErr.message });
    }

    let sizes = filterToFamily(anchor, pool ?? []);
    const seen = new Set((sizes ?? []).map((r) => r?.id).filter(Boolean));
    if (anchor.id && !seen.has(anchor.id)) {
      sizes = [anchor, ...sizes];
    }

    const dedup = [];
    const byId = new Set();
    for (const row of sizes) {
      if (!row?.id || byId.has(row.id)) continue;
      byId.add(row.id);
      dedup.push(row);
    }
    dedup.sort((a, b) => (Number(a.bottle_size_ml) || 0) - (Number(b.bottle_size_ml) || 0));

    const bf = String(anchor.brand_family ?? "").trim();
    const grouping = bf ? "brand_family_and_category" : "name_base_category_ada_name";

    if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log(
        "[price-book][DEBUG_UPC_FILTER][family]",
        JSON.stringify({
          requestedCode: code,
          anchor: {
            code: anchor.code,
            name: anchor.name,
            brand_family: anchor.brand_family ?? null,
            category: anchor.category ?? null,
            ada_name: anchor.ada_name ?? null,
          },
          grouping,
          nameBase: normalizeMlccNameBaseForFamily(anchor.name),
          searchPrefix: prefix || null,
          poolCount: (pool ?? []).length,
          familyCount: dedup.length,
          familyNames: dedup.map((r) => r.name),
        }),
      );
    }

    return res.json({
      ok: true,
      baseName: anchor.name,
      sizes: dedup,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

/** Default list ordering for catalog search: popular scans first, then name. */
function orderMlccItemsByScanThenName(q) {
  return q.order("scan_count", { ascending: false }).order("name", { ascending: true });
}

router.get("/items", async (req, res) => {
  try {
    let page = Number.parseInt(String(req.query.page || "1"), 10);
    let limit = Number.parseInt(String(req.query.limit || "50"), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const adaNumber = typeof req.query.adaNumber === "string" ? req.query.adaNumber.trim() : "";
    const isNewItemQ = req.query.isNewItem;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (search && /^\d+$/.test(search)) {
      let qExact = supabase.from("mlcc_items").select("*", { count: "exact" }).eq("code", search);
      qExact = applyMlccItemsFilters(qExact, adaNumber, isNewItemQ);
      const exactRes = await orderMlccItemsByScanThenName(qExact).range(from, to);
      if (exactRes.error) {
        return res.status(500).json({ ok: false, error: exactRes.error.message });
      }
      if (exactRes.data?.length) {
        return res.json({
          ok: true,
          items: exactRes.data,
          total: exactRes.count ?? 0,
          page,
        });
      }

      let qName = supabase.from("mlcc_items").select("*", { count: "exact" }).ilike("name", `%${search}%`);
      qName = applyMlccItemsFilters(qName, adaNumber, isNewItemQ);
      const nameRes = await orderMlccItemsByScanThenName(qName).range(from, to);
      if (nameRes.error) {
        return res.status(500).json({ ok: false, error: nameRes.error.message });
      }
      return res.json({
        ok: true,
        items: nameRes.data || [],
        total: nameRes.count ?? 0,
        page,
      });
    }

    if (search) {
      const normalizedRaw = normalizeSearchTerm(search);
      const brandKey = findLongestContainedBrandKey(normalizedRaw);

      if (brandKey) {
        const { rows: mergedRows, error: mergeErr } = await multiTermBrandSearch({
          supabase,
          brandKey,
          normalizedRaw,
          adaNumber,
          isNewItemQ,
        });
        if (mergeErr) {
          const msg =
            mergeErr instanceof Error ? mergeErr.message : String(mergeErr?.message ?? mergeErr);
          return res.status(500).json({ ok: false, error: msg });
        }

        if (mergedRows.length >= 3) {
          const total = mergedRows.length;
          const items = mergedRows.slice(from, from + limit);
          return res.json({
            ok: true,
            items,
            total,
            page,
          });
        }

        const { data: fuzzyRows, error: fuzzyErr } = await supabase.rpc("search_mlcc_items_fuzzy", {
          search_query: search,
          match_threshold: 0.15,
          result_limit: limit * 3,
        });
        if (fuzzyErr) {
          return res.status(500).json({ ok: false, error: fuzzyErr.message });
        }
        let filtered = filterMlccRowsClientSide(fuzzyRows, adaNumber, isNewItemQ);
        filtered.sort((a, b) => {
          const sa = Number(a.scan_count) || 0;
          const sb = Number(b.scan_count) || 0;
          if (sa !== sb) return sb - sa;
          const na = String(a.name ?? "");
          const nb = String(b.name ?? "");
          if (na !== nb) return na.localeCompare(nb);
          return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true });
        });
        const total = filtered.length;
        const items = filtered.slice(from, from + limit);
        return res.json({
          ok: true,
          items,
          total,
          page,
        });
      }

      let qOrHead = supabase.from("mlcc_items").select("*", { count: "exact", head: true });
      qOrHead = applyItemsOrSearchToQuery(qOrHead, search);
      qOrHead = applyMlccItemsFilters(qOrHead, adaNumber, isNewItemQ);
      const { count: orCount, error: orHeadErr } = await qOrHead;
      if (orHeadErr) {
        return res.status(500).json({ ok: false, error: orHeadErr.message });
      }

      if (orCount != null && orCount >= 3) {
        let qOr = supabase.from("mlcc_items").select("*", { count: "exact" });
        qOr = applyItemsOrSearchToQuery(qOr, search);
        qOr = applyMlccItemsFilters(qOr, adaNumber, isNewItemQ);
        const { data: orItems, error: orErr, count } = await orderMlccItemsByScanThenName(qOr).range(from, to);
        if (orErr) {
          return res.status(500).json({ ok: false, error: orErr.message });
        }
        return res.json({
          ok: true,
          items: orItems || [],
          total: count ?? 0,
          page,
        });
      }

      const { data: fuzzyRowsNoBrand, error: fuzzyErrNoBrand } = await supabase.rpc(
        "search_mlcc_items_fuzzy",
        {
          search_query: search,
          match_threshold: 0.15,
          result_limit: limit * 3,
        },
      );
      if (fuzzyErrNoBrand) {
        return res.status(500).json({ ok: false, error: fuzzyErrNoBrand.message });
      }
      let filteredNoBrand = filterMlccRowsClientSide(fuzzyRowsNoBrand, adaNumber, isNewItemQ);
      filteredNoBrand.sort((a, b) => {
        const sa = Number(a.scan_count) || 0;
        const sb = Number(b.scan_count) || 0;
        if (sa !== sb) return sb - sa;
        const na = String(a.name ?? "");
        const nb = String(b.name ?? "");
        if (na !== nb) return na.localeCompare(nb);
        return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true });
      });
      const totalNb = filteredNoBrand.length;
      const itemsNb = filteredNoBrand.slice(from, from + limit);
      return res.json({
        ok: true,
        items: itemsNb,
        total: totalNb,
        page,
      });
    }

    let q = supabase.from("mlcc_items").select("*", { count: "exact" });

    q = applyMlccItemsFilters(q, adaNumber, isNewItemQ);

    const { data: items, error, count } = await orderMlccItemsByScanThenName(q).range(from, to);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({
      ok: true,
      items: items || [],
      total: count ?? 0,
      page,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
