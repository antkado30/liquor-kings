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

import { loadFlagshipMap } from "./brand-flagships.js";

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
  // 2026-07-23 corpus additions — seasonal/line extensions that escaped the
  // penalty and beat flagships on the length tiebreak (Skrewball EGGNOG over
  // Peanut Butter, Carolans COLD BREW over Irish Cream). NOTE: "peanut" is
  // deliberately NOT here — Skrewball's FLAGSHIP is Peanut Butter Whiskey, so
  // penalizing "peanut" would demote the real bottle. Carolans Peanut Butter
  // is instead demoted by the flagship alias's irish+cream missing-term
  // penalty, not by a flavor penalty.
  "eggnog", "nog", "pumpkin", "smores", "horchata",
  // 2026-07-26 (vision one-matcher rewire, Tony's Smirnoff screenshot): the
  // ROOT BEER variant escaped every single-word penalty ("root" and "beer"
  // alone are risky — ROOT is a real liqueur brand — but the compound is
  // unambiguous; includes() matches the two-word phrase).
  "root beer",
  // 2026-08-12 (the CAPTAIN MORGAN ICED TEA whiff — "captain morgans fifth
  // x 3" resolved to the RTD iced tea): ready-to-drink cocktail lines are
  // variants, never a brand's base spirit. Compounds/unambiguous words only.
  // "sweet tea" is deliberately ABSENT — Firefly's FLAGSHIP is Sweet Tea
  // Vodka (the Skrewball-peanut rule). "margarita" is safe even though
  // Margaritaville is a brand: typing "margaritaville" waives it via the
  // t.includes(f) check.
  "iced tea", "margarita", "daiquiri", "colada", "mojito", "sangria", "mai tai",
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
  // "double shot" = the 100ml bottle — Tony's own register vocabulary,
  // confirmed 2026-07-23 ("Tito's double shot x case" = Tito's 100ml by the
  // case). Was unmapped and produced cognac nonsense.
  if (/\b(double\s*shot|100\s*ml)\b/.test(t)) return 100;
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

/*
 * FLAGSHIP ALIASES (Tony's law, 2026-07-23): a BARE brand on an order list
 * means the flagship plain bottle — "Bacardi rum" is Superior, "Skrewball"
 * is the Peanut Butter, "Carolans" is the Irish Cream, "Fireball" is the
 * Cinnamon. Without this, the length tiebreak crowned seasonal
 * line-extensions (SKREWBALL EGGNOG over the flagship) and the flagship
 * itself sometimes ate a flavor penalty for containing its own name
 * (CAROLANS IRISH CREAM). A query is "bare" when its only non-generic
 * token IS the alias key — any extra distinctive word ("bacardi spiced")
 * disables the alias. Injecting the flagship's own words into the terms
 * also waives their flavor penalties naturally.
 * In-code map for now; graduates to the per-store memory table with the
 * no-drift build (a store's own usuals will refine flagship choice).
 */
export const FLAGSHIP_ALIASES = {
  bacardi: ["bacardi", "superior"],
  skrewball: ["skrewball", "peanut", "butter"],
  carolans: ["carolans", "irish", "cream"],
  fireball: ["fireball", "cinnamon"],
  /*
   * CAPTAIN MORGAN (2026-08-12, Tony's SQL dump — catalog truth): the
   * flagship is stored ABBREVIATED as "CAPT MORGAN SPICED RUM (P R)"
   * (41307 is the 750) while flavors are fully spelled. Injecting
   * "spiced" is what saves the flagship from its own flavor penalty
   * (the Carolans irish-cream case) and demotes White Rum / Iced Tea /
   * Sliced Apple by a missing term. "capt" (not "captain") anchors the
   * abbreviated spelling; the fully-spelled flavors still match it as
   * a substring of "captain". TWO-token keys below cover how people
   * actually write it.
   */
  captain: ["capt", "morgan", "spiced", "rum"],
  "captain morgan": ["capt", "morgan", "spiced", "rum"],
  "captain morgans": ["capt", "morgan", "spiced", "rum"],
  "capt morgan": ["capt", "morgan", "spiced", "rum"],
  "capt morgans": ["capt", "morgan", "spiced", "rum"],
  "capt morg": ["capt", "morgan", "spiced", "rum"],
  "captain morg": ["capt", "morgan", "spiced", "rum"],
};

/** "morgans" → "morgan" for key lookup; real brands ending in s survive
    because their EXACT key is tried first (keys length ≤3 never touched). */
function depluralizeKey(t) {
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

/** Bare-brand → flagship terms; anything more specific passes through.
    Keys are one OR two distinctive tokens ("captain morgans" is still a
    bare brand — 2026-08-12); any extra distinctive word disables the
    alias. The static map (curated, in-code) is consulted FIRST; the
    dynamic map (derived brand_flagships table, loaded per resolve with
    a 5-min cache) covers EVERY other brand — Tony's 2026-08-12 law:
    "it has to work for EVERY bottle." */
export function applyFlagshipAlias(terms, dynamicMap = null) {
  const distinctive = (terms || []).filter((t) => !GENERIC_WORDS.has(t));
  const keys = [];
  if (distinctive.length === 1) {
    keys.push(distinctive[0], depluralizeKey(distinctive[0]));
  } else if (distinctive.length === 2) {
    keys.push(
      `${distinctive[0]} ${distinctive[1]}`,
      `${depluralizeKey(distinctive[0])} ${depluralizeKey(distinctive[1])}`,
    );
  }
  for (const k of keys) {
    if (FLAGSHIP_ALIASES[k]) return FLAGSHIP_ALIASES[k];
  }
  if (dynamicMap && typeof dynamicMap.get === "function") {
    for (const k of keys) {
      const hit = dynamicMap.get(k);
      if (Array.isArray(hit) && hit.length > 0) return hit;
    }
  }
  return terms;
}

/*
 * BRAND SYNONYMS (Tony's store facts, 2026-07-23): a token the owner types
 * that maps to how MLCC actually spells the brand. Unlike flagship aliases,
 * these apply PER-TOKEN regardless of the other words on the line, so
 * "Stoli vanilla" and "Stoli razz" both expand the "stoli" token. Confirmed
 * facts only — graduates to the per-store memory table with the no-drift build.
 */
export const BRAND_SYNONYMS = {
  stoli: "stolichnaya",
  stolis: "stolichnaya",
};

/** Expand any known brand-synonym tokens; leaves everything else untouched. */
export function applyBrandSynonyms(terms) {
  return (terms || []).map((t) => BRAND_SYNONYMS[String(t).toLowerCase()] ?? t);
}

// Penalty per DISTINCTIVE user term the candidate is MISSING. The brand words
// matter most; a candidate missing one is probably a different product. Set
// BELOW the flavor penalty (100) so an abbreviated standard ("J DANIELS",
// missing the typed "jack") still beats a fully-spelled flavor
// ("JACK DANIEL'S BLACKBERRY"), but high enough to kill cross-brand junk
// ("ATWATER" for "tito") and descriptor collisions ("1792 FULL PROOF" for "fris").
const MISSING_TERM_PENALTY = 60;
// Age/variety demotion — kept BELOW MISSING_TERM_PENALTY so a correct-brand
// aged bottle ("KIRKLAND CANADIAN 6 YR") still beats a different brand.
const VARIANT_PENALTY = 40;

/*
 * ORDERED-BEFORE BONUS (2026-08-12, the captain-morgan-iced-tea whiff).
 * A candidate this store has ACTUALLY ORDERED (per its MILO confirmations)
 * gets a bonus — deliberately smaller than EVERY real penalty (variant 40,
 * missing-term 60, flavor 100, lead 150) so history is a TIE-BREAKER, never
 * an override:
 *   - "captain morgans fifth": Original Spiced and Iced Tea both eat a
 *     +100 flavor penalty (spiced / iced tea) — history crowns the bottle
 *     the store actually buys. Per store, automatic, no curation.
 *   - "captain morgan iced tea" typed: the iced-tea penalty is WAIVED by
 *     the typed words; the flagship still eats +100 — the typed variant
 *     wins even against history. Typed words always outrank habit.
 */
export const ORDERED_BEFORE_BONUS = 35;

// Mutually-exclusive spirit categories. If the user names one and a candidate
// is a DIFFERENT one, it's the wrong product (McCormick Vodka vs McCormick Gin).
const CONFLICT_CATS = ["vodka", "gin", "rum", "tequila", "brandy"];

// Packaging descriptors — handled by `prefer` scoring, never treated as a
// distinctive identity word for coverage ("Platinum 7x plastic" — "plastic"
// names the material, not the product).
const PACKAGING_WORDS = new Set(["plastic", "glass", "pl"]);

/** First token of a lowercased product name ("j daniels…" → "j"). Used by the
    brand-initial shortcut in BOTH scoring and coverage (kept mirrored). */
function firstNameToken(lname) {
  const m = String(lname).match(/[a-z0-9]+/);
  return m ? m[0] : "";
}

/*
 * 2026-07-25 (the connoisseur-list live test): "Blanton's Single Barrel" →
 * CRUZAN SINGLE BARREL because missing the BRAND cost the same 60 as missing
 * one descriptor — so a wrong brand carrying the descriptors outvoted the
 * right brand missing them. The brand word IS the product; descriptors only
 * narrow it. Lead-missing now costs 150 (> two descriptors), so a brand hit
 * always beats a descriptor hit.
 */
const LEAD_MISSING_PENALTY = 150;

/** ONE presence truth shared by scoring AND confidence coverage (mirror law,
    2026-07-25 — they had drifted: coverage knew stripped-punctuation compare,
    scoring didn't, so TITO'S ate a penalty from its own apostrophe). Pure
    numbers match on word boundaries only ("10" never hides inside "100"). */
/** Consonant skeleton: lowercase letters, vowels out, doubled consonants
    collapsed — the shape MLCC's abbreviations keep. single→sngl, barrel→brl,
    BRRL→brl, year→yr. Equality of skeletons = the same word abbreviated. */
function consonantSkeleton(word) {
  return String(word)
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/*
 * Flavor presence with MLCC-truncation tolerance (2026-08-12, Tony's
 * Captain Morgan SQL dump: "TROPICL PNCH" escaped the "punch" penalty
 * because the flavor check was a plain substring). A flavor word is
 * present when:
 *   (a) the name contains it outright (unchanged), OR
 *   (b) for single words ≥5 chars: a NAME TOKEN of equal-or-shorter
 *       length has the identical consonant skeleton (PNCH ↔ punch,
 *       VANIL ↔ vanilla). The ≤-length guard matters: truncations are
 *       never LONGER than the word, which keeps PANACHE (7 chars, also
 *       pnch) from eating a "punch" penalty.
 * A plain-prefix rule was tried and REVERTED in the same commit: "OLD 7
 * BLACK" (the standard Jack Daniel's) read as truncated BLACKberry —
 * whole real words that prefix a longer flavor are exactly the class
 * the FLAVOR_WORDS comment bans. Skeletons don't collide there (black →
 * blck ≠ blackberry → blckbr).
 * Compound flavors ("root beer", "iced tea") keep plain substring — a
 * truncated half of a compound is too ambiguous to accuse.
 */
export function flavorPresentIn(lname, f) {
  if (lname.includes(f)) return true;
  if (f.includes(" ")) return false;
  if (f.length >= 5) {
    const sk = consonantSkeleton(f);
    // ≥3: vanilla's skeleton is only "vnl" — a ≥4 guard missed VANIL. The
    // ≤-length token guard is what prevents collisions, not skeleton size.
    if (sk.length >= 3) {
      return lname
        .split(/[^a-z0-9]+/)
        .some((tok) => tok.length >= 3 && tok.length <= f.length && consonantSkeleton(tok) === sk);
    }
  }
  return false;
}

function termPresentIn(lname, strippedName, t, idx) {
  if (/^\d+$/.test(t)) return new RegExp(`\\b${t}\\b`).test(lname);
  const st = t.replace(/[^a-z0-9]/g, "");
  let present = lname.includes(t) || (st.length >= 3 && strippedName.includes(st));
  if (!present && t.length >= 6) {
    present = lname.includes(t.slice(0, 5)) || strippedName.includes(st.slice(0, 5));
  }
  if (!present) {
    // NAME-TOKEN-IS-A-PREFIX truncation (2026-08-12, Tony's Morgan SQL dump:
    // the flagship lives as "CAPT MORGAN SPICED RUM" / "CAPT MORG LONG ISL
    // ICED TEA" — MLCC chops words to 4+ chars, so "captain" and "morgans"
    // read as MISSING from the very bottle they name). A name token of ≥4
    // chars that the typed word STARTS WITH is that word truncated:
    // capt→captain, morg→morgans. Strictly-longer guard keeps a full word
    // from being "truncated" by itself (includes already handled equality).
    present = lname
      .split(/[^a-z0-9]+/)
      .some((tok) => tok.length >= 4 && t.length > tok.length && t.startsWith(tok));
  }
  if (!present && st.length >= 3) {
    // MLCC abbreviation match (2026-07-25, the Michter's-10 whiff): "SNGL
    // BRL BBN-10 YR" must satisfy "single barrel". Exact skeleton equality
    // against whole name tokens only — never substrings — keeps this tight.
    const sk = consonantSkeleton(t);
    if (sk.length >= 2) {
      present = lname
        .split(/[^a-z0-9]+/)
        .some((tok) => tok.length >= 2 && consonantSkeleton(tok) === sk);
    }
  }
  if (!present && idx === 0) present = firstNameToken(lname) === t[0];
  return present;
}

/** Which terms get present-checked: distinctive words ≥3 chars OR pure
    numbers ≥2 digits — "Michter's 10 Year" / "Sazerac 18": the age IS the
    identity in whiskey (2026-07-25; small numbers were invisible before). */
function termEligible(t) {
  return (
    (t.length >= 3 || /^\d{2,}$/.test(t)) &&
    !GENERIC_WORDS.has(t) &&
    !PACKAGING_WORDS.has(t)
  );
}

/**
 * termCoverage — which of the user's DISTINCTIVE words the candidate name
 * actually contains (2026-07-24 confidence calibration). Presence semantics
 * mirror scoreCandidate's missing-term check (substring, 5-char prefix for
 * ≥6-char words, lead-initial with the possessive-'s lookbehind) PLUS a
 * punctuation-stripped compare ("tito's" ↔ TITO'S, matching the
 * name_searchable behavior of the SQL layer). Used by the confidence ladder
 * only — scoring is intentionally untouched (calibration, not re-ranking).
 */
export function termCoverage(name, terms) {
  const lname = String(name || "").toLowerCase();
  const strippedName = lname.replace(/[^a-z0-9]/g, "");
  const eligible = [];
  (terms || []).forEach((raw, idx) => {
    const t = String(raw).toLowerCase();
    if (!termEligible(t)) return;
    eligible.push(termPresentIn(lname, strippedName, t, idx));
  });
  return {
    hasEligible: eligible.length > 0,
    leadCovered: eligible.length > 0 ? eligible[0] : true,
    allCovered: eligible.every(Boolean),
  };
}

/**
 * Lower is better. Dominant signal: the candidate should contain the user's
 * DISTINCTIVE (non-generic) words — each one it's missing is penalized. Then
 * plain beats flavored/aged/variety, packaging preference, then brevity.
 */
export function scoreCandidate(name, terms, prefer, extra = {}) {
  const lname = String(name || "").toLowerCase();
  const lterms = (terms || []).map((t) => String(t).toLowerCase());

  let score = 0;
  // Missing distinctive-term penalty. A term counts as PRESENT if:
  //   (a) the name includes it outright, OR
  //   (b) the name includes its 5-char prefix (MLCC truncates long words —
  //       "VANILLA" → "VANIL", "REPOSADO" → "REPOS"), OR
  //   (c) ONLY for the brand-lead term: the name has the initial as a
  //       standalone letter ("Jack" → "J DANIELS").
  // (c) is restricted to the lead AND excludes a possessive-'s, because that
  // was falsely satisfying a wrong brand: "skrewball" read as present in
  // "RAM'S POINT" and "stolichnaya" in "BURNETT'S" via the trailing 's
  // (2026-07-23 corpus — Skrewball→Ram's, Stoli→Burnett's). A genuinely
  // different brand ("CANADIAN LAKE" for "kirkland") still has none → penalized.
  // 2026-07-25: presence + eligibility now SHARED with termCoverage
  // (termPresentIn/termEligible — one truth, mirror law). The LEAD (brand)
  // term missing costs 150 so descriptors can never outvote the brand
  // ("Blanton's Single Barrel" must not lose to CRUZAN SINGLE BARREL), and
  // pure-number ages ("10", "18") are now scored on word boundaries.
  const strippedName = lname.replace(/[^a-z0-9]/g, "");
  lterms.forEach((t, idx) => {
    if (termEligible(t)) {
      if (!termPresentIn(lname, strippedName, t, idx)) {
        score += idx === 0 ? LEAD_MISSING_PENALTY : MISSING_TERM_PENALTY;
      }
    }
  });

  /*
   * MAXIMAL-HIT dedupe (2026-08-12, the Malibu margin distortion):
   * "PINEAPPLE" used to fire BOTH the apple and pineapple penalties
   * (likewise straw/blue/blackBERRY + berry, pepperMINT + mint) — the
   * direction was harmless but the doubled margin bought false-green
   * badges. A flavor hit that is a substring of ANOTHER hit is the same
   * evidence, counted once.
   */
  const flavorHits = FLAVOR_WORDS.filter(
    (f) => flavorPresentIn(lname, f) && !lterms.some((t) => f.includes(t) || t.includes(f)),
  );
  const flavorPenalty = flavorHits.filter(
    (f) => !flavorHits.some((g) => g !== f && g.includes(f)),
  ).length;
  score += flavorPenalty * 100;

  // Age statement ("10 yr") / variety pack — a step-up, demoted (below the
  // missing-brand penalty so a correct-brand aged bottle still beats a wrong
  // brand). Waived when the user actually typed that age number ("rebel 10").
  const variantMatch = lname.match(VARIANT_RE);
  if (variantMatch) {
    const ageNum = (variantMatch[0].match(/\d+/) || [])[0];
    if (!(ageNum && lterms.includes(ageNum))) score += VARIANT_PENALTY;
  }

  const isPL = / pl\b/.test(lname) || lname.endsWith(" pl");
  if (prefer === "plastic" && !isPL) score += 30;
  if (prefer === "glass" && isPL) score += 30;

  /*
   * 2026-07-23 corpus penalties (both via the optional `extra` arg — the
   * signature stays back-compatible for every existing caller/test):
   *  - Combo/gift packs ("W/ 2 GLS", 50ml-rider sleeves) are never the
   *    intent of a plain order line. Demoted below real bottles; they
   *    survive as alternates.
   *  - Proof-line variants (the SMIRNOFF 100 class): a bare proof number
   *    the owner did NOT write is a step-up, not the flagship. Checked
   *    against the RAW line text because tokenizeName strips "100" as a
   *    size number, so the terms can't carry the waiver.
   */
  if (extra?.row?.is_combo === true) score += 45;
  const proofMatch = lname.match(/\b(100|101|151|190)\b/);
  if (proofMatch && !String(extra?.rawText || "").includes(proofMatch[1])) {
    score += 25;
  }

  // Store history tie-breaker — see ORDERED_BEFORE_BONUS above.
  if (extra?.orderedBefore === true) score -= ORDERED_BEFORE_BONUS;

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
// container + pack_count (2026-07-12): identity truth for the verify card —
// a 12-pack of minis and a single mini share size+material but are different
// orderable products; the AI's verify screen must say which one it matched.
// family_key added 2026-07-24 (size-flip on the resolve card): lets the
// assistant batch-fetch a matched bottle's sibling sizes in one query.
const SELECT_COLS =
  "id,code,name,ada_number,ada_name,bottle_size_ml,bottle_size_label,case_size,licensee_price,proof,base_price,min_shelf_price,container,pack_count,is_combo,family_key";

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
  // Typo tolerance (2026-07-23, the "Glenfidich" whiff): the brand lead's
  // 5-char prefix alone — %glenf% reaches GLENFIDDICH past the missing
  // double-d. Wide pool, but the size filter, age-waiver scoring, and the
  // review confidence flag keep it honest. FIRST so it outranks the
  // brand-dropping sets that caused cross-brand junk.
  if (t[0] && t[0].length >= 6) sets.push([t[0].slice(0, 5)]);
  if (t.length > 1) sets.push(t.slice(1)); // drop the brand lead entirely
  if (t.length > 1) sets.push([[...t].sort((a, b) => b.length - a.length)[0]]); // longest token
  return sets;
}

async function queryByTerms(supabase, terms) {
  /*
   * 2026-07-23 corpus fixes (audit-corpus-2026-07-23.mjs evidence):
   *  - GENERIC category words are NOT ANDed into the SQL when a distinctive
   *    term exists. "bacardi rum" used to REQUIRE %rum% in the candidate
   *    name, which excluded BACARDI SUPERIOR entirely (no "RUM" in its
   *    name) and left only Spiced/Punch in the pool; "three olives cherry
   *    vodka" excluded THREE OLIVES CHERRY the same way and handed the
   *    owner VEIL. Scoring still uses generics (category-conflict check) —
   *    they just can't veto the pool anymore.
   *  - Terms ≥6 chars match by PREFIX (first len-2 chars): MLCC truncates
   *    words ("STOLI VANIL"), so %vanilla% missed it while %vanil% hits
   *    both spellings. Slightly wider pools; scoring decides.
   */
  const distinctive = terms.filter((t) => !GENERIC_WORDS.has(String(t).toLowerCase()));
  const queryTerms = distinctive.length > 0 ? distinctive : terms;
  let q = supabase.from("mlcc_items").select(SELECT_COLS);
  for (const t of queryTerms) {
    const ts = String(t);
    const qt = ts.length >= 6 ? ts.slice(0, ts.length - 2) : ts;
    // Match the raw name OR the punct/space-free `name_searchable` column, so a
    // typed "titos" finds "TITO'S HANDMADE VODKA" and "rumchata" finds
    // "RUM CHATA" — apostrophes/spaces no longer break the match.
    const stripped = qt.replace(/[^a-z0-9]/gi, "");
    q = stripped
      ? q.or(`name.ilike.%${qt}%,name_searchable.ilike.%${stripped}%`)
      : q.ilike("name", `%${qt}%`);
  }
  /*
   * 2026-07-23: limit raised 80 → 400. A broad brand with many flavor SKUs
   * (Smirnoff, Absolut, New Amsterdam…) can exceed 80 rows, and the cap
   * TRUNCATED the flagship out of the pool BEFORE scoring — "Smirnoff" half
   * pint returned SMIRNOFF 100 at high confidence only because SMIRNOFF 80 PL
   * (the real default, confirmed present via probe-catalog-size.mjs) got cut.
   * The plain bottle can never be crowded out by its own flavors again.
   * 400 comfortably exceeds any single brand's SKU count; scoring still picks
   * the winner, so a bigger pool only helps.
   */
  return q.limit(400);
}

export async function resolveOrderLine(supabase, line, opts = {}) {
  // opts.orderedCodes: Set of normalized MLCC codes this store has actually
  // ordered (fetchOrderedCodeSet) — the tie-breaker signal. Optional and
  // fail-soft: absent/empty Set = scoring identical to before.
  const orderedCodes =
    opts?.orderedCodes instanceof Set ? opts.orderedCodes : null;
  // Explicit operator-authored terms pass through untouched; tokenized
  // free text gets brand-synonym expansion (stoli→stolichnaya) THEN the
  // bare-brand → flagship expansion (Tony's law). Synonyms run first so a
  // synonym'd bare brand can still hit a flagship alias if one exists.
  const baseTerms =
    Array.isArray(line.terms) && line.terms.length
      ? applyBrandSynonyms(line.terms.map((t) => String(t).toLowerCase()).slice(0, 6))
      : applyFlagshipAlias(
          applyBrandSynonyms(tokenizeName(line.name)),
          await loadFlagshipMap(supabase),
        );
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
  /*
   * SIZE HONESTY (2026-07-23, the Platinum 7X law): when the owner asked
   * for a size and NO candidate exists at that size, the resolver may
   * still surface the closest product — but it must SAY SO and can never
   * wear a confident badge. Silently handing a 100ml where a 1750 was
   * asked is a size lie, the exact class the 7/11 photo-truth mandate
   * bans. sizeMismatch rides the return so the tool result, the model's
   * words, and the card all tell the same truth.
   */
  let sizeMismatch = Boolean(line.sizeMl) && all.length > 0 && exact.length === 0;
  let pool = line.sizeMl && exact.length > 0 ? exact : all;
  // rawText: the line as the human wrote it (proof-number waivers read it —
  // "Smirnoff 100" typed deliberately must not demote SMIRNOFF 100).
  const rawText = String(line.rawText ?? line.name ?? "").toLowerCase();
  // ONE scorer for sort AND the confidence margins below — if they used
  // different extras the badge would measure a different race than the
  // one that picked the winner.
  const scoreFor = (c) =>
    scoreCandidate(c.name, baseTerms, line.prefer, {
      row: c,
      rawText,
      orderedBefore:
        orderedCodes != null &&
        orderedCodes.has(String(c.code ?? "").trim().replace(/^0+(?=\d)/, "")),
    });
  /*
   * PRODUCT TRUTH BEATS SIZE TRUTH (2026-08-12, found by the Morgan
   * fixture: "captain morgan iced tea" at a fifth — the iced tea only
   * exists at 375/1750, so the size filter silently swapped in the
   * SPICED flagship at 750. A different product at the right size is a
   * WORSE lie than the right product at a different size.) When the
   * best candidate ignoring size beats the best size-exact candidate by
   * at least a full distinctive word (MISSING_TERM_PENALTY), the owner
   * named a product that doesn't come in that size: surface the named
   * product, flag the size mismatch, wear review. A same-product size
   * gap never triggers this (its score is identical across sizes).
   */
  if (line.sizeMl && exact.length > 0 && all.length > exact.length) {
    const bestExactScore = Math.min(...exact.map(scoreFor));
    const bestAll = [...all].sort((a, b) => scoreFor(a) - scoreFor(b))[0];
    if (scoreFor(bestAll) + MISSING_TERM_PENALTY <= bestExactScore) {
      pool = all;
      sizeMismatch = true;
    }
  }
  pool.sort((a, b) => scoreFor(a) - scoreFor(b) || a.name.localeCompare(b.name));

  const ranked = pool.slice(0, 6);
  const exactHit = line.sizeMl ? exact.length > 0 && !sizeMismatch : null;
  /*
   * EVIDENCE-BASED CONFIDENCE (2026-07-24 calibration — stress-catalog run,
   * N=200 seed=20260724, docs/lk/stress-catalog-2026-07-24.md). The old rule
   * was purely structural ("exactly one exact-size row = high") and failed
   * both directions:
   *   - A perfect match with brand-mates in the pool wore "check" — 27 amber
   *     badges on Tony's near-perfect live order = alarm fatigue.
   *   - A single wrong-brand fallback row wore high — the stress run's only
   *     HIGH-CONF-WRONG class ("smrnoff citrus" → PINNACLE CITRUS).
   * New ladder, read from what the match actually EVIDENCES:
   *   review — size mismatch (never a quiet substitute), OR the user's LEAD
   *            (brand) word appears nowhere in the best match: a cross-brand
   *            guess must never wear a confident badge.
   *   high   — exact size + EVERY distinctive user word present in the match
   *            + a clear lead (≥ VARIANT_PENALTY) over the nearest different-
   *            name rival (or no rival at all). "Casamigos reposado" beating
   *            CENOTE REPOSADO is green: the win is evidenced, not lucky.
   *   medium — exact size, brand present, but contested (different-name
   *            rivals inside the margin — bare "Limoncello" across brands)
   *            or some distinctive word unmatched. Amber MEANS something now.
   */
  // Coverage of the BEST match, computed once: drives confidence AND the
  // leadMissing signal (2026-07-25 — "Blanton's" in July: when the brand
  // word matches NOTHING, the bottle is likely not in the current book at
  // all; the UI/model must say that instead of headlining a stranger).
  const bestCov = ranked.length > 0 ? termCoverage(ranked[0].name, baseTerms) : null;
  const leadMissing = Boolean(bestCov && bestCov.hasEligible && !bestCov.leadCovered);
  let confidence = "review";
  if (ranked.length === 0) confidence = "none";
  else if (sizeMismatch) confidence = "review";
  else if (exactHit) {
    const cov = bestCov;
    if (cov.hasEligible && !cov.leadCovered) {
      confidence = "review";
    } else {
      const rival = ranked.find((c) => c.name !== ranked[0].name);
      const margin = rival ? scoreFor(rival) - scoreFor(ranked[0]) : Infinity;
      confidence = cov.allCovered && margin >= VARIANT_PENALTY ? "high" : "medium";
    }
  } else if (exactHit === null && bestCov && !leadMissing) {
    /*
     * NO-SIZE CONFIDENCE (2026-07-25, the connoisseur rematch: every
     * correctly-found allocated bottle wore REVIEW only because no size was
     * spoken). When the phrase names the bottle unambiguously, it earns its
     * badge without a size:
     *   high   — every distinctive word covered, ≥2 eligible terms (a
     *            single-word phrase like "rocks" can never go green), the
     *            product exists at exactly ONE size in the pool (nothing to
     *            pick), and a clear margin over the nearest different-name
     *            rival. "High West Midwinter Nights Dram" IS one bottle.
     *   medium — every word covered but the product comes in multiple sizes
     *            (right bottle, size still the owner's call — the Switch
     *            size chip is right there) or the win is contested.
     *   review — partial coverage (unchanged default).
     */
    const eligibleCount = baseTerms.filter((t) => termEligible(String(t).toLowerCase())).length;
    if (bestCov.allCovered) {
      const sameNameSizes = new Set(
        all.filter((c) => c.name === ranked[0].name).map((c) => c.bottle_size_ml),
      ).size;
      const rival = ranked.find((c) => c.name !== ranked[0].name);
      const margin = rival ? scoreFor(rival) - scoreFor(ranked[0]) : Infinity;
      confidence =
        eligibleCount >= 2 && sameNameSizes <= 1 && margin >= VARIANT_PENALTY
          ? "high"
          : "medium";
    }
  }

  return {
    best: ranked[0] || null,
    alternates: ranked.slice(1),
    exactHit,
    total: all.length,
    terms: baseTerms,
    confidence,
    sizeMismatch,
    requestedSizeMl: line.sizeMl ?? null,
    leadMissing,
  };
}
