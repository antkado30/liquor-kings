/**
 * BRAND FLAGSHIPS — derived for EVERY bottle (2026-08-12, Tony's law:
 * "that shouldnt only work for captain morgan it has to work for EVERY
 * bottle every single bottle").
 *
 * The hand-written FLAGSHIP_ALIASES map covered five brands; the catalog
 * has thousands. This module derives a flagship per BRAND from the
 * catalog itself, using the signal Tony's own SQL dump exposed: THE
 * FLAGSHIP HAS THE DEEPEST SIZE LADDER. Captain Morgan's spiced rum
 * comes in 50/200/375/750/1000/1750; Chili Lime comes in five, Sliced
 * Apple in one. Flagships are what stores actually stock wall-to-wall —
 * MLCC's size spread IS the market's answer.
 *
 * Pipeline (scripts/build-brand-flagships.mjs runs it):
 *   catalog rows → clusterBrands() → chooseFlagship() per cluster →
 *   confident rows upsert into public.brand_flagships; ambiguous ones
 *   go to a review CSV for Tony. The resolver loads the table with a
 *   5-minute in-process cache (loadFlagshipMap) and merges it UNDER the
 *   in-code FLAGSHIP_ALIASES (curated always outranks derived).
 *
 * Everything except loadFlagshipMap is pure — the Morgan cluster from
 * Tony's prod SQL is the test corpus.
 */

import { FLAVOR_WORDS, flavorPresentIn } from "./resolve-order-lines.js";

/** Size/packaging noise stripped to find the PRODUCT LINE a row belongs to. */
function lineKeyOf(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/\s*W\/.*$/, "") // combo tails: "SPC PL W/50ML ..." — everything after W/
    .replace(/\(P\s*R\)|\(PR\)/g, "") // Puerto Rico origin parens
    .replace(/\bPL\b/g, "") // plastic marker
    .replace(/\b\d+\s*(ML|L)\b/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First word of a name, lowercased ("CAPT MORGAN…" → "capt"). */
function leadToken(name) {
  const m = String(name || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  return m && m.length > 0 ? m[0] : "";
}

function secondToken(name) {
  const m = String(name || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  return m && m.length > 1 ? m[1] : "";
}

/** a is an MLCC truncation of b (or equal): CAPT↔CAPTAIN, MORG↔MORGAN. */
function tokenBridges(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

/**
 * Cluster catalog rows into BRANDS. Primary key: lead token. Clusters
 * whose leads bridge by truncation (capt/captain) merge ONLY when their
 * second tokens also bridge (morgan/morg) — that's what keeps JACKSON
 * MORGAN out of the JACK DANIELS cluster ("jack" prefixes "jackson",
 * but daniels ≠ morgan).
 */
export function clusterBrands(rows) {
  const byLead = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.name) continue;
    const lead = leadToken(row.name);
    if (!lead) continue;
    if (!byLead.has(lead)) byLead.set(lead, []);
    byLead.get(lead).push(row);
  }

  const leads = [...byLead.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const merged = new Map(); // canonical lead -> rows
  const canonicalOf = new Map();
  for (const lead of leads) {
    let target = null;
    for (const existing of merged.keys()) {
      if (!tokenBridges(lead, existing)) continue;
      // Second-token confirmation across ANY row pair of the two clusters.
      const a = byLead.get(lead);
      const b = merged.get(existing);
      const secondsA = new Set(a.map((r) => secondToken(r.name)).filter(Boolean));
      const secondsB = new Set(b.map((r) => secondToken(r.name)).filter(Boolean));
      const bridged = [...secondsA].some((sa) => [...secondsB].some((sb) => tokenBridges(sa, sb)));
      if (bridged) {
        target = existing;
        break;
      }
    }
    if (target) {
      merged.get(target).push(...byLead.get(lead));
      canonicalOf.set(lead, target);
    } else {
      merged.set(lead, [...byLead.get(lead)]);
      canonicalOf.set(lead, lead);
    }
  }
  return merged;
}

const PROOF_RE = /\b(100|101|151|190)\b/;
const AGE_RE = /\b\d+\s*(YR|YEAR)S?\b/i;

/** Maximal-hit flavor count for a line name (mirrors scoreCandidate's dedupe). */
function flavorCount(lname) {
  const hits = FLAVOR_WORDS.filter((f) => flavorPresentIn(lname, f));
  return hits.filter((f) => !hits.some((g) => g !== f && g.includes(f))).length;
}

/**
 * Pick the flagship LINE within one brand cluster.
 * Returns null when the cluster has no scorable line. `confident` is
 * false when the top two lines are within MARGIN — those go to review,
 * never straight into the table.
 */
export function chooseFlagship(clusterRows, { margin = 5 } = {}) {
  const lines = new Map(); // lineKey -> { rows, sizes }
  for (const row of clusterRows || []) {
    const key = lineKeyOf(row.name);
    if (!key) continue;
    if (!lines.has(key)) lines.set(key, { rows: [], sizes: new Set() });
    const entry = lines.get(key);
    entry.rows.push(row);
    if (row.bottle_size_ml != null) entry.sizes.add(row.bottle_size_ml);
  }
  if (lines.size === 0) return null;

  const scored = [...lines.entries()].map(([key, { rows, sizes }]) => {
    const lname = key.toLowerCase();
    let score = sizes.size * 10; // THE signal: size-ladder depth
    const reasons = [`sizes:${sizes.size}`];
    const allCombo = rows.every((r) => r.is_combo === true);
    if (allCombo) {
      score -= 1000; // gift packs are never the flagship
      reasons.push("combo");
    }
    const fl = flavorCount(lname);
    if (fl > 0) {
      score -= fl * 8;
      reasons.push(`flavors:${fl}`);
    }
    if (PROOF_RE.test(lname)) {
      score -= 6; // proof-line step-up (SMIRNOFF 100 class)
      reasons.push("proof-line");
    }
    if (AGE_RE.test(key)) {
      score -= 10;
      reasons.push("aged");
    }
    if (/\bVARIETY\b/i.test(key)) {
      score -= 20;
      reasons.push("variety");
    }
    return { key, rows, sizes, score, reasons };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score || b.rows.length - a.rows.length || a.key.length - b.key.length,
  );
  const top = scored[0];
  const second = scored[1] ?? null;
  const confident = second == null || top.score - second.score >= margin;

  // Alias terms come from the flagship's OWN catalog spelling — that's
  // what anchors abbreviated names (capt) and waives the flagship's own
  // flavor words (spiced) exactly like the hand-written entries did.
  const aliasTerms = top.key
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5);

  // A representative code: prefer a 750 non-combo row, else any row.
  const rep =
    top.rows.find((r) => r.bottle_size_ml === 750 && r.is_combo !== true) ?? top.rows[0];

  return {
    lineKey: top.key,
    aliasTerms,
    flagshipCode: rep?.code != null ? String(rep.code) : null,
    confident,
    score: top.score,
    runnerUp: second ? { lineKey: second.key, score: second.score } : null,
    reasons: top.reasons,
  };
}

/**
 * Brand KEYS people type, derived from every spelling the cluster
 * contains: each lead token alone + each lead+second pair, all
 * de-pluralized on lookup by the resolver ("captain morgans" finds
 * "captain morgan"). Generic second tokens (vodka/rum/…) excluded —
 * "tito vodka" is a bare brand via the "tito" key.
 */
export function brandKeysOf(clusterRows, genericWords) {
  const keys = new Set();
  for (const row of clusterRows || []) {
    const lead = leadToken(row?.name);
    if (!lead || lead.length < 3) continue;
    keys.add(lead);
    const sec = secondToken(row?.name);
    if (sec && sec.length > 1 && !genericWords.has(sec)) {
      keys.add(`${lead} ${sec}`);
    }
  }
  return [...keys];
}

/*
 * ── Resolver-side loading ────────────────────────────────────────────
 * public.brand_flagships (migration sql/2026-08-12-brand-flagships.sql):
 *   brand_key text pk · alias_terms text[] · flagship_code text ·
 *   flagship_name text · source text · confident boolean
 * 5-minute in-process cache; ANY error → empty map (resolving must
 * never break because the knowledge table hiccuped).
 */
let flagshipCache = { at: 0, map: null };
let flagshipInflight = null;
const FLAGSHIP_TTL_MS = 5 * 60_000;

export function __resetFlagshipCache() {
  flagshipCache = { at: 0, map: null };
  flagshipInflight = null;
}

export async function loadFlagshipMap(supabase) {
  if (flagshipCache.map && Date.now() - flagshipCache.at < FLAGSHIP_TTL_MS) {
    return flagshipCache.map;
  }
  // A 150-line paste resolves in 20-concurrent waves — every line of the
  // first wave would fire the same cache-miss query. One in-flight fetch
  // serves them all.
  if (flagshipInflight) return flagshipInflight;
  flagshipInflight = fetchFlagshipMap(supabase).finally(() => {
    flagshipInflight = null;
  });
  return flagshipInflight;
}

async function fetchFlagshipMap(supabase) {
  const map = new Map();
  try {
    const { data, error } = await supabase
      .from("brand_flagships")
      .select("brand_key, alias_terms, confident")
      .limit(5000);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (
          typeof row?.brand_key === "string" &&
          row.brand_key.trim() !== "" &&
          Array.isArray(row?.alias_terms) &&
          row.alias_terms.length > 0 &&
          row.confident !== false
        ) {
          map.set(
            row.brand_key.trim().toLowerCase(),
            row.alias_terms.map((t) => String(t).toLowerCase()),
          );
        }
      }
    }
  } catch {
    /* fail-soft: empty map */
  }
  flagshipCache = { at: Date.now(), map };
  return map;
}
