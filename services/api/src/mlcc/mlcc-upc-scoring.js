/**
 * Multi-signal UPC → MLCC candidate scoring (0–100).
 * @typedef {{ name: string; brand: string; size_ml: number | null; proof: number | null; rawTitle: string; imageUrl?: string | null }} UpcData
 */

import { inferBrandAlias, resolveBrandAlias } from "./mlcc-brand-aliases.js";
import {
  isDisqualifyingMismatch,
  mlccCategoryMatchesAnyHint,
} from "./mlcc-category-ontology.js";

const DEBUG = process.env.DEBUG_UPC_FILTER === "1";

/**
 * @param {string | null | undefined} title
 * @returns {number | null}
 */
export function extractSizeFromTitle(title) {
  const s = String(title ?? "");
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
  return null;
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
  let s = String(name ?? "").trim();
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
  const ub = String(upcData.brand ?? "").trim().toLowerCase();
  const mlccName = String(mlcc.name ?? "");
  const mlccLower = mlccName.toLowerCase();
  const mlccBrandPhrase = cleanMlccBrandFromName(mlccName);

  if (!ub) {
    reasons.push("Brand: no UPC brand (0)");
    return { score: 0, disqualified: false, brandSource: "none", brandInferScore: null };
  }
  if (mlccLower === ub || mlccBrandPhrase === ub) {
    reasons.push("Brand: exact match (30)");
    return { score: 30, disqualified: false, brandSource: "exact", brandInferScore: null };
  }
  if (mlccLower.startsWith(ub) || mlccLower.startsWith(`${ub} `)) {
    reasons.push("Brand: UPC brand prefix on MLCC name (25)");
    return { score: 25, disqualified: false, brandSource: "prefix", brandInferScore: null };
  }
  const prefixes = resolveBrandAlias(ub);
  for (const p of prefixes) {
    const pl = p.toLowerCase();
    if (mlccLower.startsWith(pl) || mlccLower.includes(` ${pl}`)) {
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
  const u = upcData.size_ml;
  const m = mlcc.bottle_size_ml != null ? Number(mlcc.bottle_size_ml) : null;
  if (u == null || !Number.isFinite(u)) {
    reasons.push("Size: unknown on UPC (10 neutral)");
    return { score: 10, disqualified: false };
  }
  if (m == null || !Number.isFinite(m)) {
    reasons.push("Size: MLCC size missing (0)");
    return { score: 0, disqualified: false };
  }
  const d = Math.abs(u - m);
  if (d === 0) {
    reasons.push("Size: exact ml match (20)");
    return { score: 20, disqualified: false };
  }
  if (d <= 5) {
    reasons.push("Size: within 5ml (15)");
    return { score: 15, disqualified: false };
  }
  if (d <= 50) {
    reasons.push("Size: within 50ml (5)");
    return { score: 5, disqualified: false };
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

  const disqualified = Boolean(b.disqualified || c.disqualified || z.disqualified || p.disqualified || n.disqualified);
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
