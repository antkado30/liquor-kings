/**
 * Maps consumer-facing category hints (from UPC titles) to MLCC retailer category substring patterns.
 */

const WHISKEY_LIKE = [
  "TENNESSEE",
  "STRAIGHT BOURBON",
  "SCOTCH",
  "IRISH WHISKEY",
  "STRAIGHT RYE",
  "MISCELLANEOUS WHISKEY",
  "CANADIAN",
  "AMERICAN BLEND",
  "BOURBON",
  "RYE",
  "WHISKEY",
];

const LIQUEUR_LIKE = [
  "CORDIALS & LIQUEURS - AMERICAN",
  "CORDIALS & LIQUEURS - FOREIGN",
  "LIQUEUR",
  "AMARETTO",
  "CREAM",
];

/** @type {Record<string, readonly string[]>} */
export const CATEGORY_HINT_TO_MLCC = {
  whiskey: WHISKEY_LIKE,
  whisky: WHISKEY_LIKE,
  bourbon: ["STRAIGHT BOURBON", "BOURBON"],
  scotch: ["SCOTCH"],
  rye: ["STRAIGHT RYE", "RYE"],
  tennessee: ["TENNESSEE"],
  canadian: ["CANADIAN"],
  irish: ["IRISH WHISKEY"],
  vodka: ["VODKA", "FLAVORED VODKA"],
  gin: ["GIN", "FLAVORED GIN"],
  rum: ["RUM"],
  tequila: ["TEQUILA"],
  mezcal: ["TEQUILA"],
  brandy: ["BRANDY", "COGNAC"],
  cognac: ["COGNAC"],
  armagnac: ["BRANDY - FOREIGN"],
  liqueur: LIQUEUR_LIKE,
  cordial: LIQUEUR_LIKE,
  schnapps: LIQUEUR_LIKE,
  amaretto: ["AMARETTO"],
  cream: ["CREAM"],
  cocktail: ["PREPARED COCKTAILS"],
  premix: ["PREPARED COCKTAILS"],
  prepared: ["PREPARED COCKTAILS"],
  martini: ["PREPARED COCKTAILS"],
  wine: ["WINE"],
  beer: ["BEER", "ALE", "LAGER"],
};

/** Non-whiskey spirit / cocktail patterns in MLCC category text (whiskey UPC must not land here). */
const SPIRITS_NON_WHISKEY = [
  "VODKA",
  "FLAVORED VODKA",
  "RUM",
  "GIN",
  "FLAVORED GIN",
  "TEQUILA",
  "BRANDY",
  "COGNAC",
  "PREPARED COCKTAILS",
];

/** Brown / other spirits: rum UPC must not match these category families. */
const NON_RUM_MLCC = [...WHISKEY_LIKE, ...SPIRITS_NON_WHISKEY.filter((s) => s !== "RUM")];

const NON_GIN_MLCC = [...WHISKEY_LIKE, ...SPIRITS_NON_WHISKEY.filter((s) => s !== "GIN" && s !== "FLAVORED GIN")];

const NON_TEQUILA_MLCC = [...WHISKEY_LIKE, ...SPIRITS_NON_WHISKEY.filter((s) => s !== "TEQUILA")];

const NON_BRANDY_MLCC = [...WHISKEY_LIKE, ...SPIRITS_NON_WHISKEY.filter((s) => s !== "BRANDY" && s !== "COGNAC")];

/** Category substrings that conflict with a given hint (case-insensitive check on MLCC category). */
/** @type {Record<string, readonly string[]>} */
export const DISQUALIFIER_MAP = {
  whiskey: SPIRITS_NON_WHISKEY,
  whisky: SPIRITS_NON_WHISKEY,
  bourbon: SPIRITS_NON_WHISKEY,
  scotch: SPIRITS_NON_WHISKEY,
  rye: SPIRITS_NON_WHISKEY,
  tennessee: SPIRITS_NON_WHISKEY,
  irish: SPIRITS_NON_WHISKEY,
  canadian: SPIRITS_NON_WHISKEY,
  vodka: ["PREPARED COCKTAILS"],
  rum: NON_RUM_MLCC,
  gin: NON_GIN_MLCC,
  tequila: NON_TEQUILA_MLCC,
  mezcal: NON_TEQUILA_MLCC,
  brandy: NON_BRANDY_MLCC,
  cognac: NON_BRANDY_MLCC,
  armagnac: NON_BRANDY_MLCC,
  liqueur: [],
  cordial: [],
  schnapps: [],
  amaretto: [],
  cream: [],
  cocktail: [],
  premix: [],
  prepared: [],
  martini: [],
  wine: [],
  beer: [],
};

/**
 * @param {string | null | undefined} mlccCategory
 * @param {string} hint
 * @returns {boolean}
 */
export function mlccCategoryMatchesHint(mlccCategory, hint) {
  const cat = String(mlccCategory ?? "").trim();
  const h = String(hint ?? "").trim().toLowerCase();
  if (!cat || !h) return false;
  const catU = cat.toUpperCase();
  const needles = CATEGORY_HINT_TO_MLCC[h];
  if (!needles?.length) return false;
  return needles.some((n) => catU.includes(String(n).toUpperCase()));
}

/**
 * @param {string | null | undefined} mlccCategory
 * @param {string[]} hints
 * @returns {boolean}
 */
export function mlccCategoryMatchesAnyHint(mlccCategory, hints) {
  const arr = Array.isArray(hints) ? hints : [];
  if (!arr.length) return true;
  return arr.some((hint) => mlccCategoryMatchesHint(mlccCategory, hint));
}

/**
 * @param {string[]} hints
 * @param {string | null | undefined} mlccCategory
 * @returns {boolean}
 */
export function isDisqualifyingMismatch(hints, mlccCategory) {
  const arr = Array.isArray(hints) ? hints : [];
  if (!arr.length) return false;
  const catRaw = String(mlccCategory ?? "").trim();
  if (!catRaw) return false;
  const catU = catRaw.toUpperCase();

  for (const h of arr) {
    const key = String(h ?? "").trim().toLowerCase();
    if (key === "vodka" && !arr.includes("cocktail")) {
      if (catU.includes("PREPARED COCKTAILS")) return true;
      if (catU.includes("COCKTAIL") && !catU.includes("FLAVORED VODKA")) return true;
    }
    const blocked = DISQUALIFIER_MAP[key];
    if (!blocked?.length) continue;
    for (const b of blocked) {
      if (catU.includes(String(b).toUpperCase())) return true;
    }
  }
  return false;
}
