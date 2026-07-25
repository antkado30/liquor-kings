/**
 * family-key.js — the NEXT-GENERATION family identity for MLCC catalog rows.
 *
 * Plan: docs/lk/catalog-family-tree-plan.md (2026-07-01). This module is the
 * pure core: given an MLCC item name, compute
 *
 *   { familyKey, container, packCount, strippedTokens }
 *
 * such that every size/container/pack variant of one product line lands on
 * the SAME familyKey, while flavors, proofs, ages, and editions stay apart.
 *
 * THE RULE (Tony, 2026-07-01): "group for discovery, distinguish for
 * ordering." The key GROUPS glass+plastic+minis+packs into one tree; the
 * extracted `container` / `packCount` become DATA the UI must display on
 * each size chip so nobody ever orders glass and receives plastic.
 *
 * WIRED as of 2026-07-24 (stale note fixed 2026-07-25 per no-drift #27):
 * the family_key COLUMN this module computes (via backfill + the price-book
 * ingestor) is read by the browse-families RPCs and the assistant's
 * size-flip sibling fetch. Changing this function therefore requires:
 * tests green → deploy → re-run scripts/backfill-family-key.mjs --apply
 * (Tony) → --verify → scripts/audit-family-siblings re-run (stale 0,
 * splits 0). The live mlcc-product-family.js module remains separate —
 * never edit it in the same change.
 *
 * Design notes:
 * - MLCC names are UPPERCASE-ish, space-separated, with trailing qualifier
 *   junk: size words (PT, FTH, LTR, QTR, 200ML, 1.75L…), container marks
 *   (PL = plastic — Tony's plastic-pint-of-Jack bug — plus PET/GLS/TRAV…),
 *   and pack marks (12PK / 12 PK).
 * - Stripping is ITERATIVE from the tail until stable, so "… PL PT",
 *   "… PT PL", "… 200ML PL" all fully reduce. (The live module's
 *   single-pass strip is root cause #2 of the split families.)
 * - Combo segments ("…W/50ML REPO W/", "…/2 MASON JARS") are cut first,
 *   reusing the proven detectors from mlcc-product-family.js (import-only;
 *   that file is not modified).
 * - We strip ONLY from the tail, token-by-token, so mid-name words that
 *   happen to collide (a brand containing "Pl…" etc.) are never touched.
 */
import { isMlccComboName } from "./mlcc-product-family.js";

/** Trailing tokens that mean "a size", not "a different product". */
const SIZE_WORD_TOKENS = new Set([
  "PT", // pint
  "HPT", // half pint (seen in MLCC exports)
  "FTH", // fifth
  "LTR", // liter
  "QTR", // quart
  "GAL", // gallon
  "HGAL", // half gallon
  "MINI",
  "MINIS",
]);

/** Multi-word trailing size phrases (checked before single tokens). */
const SIZE_PHRASES = [/\bHALF\s+GAL(?:LON)?$/i, /\bHALF\s+PINT$/i];

/** Trailing metric sizes: "200ML", "200 ML", "1.75L", "1 L", "1750" alone is NOT stripped (could be a brand number). */
const METRIC_SIZE_RE = /^\d+(?:\.\d+)?\s*(?:ML|L)$/i;

/**
 * Container tokens → canonical container value.
 * PL is MLCC's plastic marker ("SMIRNOFF 80 PL"). TRAV = traveler (flat
 * plastic bottle). Default when nothing is marked: "glass" — MLCC only
 * annotates the exception. VALIDATE this default in the audit before
 * trusting it in UI copy.
 */
const CONTAINER_TOKENS = new Map([
  ["PL", "plastic"],
  ["PET", "plastic"],
  ["PLST", "plastic"],
  ["PLASTIC", "plastic"],
  ["TRAV", "plastic"],
  ["TRAVELER", "plastic"],
  ["TRAVELLER", "plastic"],
  ["GLS", "glass"],
  ["GLASS", "glass"],
]);

/** Trailing pack markers: "12PK", "12 PK", "12-PK", "12PACK", "12 PACK". */
const PACK_RE = /^(\d{1,3})\s*[- ]?\s*(?:PK|PACK)$/i;
const PACK_WORD_RE = /^(?:PK|PACK)$/i;

/**
 * Cut combo segments the same way the live module does ("… W/<extra>" and
 * "/<digit>…" forms). Kept here (not imported) because the live module
 * bundles the cut inside its own normalize; we need it standalone.
 * @param {string} s
 */
function cutComboSegments(s) {
  let out = s.replace(/\sW\/.*$/i, "");
  out = out.replace(/\/\s*\d.*$/, "");
  return out;
}

/**
 * @typedef {Object} FamilyIdentity
 * @property {string} familyKey   normalized base, UPPERCASE, single-spaced ("" when name empty)
 * @property {"glass" | "plastic"} container   canonical container (default "glass")
 * @property {number | null} packCount   e.g. 12 for "12PK" SKUs, else null
 * @property {boolean} isCombo   name carried a gift-combo segment
 * @property {string[]} strippedTokens   every tail token removed, in strip order (audit fodder)
 */

/**
 * Compute the family identity for one MLCC item name.
 * Pure, deterministic, no I/O.
 * @param {string | null | undefined} rawName
 * @returns {FamilyIdentity}
 */
export function computeFamilyIdentity(rawName) {
  const original = String(rawName ?? "").trim();
  const strippedTokens = [];
  let container = null;
  let packCount = null;

  const isCombo = isMlccComboName(original);
  let s = cutComboSegments(original);
  s = s.replace(/\s+/g, " ").trim();

  // Iteratively strip trailing qualifier tokens until the tail is a real word.
  // Bounded by token count so a pathological name can't loop forever.
  let guard = 24;
  while (guard-- > 0) {
    const before = s;

    // Multi-word size phrases first ("HALF GAL").
    let phraseHit = false;
    for (const re of SIZE_PHRASES) {
      const m = s.match(re);
      if (m) {
        strippedTokens.push(m[0].toUpperCase().replace(/\s+/g, " "));
        s = s.slice(0, s.length - m[0].length).trim();
        phraseHit = true;
        break;
      }
    }
    if (phraseHit) continue;

    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) break; // never strip a name down to nothing
    const tail = tokens[tokens.length - 1];
    const tailUp = tail.toUpperCase();

    // "12PK" / "PK" (with the count in the previous token, e.g. "12 PK")
    const packM = tailUp.match(PACK_RE);
    if (packM) {
      packCount = Number(packM[1]);
      strippedTokens.push(tailUp);
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }
    if (PACK_WORD_RE.test(tailUp) && tokens.length >= 2 && /^\d{1,3}$/.test(tokens[tokens.length - 2])) {
      packCount = Number(tokens[tokens.length - 2]);
      strippedTokens.push(`${tokens[tokens.length - 2]} ${tailUp}`);
      tokens.pop();
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }

    // Container marks (PL / PET / GLS / TRAV …)
    if (CONTAINER_TOKENS.has(tailUp)) {
      container = container ?? CONTAINER_TOKENS.get(tailUp);
      strippedTokens.push(tailUp);
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }

    // Size words (PT / FTH / LTR …)
    if (SIZE_WORD_TOKENS.has(tailUp)) {
      strippedTokens.push(tailUp);
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }

    // Metric sizes: "200ML" as one token, or "200 ML" as two.
    if (METRIC_SIZE_RE.test(tailUp)) {
      strippedTokens.push(tailUp);
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }
    if (
      /^(?:ML|L)$/i.test(tailUp) &&
      tokens.length >= 2 &&
      /^\d+(?:\.\d+)?$/.test(tokens[tokens.length - 2])
    ) {
      strippedTokens.push(`${tokens[tokens.length - 2]} ${tailUp}`);
      tokens.pop();
      tokens.pop();
      s = tokens.join(" ");
      continue;
    }

    if (s === before) break; // stable — nothing more to strip
  }

  const familyKey = canonicalizeFamilyKey(s);
  return {
    familyKey,
    container: container ?? "glass",
    packCount,
    isCombo,
    strippedTokens,
  };
}

/**
 * canonicalizeFamilyKey — kill MLCC's OWN punctuation inconsistency
 * (2026-07-25 sibling audit: 13 split families, every one a punctuation
 * variant MLCC typed two ways across sizes):
 *   apostrophes    DRAGON'S ≡ DRAGONS, D'USSE ≡ DUSSE, S'MOREGASM ≡ SMOREGASM
 *   periods        "NO. 8" ≡ "NO 8"   (decimals like 1.75 are protected)
 *   hyphens        OLD-FASHIONED ≡ OLD FASHIONED, "-4YR" ≡ "-4 YR"
 *   letter pairs   "X O" ≡ "XO", "V S" ≡ "VS" (fused only when BOTH tokens
 *                  are single letters — "MR B" is untouched)
 *   age tokens     "4 YR" ≡ "4YR"
 *   parens         "LABEL(P R)" ≡ "LABEL (P R)" ≡ "LABEL (PR)"
 * Applied to the FINAL key only — the tail-strip loop above still sees the
 * raw name, so size/container/pack detection is unchanged.
 * @param {string | null | undefined} raw
 */
export function canonicalizeFamilyKey(raw) {
  let s = String(raw ?? "");
  // Protect decimal points, drop every other period, restore decimals.
  s = s.replace(/(\d)\.(\d)/g, "$1__DOT__$2").replace(/\./g, " ").replace(/__DOT__/g, ".");
  // Apostrophes vanish WITHOUT leaving a space (DRAGON'S → DRAGONS).
  s = s.replace(/['’]/g, "");
  // Hyphens are spaces.
  s = s.replace(/-/g, " ");
  // Parens get breathing room so their contents tokenize ("LABEL(P R)").
  s = s.replace(/\(/g, " ( ").replace(/\)/g, " ) ");
  s = s.replace(/\s+/g, " ").trim().toUpperCase();
  // Fuse runs of single-letter tokens: "X O"→"XO", "P R"→"PR", "V S O P"→"VSOP".
  let prev;
  do {
    prev = s;
    s = s.replace(/\b([A-Z]) ([A-Z])\b/g, "$1$2");
  } while (s !== prev);
  // Age tokens fuse: "4 YR" → "4YR" (hyphen case arrives here as "4 YR" too).
  s = s.replace(/\b(\d+) (YRS?)\b/g, "$1$2");
  // Snug the parens back: "( PR )" → "(PR)".
  s = s.replace(/\( /g, "(").replace(/ \)/g, ")");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Convenience: just the key (for grouping maps).
 * @param {string | null | undefined} rawName
 */
export function familyKeyOf(rawName) {
  return computeFamilyIdentity(rawName).familyKey;
}
