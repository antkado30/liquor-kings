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
 * DELIBERATELY UNWIRED as of 2026-07-01: nothing imports this in production
 * yet. It ships to the live /items/:code/family path only after
 * scripts/audit-family-grouping.mjs grades it against the full prod catalog
 * (split-rate ≈ 0, zero eyeballed false merges). Never edit the live
 * mlcc-product-family.js in the same change that lands this — swap is its
 * own reviewed step.
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

  const familyKey = s.replace(/\s+/g, " ").trim().toUpperCase();
  return {
    familyKey,
    container: container ?? "glass",
    packCount,
    isCombo,
    strippedTokens,
  };
}

/**
 * Convenience: just the key (for grouping maps).
 * @param {string | null | undefined} rawName
 */
export function familyKeyOf(rawName) {
  return computeFamilyIdentity(rawName).familyKey;
}
