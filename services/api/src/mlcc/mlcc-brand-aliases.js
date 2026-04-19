/**
 * Same normalization as price-book fuzzy search / DB name_normalized:
 * lowercase, strip punctuation (non-alphanumeric except spaces), collapse spaces, trim.
 * @param {string} str
 * @returns {string}
 */
function normalizeForAlias(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @type {readonly [string, string][]} */
const RAW_BRAND_ALIAS_PAIRS = [
  ["jack daniels", "j daniels"],
  ["jack daniels", "j daniel"],
  ["jack daniels", "jack daniel"],
  ["jim beam", "j beam"],
  ["evan williams", "evan william"],
  ["crown royal", "crown roy"],
  ["hennessy", "hennesy"],
  ["hennessy", "henn"],
  ["johnnie walker", "johnie walker"],
  ["johnnie walker", "johnnie walk"],
  ["makers mark", "maker mark"],
  ["makers mark", "mkrs mark"],
  ["fireball", "fire ball"],
  ["grey goose", "gray goose"],
  ["patron", "patrón"],
  ["jose cuervo", "j cuervo"],
  ["jose cuervo", "jose cuerv"],
  ["1800 tequila", "1800"],
  ["don julio", "don jul"],
  ["buffalo trace", "buffalo tr"],
  ["woodford reserve", "woodford res"],
  ["wild turkey", "wild turk"],
  ["jameson", "jamesons"],
  ["captain morgan", "capt morgan"],
  ["captain morgan", "captain morg"],
  ["malibu", "malibu rum"],
  ["bacardi", "bacard"],
  ["smirnoff", "smirnov"],
  ["absolut", "absolut vodka"],
  ["ciroc", "cîroc"],
  ["belvedere", "belvedr"],
];

/** @type {Map<string, string[]>} */
export const BRAND_ALIAS_MAP = new Map();

for (const [common, mlcc] of RAW_BRAND_ALIAS_PAIRS) {
  const commonKey = normalizeForAlias(common);
  const mlccNorm = normalizeForAlias(mlcc);
  if (!commonKey || !mlccNorm) continue;
  const list = BRAND_ALIAS_MAP.get(commonKey) ?? [];
  if (!list.includes(mlccNorm)) list.push(mlccNorm);
  BRAND_ALIAS_MAP.set(commonKey, list);
}

/**
 * When a known common brand phrase appears in the normalized search term, returns
 * alternate normalized terms with that phrase replaced by MLCC-style spellings
 * (for name_normalized.ilike expansion).
 * @param {string} normalizedTerm
 * @returns {string[]}
 */
export function resolveSearchAliases(normalizedTerm) {
  const term = String(normalizedTerm ?? "").trim();
  if (!term) return [];

  const out = [];
  const seen = new Set();

  for (const [commonKey, mlccVariants] of BRAND_ALIAS_MAP) {
    if (!commonKey || term.length < commonKey.length) continue;
    if (!term.includes(commonKey)) continue;
    for (const mlcc of mlccVariants) {
      const replaced = term.replaceAll(commonKey, mlcc);
      if (replaced === term) continue;
      if (seen.has(replaced)) continue;
      seen.add(replaced);
      out.push(replaced);
    }
  }

  return out;
}
