/**
 * Multi-signal UPC → MLCC candidate scoring (0–100).
 * @typedef {{
 *   name: string;
 *   brand: string;
 *   size_ml: number | null;
 *   plausible_sizes?: number[];
 *   sizePenalty: number;
 *   proof: number | null;
 *   rawTitle: string;
 *   rawSize?: string;
 *   offersText?: string;
 *   imageUrl?: string | null;
 * }} UpcData
 */

import {
  inferBrandAlias,
  normalizeBrandForMatch,
  resolveBrandAlias,
} from "./mlcc-brand-aliases.js";
import {
  isDisqualifyingMismatch,
  mlccCategoryMatchesAnyHint,
} from "./mlcc-category-ontology.js";

const DEBUG = process.env.DEBUG_UPC_FILTER === "1";
const STANDARD_BOTTLE_SIZES_ML = [50, 100, 200, 375, 500, 700, 750, 1000, 1750];

/** Flavored / variant product lines — MLCC-only flavor vs silent UPC is a conflict. */
const FLAVOR_QUALIFIERS = new Set([
  "FIRE",
  "HONEY",
  "APPLE",
  "CINNAMON",
  "PEACH",
  "BLACKBERRY",
  "GINGER",
  "LEMONADE",
  "CARAMEL",
  "VANILLA",
  "PEPPER",
  "COCONUT",
  "CHERRY",
  "BERRY",
  "TROPICAL",
  "CITRUS",
  "MINT",
  "SPICED",
]);

/**
 * MLCC labels for the core / standard line — when UPC has no qualifiers, these do not
 * contradict the consumer title (e.g. Old No. 7 vs "OLD 7 BLACK" on MLCC).
 */
const BASE_LINE_QUALIFIERS = new Set([
  "BLACK",
  "BBN",
  "ORIGINAL",
  "CLASSIC",
  "STANDARD",
  "TRADITIONAL",
]);

/** Premium or limited line markers — conflict with a plain base UPC unless UPC also names them. */
const PREMIUM_QUALIFIERS = new Set([
  "SINGLE",
  "BARREL",
  "RESERVE",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "CROWN",
  "BONDED",
  "GREEN",
  "WHITE",
  "SILVER",
  "TRIPLE",
  "MASH",
  "SINATRA",
  "WINTER",
  "HERITAGE",
  "GENTLEMAN",
  "MCLAREN",
  "COY",
  "PROOF",
  "CASK",
  "STRENGTH",
  "PRIVATE",
  "SELECT",
  "CELLAR",
  "AGED",
  "LIMITED",
  "EDITION",
  "WFS",
  "KEEPERS",
  "ANNIVERSARY",
  "COMMEMORATIVE",
  "DISTILLERY",
  "GIFT_SET",
  "RYE",
  "BOURBON",
  "MALT",
  "SCOTCH",
]);

/** Union of all tokens `extractDistinguishingMarkers` looks for in names. */
const DISTINGUISHING_QUALIFIERS = new Set([
  ...FLAVOR_QUALIFIERS,
  ...BASE_LINE_QUALIFIERS,
  ...PREMIUM_QUALIFIERS,
]);
const SERIES_ROMAN = new Set(["I", "II", "III", "IV", "V", "X", "XV", "XX", "XXV", "XXX", "L"]);

/**
 * Levenshtein distance for short ASCII tokens (qualifier names).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  /** @type {number[]} */
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Match a typo'd token to a canonical qualifier (edit distance ≤ 1). Short tokens (≤3)
 * are not fuzzy-matched to limit false positives.
 * @param {string} token
 * @param {Set<string>} qualifierSet
 * @returns {string | null}
 */
function fuzzyMatchQualifier(token, qualifierSet) {
  const u = String(token ?? "").toUpperCase();
  if (u.length < 4) return null;
  /** @type {string[]} */
  const hits = [];
  for (const q of qualifierSet) {
    if (levenshteinDistance(u, q) <= 1) hits.push(q);
  }
  if (!hits.length) return null;
  hits.sort();
  return hits[0];
}

/**
 * MLCC uses "W/" for gift-with-purchase bundle copy (e.g. "W/WATER BOTTLE", trailing "W/").
 * Matches a word-boundary before {@code W} then a slash (covers {@code W/WATER} and standalone {@code W/}).
 * @param {string | null | undefined} mlccName
 * @returns {boolean}
 */
export function isGiftSet(mlccName) {
  return /\bW\//i.test(String(mlccName ?? ""));
}

/**
 * Parse a size hint into ml (supports ml, liter, and fl oz).
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
function parseSizeHintMl(text) {
  const s = String(text ?? "");
  if (!s) return null;
  const ml = s.match(/(\d+(?:\.\d+)?)\s*(?:m\s*l|ml)\b/i);
  if (ml) {
    const v = Number.parseFloat(ml[1]);
    if (Number.isFinite(v)) return Math.round(v);
  }
  const liter = s.match(/(\d+(?:\.\d+)?)\s*(?:l|litre|liter)\b/i);
  if (liter) {
    const v = Number.parseFloat(liter[1]);
    if (Number.isFinite(v)) return Math.round(v * 1000);
  }
  const flOz = s.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|oz)\b/i);
  if (flOz) {
    const v = Number.parseFloat(flOz[1]);
    if (Number.isFinite(v)) return roundToStandardBottleSize(v * 29.5735);
  }
  return null;
}

/**
 * Pick the nearest standard bottle size.
 * @param {number} valueMl
 * @returns {number}
 */
function roundToStandardBottleSize(valueMl) {
  let best = STANDARD_BOTTLE_SIZES_ML[0];
  let bestDiff = Math.abs(valueMl - best);
  for (const size of STANDARD_BOTTLE_SIZES_ML) {
    const diff = Math.abs(valueMl - size);
    if (diff < bestDiff) {
      best = size;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Choose the value that is nearest to a standard bottle size.
 * @param {number[]} candidates
 * @returns {number | null}
 */
function pickClosestStandardSize(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    for (const standard of STANDARD_BOTTLE_SIZES_ML) {
      const delta = Math.abs(candidate - standard);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
  }
  return best != null ? Math.round(best) : null;
}

/**
 * Resolve UPC size using multiple fields and uncertainty metadata.
 * @param {Pick<UpcData, "rawTitle" | "rawSize" | "offersText"> | string | null | undefined} upcData
 * @returns {{ preferredSize: number | null; plausibleSizes: number[]; penalty: number }}
 */
export function extractSizeFromTitle(upcData) {
  const rawTitle = typeof upcData === "string" ? upcData : String(upcData?.rawTitle ?? "");
  const rawSize = typeof upcData === "string" ? "" : String(upcData?.rawSize ?? "");
  const offersText = typeof upcData === "string" ? "" : String(upcData?.offersText ?? "");

  const titleMl = parseSizeHintMl(rawTitle);
  const rawSizeMl = parseSizeHintMl(rawSize);
  const offersMl = parseSizeHintMl(offersText);
  const candidates = [titleMl, rawSizeMl, offersMl].filter((v) => Number.isFinite(v));

  const plausibleSizes = [];
  for (const candidate of candidates) {
    const rounded = roundToStandardBottleSize(candidate);
    if (!STANDARD_BOTTLE_SIZES_ML.includes(rounded)) continue;
    if (!plausibleSizes.includes(rounded)) plausibleSizes.push(rounded);
  }
  if (!plausibleSizes.length) return { preferredSize: null, plausibleSizes: [], penalty: 0 };

  const disagreement =
    titleMl != null &&
    rawSizeMl != null &&
    Math.abs(titleMl - rawSizeMl) / Math.max(titleMl, rawSizeMl) > 0.05;
  if (disagreement) {
    const preferred = pickClosestStandardSize([titleMl, rawSizeMl]);
    if (DEBUG) {
      console.warn(
        "[upc-scoring][DEBUG_UPC_FILTER] size disagreement",
        JSON.stringify({ titleMl, rawSizeMl, offersMl, preferred }),
      );
    }
    return { preferredSize: preferred, plausibleSizes, penalty: -5 };
  }

  const preferred = pickClosestStandardSize(candidates);
  return { preferredSize: preferred, plausibleSizes, penalty: plausibleSizes.length > 1 ? -5 : 0 };
}

/**
 * Extract distinguishing markers from a product name.
 * @param {string | null | undefined} name
 * @returns {{ numbers: number[]; qualifiers: string[]; series: string[] }}
 */
export function extractDistinguishingMarkers(name) {
  const giftSet = isGiftSet(name);

  /** MLCC column abbreviations → canonical tokens (applied before qualifier matching). */
  const MLCC_ABBREVIATION_MAP = {
    SNGL: "SINGLE",
    BRL: "BARREL",
    BRRL: "BARREL",
    PRF: "PROOF",
    WSKY: "WHISKEY",
    BIB: "BONDED",
    BRBN: "BOURBON",
    TN: "TENNESSEE",
    SCTH: "SCOTCH",
    CAN: "CANADIAN",
    RSRV: "RESERVE",
    STGHT: "STRAIGHT",
    ORIG: "ORIGINAL",
    CLSSC: "CLASSIC",
    STD: "STANDARD",
    LTD: "LIMITED",
    ED: "EDITION",
    SPCL: "SPECIAL",
    ANNV: "ANNIVERSARY",
    YR: "YEAR",
    PROOF: "PROOF",
  };

  const stripLeadingTrailingNonAlnum = (s) => {
    let i = 0;
    let j = s.length;
    while (i < j && !/[A-Z0-9]/.test(s[i])) i += 1;
    while (j > i && !/[A-Z0-9]/.test(s[j - 1])) j -= 1;
    return s.slice(i, j);
  };

  let src = String(name ?? "").toUpperCase();
  src = src.replace(/\s+/g, " ").trim();
  const rawParts = src.split(/\s+/).filter(Boolean);

  const tokens = [];
  for (const part of rawParts) {
    const cleaned = stripLeadingTrailingNonAlnum(part);
    if (!cleaned) continue;
    const innerChunks = cleaned.includes("-") || cleaned.includes("/") ? cleaned.split(/[-/]+/) : [cleaned];
    for (const chunk of innerChunks) {
      const sub = stripLeadingTrailingNonAlnum(chunk);
      if (!sub) continue;
      const mapped = Object.prototype.hasOwnProperty.call(MLCC_ABBREVIATION_MAP, sub)
        ? MLCC_ABBREVIATION_MAP[sub]
        : sub;
      if (mapped === "") continue;
      tokens.push(mapped);
    }
  }

  const numbers = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!/^\d{1,3}$/.test(token)) continue;
    const prev = tokens[i - 1] ?? "";
    const next = tokens[i + 1] ?? "";
    const isMeasurement = /^(ML|L|LITER|LITRE|OZ|FLOZ|FL|PROOF|ABV|%)$/.test(next);
    const isProofPattern = prev === "(" && next === "PROOF";
    if (isMeasurement || isProofPattern) continue;
    const numeric = Number.parseInt(token, 10);
    if (Number.isFinite(numeric) && !numbers.includes(numeric)) numbers.push(numeric);
  }

  const qualifiers = [];
  const series = [];
  for (let wi = 0; wi < tokens.length; wi++) {
    const word = tokens[wi];
    let canon = null;
    if (DISTINGUISHING_QUALIFIERS.has(word)) {
      canon = word;
    } else if (word.length >= 4) {
      canon = fuzzyMatchQualifier(word, DISTINGUISHING_QUALIFIERS);
    }
    if (canon) {
      if (canon === "BOURBON") {
        const next = tokens[wi + 1] ?? "";
        if (next === "WHISKY" || next === "WHISKEY") continue;
      }
      if (!qualifiers.includes(canon)) qualifiers.push(canon);
    }
    if (SERIES_ROMAN.has(word) && !series.includes(word)) series.push(word);
  }
  if (giftSet && !qualifiers.includes("GIFT_SET")) qualifiers.push("GIFT_SET");
  return { numbers, qualifiers, series };
}

/**
 * @param {string[]} qualifiers
 * @returns {boolean}
 */
function qualifiersIncludeFlavor(qualifiers) {
  return qualifiers.some((q) => FLAVOR_QUALIFIERS.has(q));
}

/**
 * @param {string[]} qualifiers
 * @returns {boolean}
 */
function qualifiersIncludePremium(qualifiers) {
  return qualifiers.some((q) => PREMIUM_QUALIFIERS.has(q));
}

/**
 * Every qualifier is baseline-only (e.g. BLACK on MLCC for core Old No. 7 line).
 * @param {string[]} qualifiers
 * @returns {boolean}
 */
function qualifiersAreOnlyBaseline(qualifiers) {
  return qualifiers.length > 0 && qualifiers.every((q) => BASE_LINE_QUALIFIERS.has(q));
}

/**
 * True when the UPC title has no variant markers (plain flagship): no numbers or series,
 * and no qualifiers except optional baseline-only tokens (e.g. BLACK, BBN).
 * @param {{ numbers: number[]; qualifiers: string[]; series: string[] }} upcMarkers
 * @returns {boolean}
 */
export function isPlainFlagshipUpc(upcMarkers) {
  const nums = upcMarkers.numbers ?? [];
  const quals = upcMarkers.qualifiers ?? [];
  const series = upcMarkers.series ?? [];
  if (nums.length > 0) return false;
  if (series.length > 0) return false;
  if (quals.length === 0) return true;
  return quals.every((q) => BASE_LINE_QUALIFIERS.has(q));
}

/**
 * Check for marker conflicts between UPC and MLCC names.
 * Plain flagship UPC rejects MLCC rows with extra numbers, non-baseline qualifiers, or series.
 * Numbers: conflict only when both sides have numbers and there is zero overlap.
 * Qualifiers: flavor/premium vs silent UPC; baseline-only on MLCC does not conflict; shared token clears conflict.
 * @param {{ numbers: number[]; qualifiers: string[]; series: string[] }} upcMarkers
 * @param {{ numbers: number[]; qualifiers: string[]; series: string[] }} mlccMarkers
 * @returns {boolean}
 */
export function hasMarkerConflict(upcMarkers, mlccMarkers) {
  if (isPlainFlagshipUpc(upcMarkers)) {
    const mlccSeries = mlccMarkers.series ?? [];
    if (mlccSeries.length > 0) return true;
    const mlccNumsFlag = mlccMarkers.numbers ?? [];
    if (mlccNumsFlag.length > 0) return true;
    const mlccQFlag = mlccMarkers.qualifiers ?? [];
    if (mlccQFlag.length > 0 && !qualifiersAreOnlyBaseline(mlccQFlag)) return true;
  }

  const upcNums = upcMarkers.numbers ?? [];
  const mlccNums = mlccMarkers.numbers ?? [];
  if (upcNums.length > 0 && mlccNums.length > 0) {
    const numberOverlap = upcNums.some((n) => mlccNums.includes(n));
    if (!numberOverlap) return true;
  }

  const upcQ = upcMarkers.qualifiers ?? [];
  const mlccQ = mlccMarkers.qualifiers ?? [];

  if (upcQ.length > 0 && mlccQ.length === 0) return true;

  const shared = upcQ.some((q) => mlccQ.includes(q));
  if (upcQ.length > 0 && mlccQ.length > 0) {
    if (shared) return false;
    return true;
  }

  if (upcQ.length === 0 && mlccQ.length > 0) {
    if (qualifiersAreOnlyBaseline(mlccQ)) return false;
    if (qualifiersIncludeFlavor(mlccQ)) return true;
    if (qualifiersIncludePremium(mlccQ)) return true;
    return true;
  }

  const seriesOverlap = upcMarkers.series.some((s) => mlccMarkers.series.includes(s));
  if (upcMarkers.series.length > 0 && mlccMarkers.series.length > 0 && !seriesOverlap) return true;

  return false;
}

/**
 * @param {string | null | undefined} title
 * @returns {number | null} proof number
 */
export function extractProofFromTitle(title) {
  const s = String(title ?? "");
  const proofP = s.match(/\(\s*(\d+(?:\.\d+)?)\s*proof\s*\)/i);
  if (proofP) {
    const v = Number.parseFloat(proofP[1]);
    if (Number.isFinite(v)) return v;
  }
  const proofW = s.match(/\b(\d+(?:\.\d+)?)\s*proof\b/i);
  if (proofW) {
    const v = Number.parseFloat(proofW[1]);
    if (Number.isFinite(v)) return v;
  }
  const abv = s.match(/\(\s*(\d+(?:\.\d+)?)\s*%\s*abv\s*\)/i);
  if (abv) {
    const v = Number.parseFloat(abv[1]);
    if (Number.isFinite(v)) return Math.round(v * 2 * 10) / 10;
  }
  const abv2 = s.match(/\b(\d+(?:\.\d+)?)\s*%\s*abv\b/i);
  if (abv2) {
    const v = Number.parseFloat(abv2[1]);
    if (Number.isFinite(v)) return Math.round(v * 2 * 10) / 10;
  }
  return null;
}

/**
 * @param {string | null | undefined} name
 * @returns {string} lowercased brand-ish phrase (first 2–3 tokens)
 */
export function cleanMlccBrandFromName(name) {
  let s = normalizeBrandForMatch(name);
  s = s.toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\b(PT|FTH|LTR|QTR|50ML|375ML|750ML|1000ML|1750ML)\b/gi, " ");
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:m\s*l|ml|l|litre|liter)\b/gi, " ");
  s = s.replace(/\b\d+(?:\.\d+)?\s*proof\b/gi, " ");
  s = s.replace(/\b\d+\b/g, (m, off, str) => {
    const prev = str.slice(Math.max(0, off - 4), off).toLowerCase();
    if (/\d\s*$/.test(prev)) return m;
    const n = Number.parseInt(m, 10);
    if (n >= 40 && n <= 160) return " ";
    return m;
  });
  s = s.replace(/\b(PL|RSV|BLK|GOLD|SILVER|RSRV|PREM)\b/gi, " ");
  s = s.replace(/[^a-z0-9\s]/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.slice(0, 3).join(" ").toLowerCase();
}

/** @param {string | null | undefined} name */
export function getMlccBrandFromName(name) {
  return cleanMlccBrandFromName(name);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} similarity 0..1
 */
export function levenshteinSimilarity(a, b) {
  const s = String(a ?? "").toLowerCase().replace(/[^a-z0-9\s]/gi, "").replace(/\s+/g, " ").trim();
  const t = String(b ?? "").toLowerCase().replace(/[^a-z0-9\s]/gi, "").replace(/\s+/g, " ").trim();
  if (!s.length && !t.length) return 1;
  if (!s.length || !t.length) return 0;
  const m = s.length;
  const n = t.length;
  /** @type {number[]} */
  let row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const next = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + cost,
      );
    }
    row = next;
  }
  const dist = row[n];
  const maxLen = Math.max(m, n);
  return 1 - dist / maxLen;
}

/**
 * @param {string} productName
 * @returns {string[]}
 */
export function extractCategoryHintsUpc(productName) {
  const s = String(productName ?? "").toLowerCase();
  const hints = [];
  const add = (h) => {
    if (h && !hints.includes(h)) hints.push(h);
  };
  if (/\b(vodka)\b/.test(s)) add("vodka");
  if (/\b(whiskey)\b/.test(s)) add("whiskey");
  if (/\b(whisky)\b/.test(s)) add("whisky");
  if (/\b(bourbon)\b/.test(s)) add("bourbon");
  if (/\b(rye)\b/.test(s)) add("rye");
  if (/\b(scotch)\b/.test(s)) add("scotch");
  if (/\b(tennessee)\b/.test(s)) add("tennessee");
  if (/\b(canadian)\b/.test(s)) add("canadian");
  if (/\b(rum)\b/.test(s)) add("rum");
  if (/\b(gin)\b/.test(s)) add("gin");
  if (/\b(tequila|mezcal)\b/.test(s)) add("tequila");
  if (/\b(mezcal)\b/.test(s)) add("mezcal");
  if (/\b(cognac)\b/.test(s)) add("cognac");
  if (/\b(brandy)\b/.test(s)) add("brandy");
  if (/\b(armagnac)\b/.test(s)) add("armagnac");
  if (/\b(irish)\b/.test(s)) add("irish");
  if (/\b(liqueur|cordial|schnapps)\b/.test(s)) add("liqueur");
  if (/\b(cordial)\b/.test(s)) add("cordial");
  if (/\b(schnapps)\b/.test(s)) add("schnapps");
  if (/\b(amaretto)\b/.test(s)) add("amaretto");
  if (/\b(cream)\b/.test(s)) add("cream");
  if (/\b(cocktail|premix|prepared|martini|cosmopolitan)\b/.test(s)) add("cocktail");
  if (/\b(premix)\b/.test(s)) add("premix");
  if (/\b(prepared)\b/.test(s)) add("prepared");
  if (/\b(martini)\b/.test(s)) add("martini");
  if (/\b(wine)\b/.test(s)) add("wine");
  if (/\b(beer|ale|lager)\b/.test(s)) add("beer");
  return hints;
}

/**
 * @param {string[]} hints
 * @param {string | null | undefined} mlccCategory
 * @returns {boolean}
 */
export function categoryRowMatchesHints(hints, mlccCategory) {
  const hintsArr = Array.isArray(hints) ? hints : [];
  if (!hintsArr.length) return true;
  return mlccCategoryMatchesAnyHint(mlccCategory, hintsArr);
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlcc
 * @param {string[]} reasons
 * @returns {{ score: number; disqualified: boolean; brandSource: string; brandInferScore: number | null }}
 */
function scoreBrand(upcData, mlcc, reasons) {
  const ub = normalizeBrandForMatch(upcData.brand).toLowerCase();
  const mlccName = String(mlcc.name ?? "");
  const mlccNorm = normalizeBrandForMatch(mlccName).toLowerCase();
  const mlccBrandPhrase = cleanMlccBrandFromName(mlccName);

  if (!ub) {
    reasons.push("Brand: no UPC brand (0)");
    return { score: 0, disqualified: false, brandSource: "none", brandInferScore: null };
  }
  if (mlccNorm === ub || mlccBrandPhrase === ub) {
    reasons.push("Brand: exact match (30)");
    return { score: 30, disqualified: false, brandSource: "exact", brandInferScore: null };
  }
  if (mlccNorm.startsWith(ub) || mlccNorm.startsWith(`${ub} `)) {
    reasons.push("Brand: UPC brand prefix on MLCC name (25)");
    return { score: 25, disqualified: false, brandSource: "prefix", brandInferScore: null };
  }
  const prefixes = resolveBrandAlias(upcData.brand);
  for (const p of prefixes) {
    const pl = normalizeBrandForMatch(p).toLowerCase();
    if (mlccNorm.startsWith(pl) || mlccNorm.includes(` ${pl}`)) {
      reasons.push(`Brand: alias prefix match "${p}" (28)`);
      return { score: 28, disqualified: false, brandSource: "alias", brandInferScore: null };
    }
  }
  const inferred = inferBrandAlias(upcData.brand, mlccName);
  if (inferred >= 0.9) {
    reasons.push(`Brand: inferred alias high (${inferred}) → 25`);
    return { score: 25, disqualified: false, brandSource: "inferred_high", brandInferScore: inferred };
  }
  if (inferred >= 0.6) {
    reasons.push(`Brand: inferred alias medium (${inferred}) → 18`);
    return { score: 18, disqualified: false, brandSource: "inferred_medium", brandInferScore: inferred };
  }
  if (inferred >= 0.3) {
    reasons.push(`Brand: inferred alias low (${inferred}) → 8`);
    return { score: 8, disqualified: false, brandSource: "inferred_low", brandInferScore: inferred };
  }
  const words = ub.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w.length >= 3 && mlccBrandPhrase.includes(w)) {
      reasons.push(`Brand: partial word "${w}" (10)`);
      return { score: 10, disqualified: false, brandSource: "partial_word", brandInferScore: null };
    }
  }
  reasons.push("Brand: no strong match (0)");
  return { score: 0, disqualified: false, brandSource: "none", brandInferScore: inferred || null };
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlcc
 * @param {string[]} reasons
 * @returns {{ score: number; disqualified: boolean }}
 */
function scoreCategory(upcData, mlcc, reasons) {
  const hints = extractCategoryHintsUpc(upcData.name);
  const catRaw = String(mlcc.category ?? "").trim();

  if (DEBUG) {
    console.log(
      "[upc-scoring][DEBUG_UPC_FILTER]",
      JSON.stringify({
        phase: "ontology",
        hints,
        mlccCategory: catRaw,
        disqualify: hints.length ? isDisqualifyingMismatch(hints, catRaw) : false,
        matchesAny: hints.length ? mlccCategoryMatchesAnyHint(catRaw, hints) : true,
      }),
    );
  }

  if (!hints.length) {
    reasons.push("Category: no hint from UPC title (15 neutral)");
    return { score: 15, disqualified: false };
  }

  if (isDisqualifyingMismatch(hints, catRaw)) {
    reasons.push("Category: disqualifying mismatch (hint vs MLCC category)");
    return { score: 0, disqualified: true };
  }

  const plainVodka = hints.includes("vodka") && !hints.includes("cocktail");
  const catLower = catRaw.toLowerCase();
  if (plainVodka && catLower.includes("flavored") && catLower.includes("vodka")) {
    reasons.push("Category: plain vodka UPC vs flavored vodka (10)");
    return { score: 10, disqualified: false };
  }

  if (mlccCategoryMatchesAnyHint(catRaw, hints)) {
    reasons.push("Category: hint matches MLCC category via ontology (30)");
    return { score: 30, disqualified: false };
  }

  reasons.push("Category: hint present but MLCC category mismatch — disqualify");
  return { score: 0, disqualified: true };
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlcc
 * @param {string[]} reasons
 * @returns {{ score: number; disqualified: boolean }}
 */
function scoreSize(upcData, mlcc, reasons) {
  const plausibleSizes = Array.isArray(upcData.plausible_sizes)
    ? upcData.plausible_sizes
        .map((s) => Number(s))
        .filter((s) => Number.isFinite(s))
    : [];
  const targets = plausibleSizes.length > 0 ? plausibleSizes : [upcData.size_ml].filter((s) => Number.isFinite(s));
  const m = mlcc.bottle_size_ml != null ? Number(mlcc.bottle_size_ml) : null;
  if (!targets.length) {
    reasons.push("Size: unknown on UPC (10 neutral)");
    return { score: 10, disqualified: false };
  }
  if (m == null || !Number.isFinite(m)) {
    reasons.push("Size: MLCC size missing (0)");
    return { score: 0, disqualified: false };
  }
  let bestScore = 0;
  for (const target of targets) {
    const d = Math.abs(target - m);
    if (d === 0) bestScore = Math.max(bestScore, 20);
    else if (d <= 5) bestScore = Math.max(bestScore, 15);
    else if (d <= 50) bestScore = Math.max(bestScore, 5);
  }
  if (bestScore >= 20) reasons.push("Size: exact ml match (20)");
  else if (bestScore >= 15) reasons.push("Size: within 5ml (15)");
  else if (bestScore >= 5) reasons.push("Size: within 50ml (5)");
  const uncertaintyPenalty = targets.length > 1 ? -5 : Number(upcData.sizePenalty) || 0;
  if (bestScore > 0) {
    return { score: Math.max(0, bestScore + uncertaintyPenalty), disqualified: false };
  }
  reasons.push("Size: mismatch >50ml — disqualify");
  return { score: 0, disqualified: true };
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlcc
 * @param {string[]} reasons
 * @returns {{ score: number; disqualified: boolean }}
 */
function scoreProof(upcData, mlcc, reasons) {
  const u = upcData.proof;
  const m = mlcc.proof != null ? Number(mlcc.proof) : null;
  if (u == null || !Number.isFinite(u)) {
    reasons.push("Proof: unknown on UPC (5 neutral)");
    return { score: 5, disqualified: false };
  }
  if (m == null || !Number.isFinite(m)) {
    reasons.push("Proof: MLCC proof missing (0)");
    return { score: 0, disqualified: false };
  }
  const d = Math.abs(u - m);
  if (d <= 0.5) {
    reasons.push("Proof: match (10)");
    return { score: 10, disqualified: false };
  }
  if (d <= 5) {
    reasons.push("Proof: close mismatch (3)");
    return { score: 3, disqualified: false };
  }
  reasons.push("Proof: large mismatch (0)");
  return { score: 0, disqualified: false };
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlcc
 * @param {string[]} reasons
 * @returns {{ score: number; disqualified: boolean }}
 */
function scoreNameSimilarity(upcData, mlcc, reasons) {
  const sim = levenshteinSimilarity(upcData.name, String(mlcc.name ?? ""));
  const pts = Math.round(sim * 10);
  reasons.push(`Name similarity: ${sim.toFixed(2)} → ${pts}/10`);
  return { score: pts, disqualified: false };
}

/**
 * @param {UpcData} upcData
 * @param {Record<string, unknown>} mlccCandidate
 * @returns {{ total: number; breakdown: object; disqualified: boolean; reasons: string[] }}
 */
export function scoreUpcToMlccCandidate(upcData, mlccCandidate) {
  const reasons = [];

  const b = scoreBrand(upcData, mlccCandidate, reasons);
  const c = scoreCategory(upcData, mlccCandidate, reasons);
  const z = scoreSize(upcData, mlccCandidate, reasons);
  const p = scoreProof(upcData, mlccCandidate, reasons);
  const n = scoreNameSimilarity(upcData, mlccCandidate, reasons);

  const upcMarkers = extractDistinguishingMarkers(upcData.name);
  const mlccMarkers = extractDistinguishingMarkers(String(mlccCandidate.name ?? ""));
  const markerConflict = hasMarkerConflict(upcMarkers, mlccMarkers);
  if (markerConflict) {
    reasons.push(`Marker conflict: UPC markers ${JSON.stringify(upcMarkers)} vs MLCC markers ${JSON.stringify(mlccMarkers)}`);
  }

  const disqualified = Boolean(
    b.disqualified || c.disqualified || z.disqualified || p.disqualified || n.disqualified || markerConflict,
  );
  const brandScore = disqualified ? 0 : b.score;
  const categoryScore = disqualified ? 0 : c.score;
  const sizeScore = disqualified ? 0 : z.score;
  const proofScore = disqualified ? 0 : p.score;
  const nameSimilarityScore = disqualified ? 0 : n.score;

  const total = disqualified
    ? 0
    : brandScore + categoryScore + sizeScore + proofScore + nameSimilarityScore;

  const breakdown = {
    brandScore,
    brandSource: b.brandSource,
    brandInferScore: b.brandInferScore,
    categoryScore,
    sizeScore,
    proofScore,
    nameSimilarityScore,
    markerConflict,
    upcMarkers,
    mlccMarkers,
  };

  if (DEBUG) {
    console.log(
      "[upc-scoring]",
      JSON.stringify({
        mlccCode: mlccCandidate.code,
        total,
        disqualified,
        breakdown,
        reasons,
      }),
    );
  }

  return { total, breakdown, disqualified, reasons };
}
