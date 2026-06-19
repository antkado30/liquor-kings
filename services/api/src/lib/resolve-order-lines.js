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

/** Brand/identity tokens from a product name (drops sizes, fillers, numbers-only). */
export function tokenizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .slice(0, 6);
}

/** Lower is better. Plain product first, size/packaging preference, then brevity. */
export function scoreCandidate(name, terms, prefer) {
  const lname = String(name || "").toLowerCase();
  const lterms = (terms || []).map((t) => String(t).toLowerCase());
  let flavorPenalty = 0;
  for (const f of FLAVOR_WORDS) {
    if (lname.includes(f) && !lterms.some((t) => f.includes(t) || t.includes(f))) {
      flavorPenalty += 1;
    }
  }
  const isPL = / pl\b/.test(lname) || lname.endsWith(" pl");
  let preferPenalty = 0;
  if (prefer === "plastic" && !isPL) preferPenalty = 1;
  if (prefer === "glass" && isPL) preferPenalty = 1;
  return flavorPenalty * 100 + preferPenalty * 30 + lname.length;
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
 * Ordered search attempts for a set of terms. MLCC abbreviates brand leads
 * ("Jack Daniel's" → "J DANIELS", "Seagram's 7" → "SEAGRAM'S 7"), so a strict
 * %jack% AND %daniel% match finds nothing. If the strict AND yields no rows we
 * drop the brand-lead token, then fall back to the single most-distinctive
 * (longest) token. Each fallback runs only when the prior found nothing, so it
 * can only turn a zero-result into a result — never override a good strict hit.
 */
export function termAttempts(terms) {
  const t = terms.slice(0, 6);
  const attempts = [t];
  if (t.length > 1) attempts.push(t.slice(1));
  if (t.length > 1) {
    const longest = [...t].sort((a, b) => b.length - a.length)[0];
    attempts.push([longest]);
  }
  return attempts;
}

async function queryByTerms(supabase, terms) {
  let q = supabase.from("mlcc_items").select(SELECT_COLS);
  for (const t of terms) q = q.ilike("name", `%${t}%`);
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

  let all = [];
  let usedTerms = baseTerms;
  for (const attempt of termAttempts(baseTerms)) {
    const { data, error } = await queryByTerms(supabase, attempt);
    if (error) {
      return { best: null, alternates: [], exactHit: false, total: 0, terms: attempt, error: error.message, confidence: "none" };
    }
    if (data && data.length > 0) {
      all = data;
      usedTerms = attempt;
      break;
    }
  }

  const exact = line.sizeMl ? all.filter((c) => c.bottle_size_ml === line.sizeMl) : all;
  const pool = line.sizeMl && exact.length > 0 ? exact : all;
  pool.sort(
    (a, b) =>
      scoreCandidate(a.name, usedTerms, line.prefer) - scoreCandidate(b.name, usedTerms, line.prefer) ||
      a.name.localeCompare(b.name),
  );

  const ranked = pool.slice(0, 6);
  const exactHit = line.sizeMl ? exact.length > 0 : null;
  // Confidence: one exact-size hit = high; multiple or no-exact-size = review.
  let confidence = "review";
  if (ranked.length === 0) confidence = "none";
  else if (exactHit && exact.length === 1) confidence = "high";
  else if (exactHit) confidence = "medium";

  return {
    best: ranked[0] || null,
    alternates: ranked.slice(1),
    exactHit,
    total: all.length,
    terms: usedTerms,
    confidence,
  };
}
