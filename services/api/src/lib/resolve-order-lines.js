/**
 * Shared bulk order-resolution engine.
 *
 * Powers both:
 *   - scripts/resolve-order-codes.mjs (CLI)
 *   - POST /assistant/resolve-order   (in-app bulk paste → codes → cart)
 *
 * Design principle (why the in-app AI failed before): code resolution is
 * DETERMINISTIC, not left to the LLM's tool loop. An LLM may parse messy
 * free text into {name, sizeMl, qty} lines (it's good at that), but the
 * actual MLCC code match runs through scoreCandidate() here — same logic the
 * CLI proved on Tony's real order (25/25). One bad code = a wrong bottle, so
 * this layer is testable and boring on purpose.
 */

// Flavor/variant words. A candidate whose name contains one of these that the
// search terms did NOT ask for is penalized, so the PLAIN base product surfaces
// above flavored line-extensions (plain Svedka over Svedka Banana).
export const FLAVOR_WORDS = [
  "apple", "banana", "cherry", "honey", "fire", "peach", "vanilla", "cinnamon",
  "coffee", "espresso", "mango", "pineapple", "raspberry", "citron", "lime",
  "lemon", "orange", "grape", "watermelon", "coconut", "blueberry", "blackberry",
  "caramel", "ginger", "mint", "peppermint", "clementine", "zombie", "hurricane",
  "limon", "cream", "apricot", "salted", "toasted", "spiced", "cake", "punch",
  "melon", "strawberry", "grapefruit", "tamarind", "berry",
  // Premium / limited editions — always step-ups, never a base bottle. (We do
  // NOT include "black"/"gold"/"collectors"/"edition": those can BE the regular
  // product for some brands, so penalizing them could hide a real base.)
  "reserve", "select", "limited", "anniversary", "barrel", "batch", "bonded",
];

// Words that are size/packaging/filler, not brand identity — dropped from
// search terms so they don't over-constrain the ILIKE match.
const STOPWORDS = new Set([
  "the", "of", "and", "a", "ml", "liter", "litre", "l", "pl", "plastic", "glass",
  "bottle", "bottles", "case", "cases", "fifth", "pint", "gallon", "gallons",
  "half", "handle", "size", "shots", "shot", "same", "with", "normal", "regular",
]);

/** Free-text size → ml. Handles fifth/pint/half-gallon/etc. */
export function sizeFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(half\s*gallon|1\/2\s*gal(lon)?|1\.75\s*l?|handle)\b/.test(t)) return 1750;
  if (/\b(half\s*pint|1\/2\s*pint)\b/.test(t)) return 200;
  if (/\b(fifth|1\/5|750\s*ml?|750)\b/.test(t)) return 750;
  if (/\b(liter|litre|1\s*l\b|1000\s*ml?|1000)\b/.test(t)) return 1000;
  if (/\b(pint|375\s*ml?|375)\b/.test(t)) return 375;
  if (/\b(50\s*ml|mini|airplane)\b/.test(t)) return 50;
  if (/\b200\s*ml?\b/.test(t)) return 200;
  return null;
}

/** Plastic vs glass intent from free text (MLCC marks plastic " PL"). */
export function preferFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\bplastic|pet\b/.test(t)) return "plastic";
  if (/\bglass\b/.test(t)) return "glass";
  return null;
}

// Pure-number tokens that are BOTTLE SIZES (ml) — dropped from search terms
// (the size lives in its own column, not the name). Other numbers are kept
// because they're brand/age identity: 1792, 1800, 99, 360, 44, "10"/"12" yr.
const SIZE_NUMBERS = new Set([
  "50", "100", "200", "250", "375", "500", "700", "750", "1000", "1500", "1750",
]);

/** Brand/identity tokens from a product name (drops sizes, fillers; KEEPS brand numbers). */
export function tokenizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w) && !SIZE_NUMBERS.has(w))
    .slice(0, 6);
}

// Generic category words — NOT distinctive (every vodka says "vodka"). Excluded
// when picking the brand-anchor term so "tito vodka"'s anchor is "tito".
const GENERIC_WORDS = new Set([
  "vodka", "rum", "gin", "whiskey", "whisky", "tequila", "bourbon", "brandy",
  "liqueur", "wine", "cognac", "scotch", "schnapps", "spirit", "spirits",
  "cordial", "blended", "straight",
]);

// Age statements ("10 yr") + variety packs — premium/variant, never the
// standard bottle. Demoted so the plain product wins.
const VARIANT_RE = /\b(\d+\s*(yr|year)s?|variety)\b/;

// Penalty per DISTINCTIVE user term the candidate is MISSING. The brand words
// matter most; a candidate missing one is probably a different product. Set
// BELOW the flavor penalty (100) so an abbreviated standard ("J DANIELS",
// missing the typed "jack") still beats a fully-spelled flavor
// ("JACK DANIEL'S BLACKBERRY"), but high enough to kill cross-brand junk
// ("ATWATER" for "tito") and descriptor collisions ("1792 FULL PROOF" for "fris").
const MISSING_TERM_PENALTY = 60;

// Mutually-exclusive spirit categories. If the user names one and a candidate
// is a DIFFERENT one, it's the wrong product (McCormick Vodka vs McCormick Gin).
const CONFLICT_CATS = ["vodka", "gin", "rum", "tequila", "brandy"];

/**
 * Lower is better. Dominant signal: the candidate should contain the user's
 * DISTINCTIVE (non-generic) words — each one it's missing is penalized. Then
 * plain beats flavored/aged/variety, packaging preference, then brevity.
 */
export function scoreCandidate(name, terms, prefer) {
  const lname = String(name || "").toLowerCase();
  const lterms = (terms || []).map((t) => String(t).toLowerCase());

  let score = 0;
  for (const t of lterms) {
    if (t.length >= 3 && !GENERIC_WORDS.has(t) && !lname.includes(t)) {
      score += MISSING_TERM_PENALTY;
    }
  }

  let flavorPenalty = 0;
  for (const f of FLAVOR_WORDS) {
    if (lname.includes(f) && !lterms.some((t) => f.includes(t) || t.includes(f))) {
      flavorPenalty += 1;
    }
  }
  score += flavorPenalty * 100;

  if (VARIANT_RE.test(lname)) score += 120;

  const isPL = / pl\b/.test(lname) || lname.endsWith(" pl");
  if (prefer === "plastic" && !isPL) score += 30;
  if (prefer === "glass" && isPL) score += 30;

  // Category conflict: user named a distinct spirit category and the candidate
  // is a different one (McCormick Vodka vs McCormick Gin). Word-boundary so
  // "gin" doesn't match VIRGINIA/ORIGINAL; categories absent from the name
  // (e.g. "CROWN ROYAL") never conflict.
  const typedCat = CONFLICT_CATS.find((c) => lterms.includes(c));
  if (typedCat) {
    for (const c of CONFLICT_CATS) {
      if (c !== typedCat && new RegExp(`\\b${c}\\b`).test(lname)) {
        score += 50;
        break;
      }
    }
  }

  score += lname.length;
  return score;
}

// Enough columns to build a valid cart line client-side (id/code/name/ada_number
// are required by the cart; size/case/price drive liters, stepper, and cost).
const SELECT_COLS =
  "id,code,name,ada_number,ada_name,bottle_size_ml,bottle_size_label,case_size,licensee_price,proof,base_price,min_shelf_price";

/**
 * Resolve one parsed order line to MLCC candidates.
 * @param {object} line - { name, terms?, sizeMl?, prefer?, qty? }
 * @returns {Promise<{best, alternates, exactHit, total, terms, confidence}>}
 */
/**
 * PRECISE search sets — run together and MERGED. MLCC stores the SAME brand two
 * ways: the standard bottle abbreviated ("J DANIELS OLD 7 BLACK") and flavored
 * variants fully spelled ("JACK DANIEL'S BLACKBERRY"). A strict %jack% %daniels%
 * finds only the flavored full-spelled ones and misses the standard. So we ALSO
 * search the brand lead as its initial ("jack" → "j"), which matches BOTH
 * spellings (and still requires the distinctive rest, so it won't pull a
 * different brand like "GORDON DANIELS" that lacks a "j"). Merging both sets
 * puts the real standard in the pool next to the flavors, and the flavor
 * penalty in scoreCandidate then picks the plain bottle.
 */
export function preciseTermSets(terms) {
  const t = terms.slice(0, 6);
  const sets = [t];
  // Only expand the brand lead to its initial (jack -> j) when the REST has a
  // distinctive word to anchor on (e.g. "daniels"). Otherwise "tito vodka"
  // would expand to [t, vodka] and flood the pool with every vodka.
  const restDistinctive = t.slice(1).some((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
  if (t.length > 1 && t[0].length > 1 && restDistinctive) {
    sets.push([t[0][0], ...t.slice(1)]);
  }
  return sets;
}

/** Last-resort sets, used ONLY if precise found nothing (avoids cross-brand noise). */
export function fallbackTermSets(terms) {
  const t = terms.slice(0, 6);
  const sets = [];
  if (t.length > 1) sets.push(t.slice(1)); // drop the brand lead entirely
  if (t.length > 1) sets.push([[...t].sort((a, b) => b.length - a.length)[0]]); // longest token
  return sets;
}

async function queryByTerms(supabase, terms) {
  let q = supabase.from("mlcc_items").select(SELECT_COLS);
  for (const t of terms) {
    // Match the raw name OR the punct/space-free `name_searchable` column, so a
    // typed "titos" finds "TITO'S HANDMADE VODKA" and "rumchata" finds
    // "RUM CHATA" — apostrophes/spaces no longer break the match.
    const stripped = String(t).replace(/[^a-z0-9]/gi, "");
    q = stripped
      ? q.or(`name.ilike.%${t}%,name_searchable.ilike.%${stripped}%`)
      : q.ilike("name", `%${t}%`);
  }
  return q.limit(80);
}

export async function resolveOrderLine(supabase, line) {
  const baseTerms =
    Array.isArray(line.terms) && line.terms.length
      ? line.terms.map((t) => String(t).toLowerCase()).slice(0, 6)
      : tokenizeName(line.name);
  if (baseTerms.length === 0) {
    return { best: null, alternates: [], exactHit: false, total: 0, terms: baseTerms, confidence: "none" };
  }

  // 1) PRECISE: run all precise sets and MERGE (dedupe by code).
  const byCode = new Map();
  for (const set of preciseTermSets(baseTerms)) {
    const { data, error } = await queryByTerms(supabase, set);
    if (error) {
      return { best: null, alternates: [], exactHit: false, total: 0, terms: set, error: error.message, confidence: "none" };
    }
    for (const row of data || []) {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    }
  }
  let all = [...byCode.values()];

  // 2) FALLBACK: only if precise found nothing.
  if (all.length === 0) {
    for (const set of fallbackTermSets(baseTerms)) {
      const { data, error } = await queryByTerms(supabase, set);
      if (error) {
        return { best: null, alternates: [], exactHit: false, total: 0, terms: set, error: error.message, confidence: "none" };
      }
      if (data && data.length > 0) {
        all = data;
        break;
      }
    }
  }

  // Score against the user's ORIGINAL terms so the flavor penalty reflects intent.
  const exact = line.sizeMl ? all.filter((c) => c.bottle_size_ml === line.sizeMl) : all;
  const pool = line.sizeMl && exact.length > 0 ? exact : all;
  pool.sort(
    (a, b) =>
      scoreCandidate(a.name, baseTerms, line.prefer) - scoreCandidate(b.name, baseTerms, line.prefer) ||
      a.name.localeCompare(b.name),
  );

  const ranked = pool.slice(0, 6);
  const exactHit = line.sizeMl ? exact.length > 0 : null;
  // Confidence: exactly one exact-size hit = high; multiple (ambiguous) or
  // no exact-size = review/medium so the UI flags it for the user's eye.
  let confidence = "review";
  if (ranked.length === 0) confidence = "none";
  else if (exactHit && exact.length === 1) confidence = "high";
  else if (exactHit) confidence = "medium";

  return {
    best: ranked[0] || null,
    alternates: ranked.slice(1),
    exactHit,
    total: all.length,
    terms: baseTerms,
    confidence,
  };
}
