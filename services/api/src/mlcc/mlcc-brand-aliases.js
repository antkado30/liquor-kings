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

/** @type {readonly [string, readonly string[]][]} */
const RAW_UPC_BRAND_PREFIXES = [
  ["absolut", ["ABSOLUT SWEDISH", "ABSOLUT 80", "ABSOLUT"]],
  ["ketel one", ["KETEL ONE (HOL)", "KETEL ONE"]],
  ["tito's", ["TITO'S HANDMADE"]],
  ["titos", ["TITO'S HANDMADE"]],
  ["grey goose", ["GREY GOOSE"]],
  ["smirnoff", ["SMIRNOFF"]],
  ["jack daniel", ["J DANIELS", "JACK DANIELS"]],
  ["jack daniels", ["J DANIELS", "JACK DANIELS"]],
  ["jameson", ["JAMESON"]],
  ["crown royal", ["CROWN ROYAL"]],
  ["johnnie walker", ["JOHNNIE WALKER", "J WALKER"]],
  ["maker's mark", ["MAKERS MARK", "MAKER'S MARK"]],
  ["makers mark", ["MAKERS MARK", "MAKER'S MARK"]],
  ["bulleit", ["BULLEIT"]],
  ["woodford reserve", ["WOODFORD RESERVE"]],
  ["jim beam", ["JIM BEAM"]],
  ["bacardi", ["BACARDI"]],
  ["captain morgan", ["CAPTAIN MORGAN", "CAPT MORGAN"]],
  ["malibu", ["MALIBU"]],
  ["don julio", ["DON JULIO"]],
  ["patron", ["PATRON"]],
  ["casamigos", ["CASAMIGOS"]],
  ["jose cuervo", ["JOSE CUERVO", "CUERVO"]],
  ["tanqueray", ["TANQUERAY"]],
  ["bombay", ["BOMBAY SAPPHIRE", "BOMBAY"]],
  ["hendricks", ["HENDRICKS", "HENDRICK'S"]],
  ["hennessy", ["HENNESSY"]],
  ["remy martin", ["REMY MARTIN"]],
  ["courvoisier", ["COURVOISIER"]],
  ["ciroc", ["CIROC"]],
  ["svedka", ["SVEDKA"]],
  ["new amsterdam", ["NEW AMSTERDAM"]],
  ["skyy", ["SKYY"]],
  ["belvedere", ["BELVEDERE"]],
  ["stoli", ["STOLICHNAYA", "STOLI"]],
  ["stolichnaya", ["STOLICHNAYA", "STOLI"]],
  ["deep eddy", ["DEEP EDDY"]],
  ["pinnacle", ["PINNACLE"]],
  ["fireball", ["FIREBALL"]],
  ["baileys", ["BAILEYS"]],
  ["kahlua", ["KAHLUA"]],
  ["grand marnier", ["GRAND MARNIER"]],
  ["cointreau", ["COINTREAU"]],
  ["triple sec", ["TRIPLE SEC"]],
  ["southern comfort", ["SOUTHERN COMFORT", "SO COMFORT"]],
  ["e&j", ["E&J"]],
  ["christian brothers", ["CHRISTIAN BROTHERS"]],
  ["paul masson", ["PAUL MASSON"]],
];

/** @type {Map<string, string[]>} */
const UPC_BRAND_PREFIX_BY_KEY = new Map();

for (const [common, mlccPrefixes] of RAW_UPC_BRAND_PREFIXES) {
  const key = normalizeForAlias(common);
  if (!key) continue;
  const merged = UPC_BRAND_PREFIX_BY_KEY.get(key) ?? [];
  for (const p of mlccPrefixes) {
    const u = String(p).trim();
    if (u && !merged.includes(u)) merged.push(u);
  }
  UPC_BRAND_PREFIX_BY_KEY.set(key, merged);
}

/**
 * Resolve a UPCitemdb-style brand string to MLCC name prefixes for scoring.
 * @param {string} commonBrand
 * @returns {string[]}
 */
export function resolveBrandAlias(commonBrand) {
  const key = normalizeForAlias(commonBrand);
  if (!key) return [];
  const list = UPC_BRAND_PREFIX_BY_KEY.get(key);
  return list ? [...list] : [];
}

/**
 * Infer brand similarity between UPCitemdb brand and MLCC product name (0–1).
 * @param {string | null | undefined} upcBrand
 * @param {string | null | undefined} mlccName
 * @returns {number}
 */
export function inferBrandAlias(upcBrand, mlccName) {
  const a = normalizeForAlias(upcBrand);
  const b = normalizeForAlias(mlccName);
  if (!a || !b) return 0;
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared += 1;
  }
  const overlap = shared / Math.max(ta.length, tb.length);
  const firstMatch = ta[0] === tb[0];
  if (firstMatch && overlap > 0.5) return 0.9;
  if (overlap > 0.6) return 0.6;
  if (overlap > 0.3) return 0.3;
  return 0;
}
