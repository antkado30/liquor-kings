/**
 * mlcc-name-search-expansion — expand MLCC's terse wholesale catalog names
 * into the words the INTERNET uses, for image-search recall only.
 *
 * WHY (2026-07-14, the "no way there's no clean photo" push from Tony):
 * the photo backfill searched Google for the RAW catalog string and then
 * required raw tokens to appear in result text. "ARROW PPRMNT SCHNAPPS PL"
 * can't match pages titled "Arrow Peppermint Schnapps" — and worse, the
 * variant guard REJECTED those pages ("mentions peppermint" — a flavor the
 * raw token set doesn't contain). Whole classes of bottles were structurally
 * unfindable no matter how many photos exist. ~2,630 noMatch SKUs at the
 * time this shipped; a large share are this bug, not missing photos.
 *
 * SCOPE: image-search recall ONLY. The family engine (family-key.js) and
 * the order resolver keep their own normalization — grouping and ordering
 * identity must never silently change because we taught search new words.
 * The vision gate keeps the RAW name (its prompt decodes abbreviations
 * itself and is proven at scale).
 *
 * RULES (curated — every entry seen in the live catalog or the vision
 * prompt's own decoder; grow it when a new one is FOUND, never guessed):
 *   1. Token dictionary (PPRMNT→PEPPERMINT, BBN→BOURBON, …)
 *   2. "J DANIELS" bigram → "JACK DANIELS" (MLCC's own abbreviation)
 *   3. "W/" → "WITH"
 *   4. Drop parenthesized origin tags: (TN) (POL) (HOL) (P R) (FR) …
 *   5. Drop trailing container/pack noise: PL, PET, TRAV(ELER), GLS, nPK
 * Numbers (proof/age: "80", "7", "1942") are always preserved — the
 * numeric-token match rule depends on them.
 */

/** Single-token expansions. UPPERCASE key → replacement words. */
export const MLCC_SEARCH_TOKEN_EXPANSIONS = Object.freeze({
  PPRMNT: "PEPPERMINT",
  BBN: "BOURBON",
  LIQ: "LIQUEUR",
  FLVD: "FLAVORED",
  RTD: "READY TO DRINK",
  WHSKY: "WHISKEY",
  WHSK: "WHISKEY",
});

/** Trailing noise tokens that hurt search and never help identify a label. */
const CONTAINER_NOISE_RE = /^(?:PL|PET|PLASTIC|TRAV|TRAVELER|GLS|GLASS)$/i;
const PACK_NOISE_RE = /^\d{1,3}\s*-?\s*(?:PK|PACK)$/i;

/**
 * Expand an MLCC catalog name for image search + result-text matching.
 * Pure, deterministic, idempotent (expanding an expanded name is a no-op).
 * @param {string | null | undefined} rawName
 * @returns {string} expanded name ("" for empty input — caller falls back)
 */
export function expandMlccNameForImageSearch(rawName) {
  let s = String(rawName ?? "").trim();
  if (!s) return "";

  // Rule 3 first — "W/" is glued to the next word half the time.
  s = s.replace(/\bW\//gi, " WITH ");

  // Rule 4: parenthesized short origin/market tags — "(TN)", "(P R)".
  s = s.replace(/\(\s*[A-Z][A-Z .]{0,5}\)/g, " ");

  // Tokenize for rules 1, 2, 5.
  let tokens = s.split(/\s+/).filter(Boolean);

  // Rule 2: leading-brand bigram "J DANIELS" → "JACK DANIELS".
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (/^J$/i.test(tokens[i]) && /^DANIELS?$/i.test(tokens[i + 1])) {
      tokens[i] = "JACK";
    }
  }

  // Rule 1: dictionary.
  tokens = tokens.flatMap((t) => {
    const hit = MLCC_SEARCH_TOKEN_EXPANSIONS[t.toUpperCase()];
    return hit ? hit.split(" ") : [t];
  });

  // Rule 5: strip container/pack noise wherever it appears (MLCC puts
  // "PL" both mid-name and trailing: "SMIRNOFF 80 PL", "… PL PT").
  tokens = tokens.filter((t) => !CONTAINER_NOISE_RE.test(t) && !PACK_NOISE_RE.test(t));

  return tokens.join(" ").replace(/\s+/g, " ").trim();
}
