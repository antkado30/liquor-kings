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
  // 2026-07-23 corpus additions — seasonal/line extensions that escaped the
  // penalty and beat flagships on the length tiebreak (Skrewball EGGNOG over
  // Peanut Butter, Carolans COLD BREW over Irish Cream). NOTE: "peanut" is
  // deliberately NOT here — Skrewball's FLAGSHIP is Peanut Butter Whiskey, so
  // penalizing "peanut" would demote the real bottle. Carolans Peanut Butter
  // is instead demoted by the flagship alias's irish+cream missing-term
  // penalty, not by a flavor penalty.
  "eggnog", "nog", "pumpkin", "smores", "horchata",
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
};

/** Bare-brand → flagship terms; anything more specific passes through. */
export function applyFlagshipAlias(terms) {
  const distinctive = (terms || []).filter((t) => !GENERIC_WORDS.has(t));
  if (distinctive.length === 1 && FLAGSHIP_ALIASES[distinctive[0]]) {
    return FLAGSHIP_ALIASES[distinctive[0]];
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

function termPresentIn(lname, strippedName, t, idx) {
  if (/^\d+$/.test(t)) return new RegExp(`\\b${t}\\b`).test(lname);
  const st = t.replace(/[^a-z0-9]/g, "");
  let present = lname.includes(t) || (st.length >= 3 && strippedName.includes(st));
  if (!present && t.length >= 6) {
    present = lname.includes(t.slice(0, 5)) || strippedName.includes(st.slice(0, 5));
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

  let flavorPenalty = 0;
  for (const f of FLAVOR_WORDS) {
    if (lname.includes(f) && !lterms.some((t) => f.includes(t) || t.includes(f))) {
      flavorPenalty += 1;
    }
  }
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

export async function resolveOrderLine(supabase, line) {
  // Explicit operator-authored terms pass through untouched; tokenized
  // free text gets brand-synonym expansion (stoli→stolichnaya) THEN the
  // bare-brand → flagship expansion (Tony's law). Synonyms run first so a
  // synonym'd bare brand can still hit a flagship alias if one exists.
  const baseTerms =
    Array.isArray(line.terms) && line.terms.length
      ? applyBrandSynonyms(line.terms.map((t) => String(t).toLowerCase()).slice(0, 6))
      : applyFlagshipAlias(applyBrandSynonyms(tokenizeName(line.name)));
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
  const sizeMismatch = Boolean(line.sizeMl) && all.length > 0 && exact.length === 0;
  const pool = line.sizeMl && exact.length > 0 ? exact : all;
  // rawText: the line as the human wrote it (proof-number waivers read it —
  // "Smirnoff 100" typed deliberately must not demote SMIRNOFF 100).
  const rawText = String(line.rawText ?? line.name ?? "").toLowerCase();
  pool.sort(
    (a, b) =>
      scoreCandidate(a.name, baseTerms, line.prefer, { row: a, rawText }) -
        scoreCandidate(b.name, baseTerms, line.prefer, { row: b, rawText }) ||
      a.name.localeCompare(b.name),
  );

  const ranked = pool.slice(0, 6);
  const exactHit = line.sizeMl ? exact.length > 0 : null;
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
      const margin = rival
        ? scoreCandidate(rival.name, baseTerms, line.prefer, { row: rival, rawText }) -
          scoreCandidate(ranked[0].name, baseTerms, line.prefer, { row: ranked[0], rawText })
        : Infinity;
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
      const margin = rival
        ? scoreCandidate(rival.name, baseTerms, line.prefer, { row: rival, rawText }) -
          scoreCandidate(ranked[0].name, baseTerms, line.prefer, { row: ranked[0], rawText })
        : Infinity;
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
