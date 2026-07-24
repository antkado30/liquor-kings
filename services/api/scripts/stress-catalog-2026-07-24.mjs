#!/usr/bin/env node
/**
 * stress-catalog-2026-07-24.mjs — the 14,000-bottle question, answered with
 * a NUMBER (Tony, 2026-07-24: "these are mainstream bottles… we have to make
 * sure this works for all 14,000+ bottles in MLCC").
 *
 * Method: sample N random SKUs from the REAL prod catalog, deterministically
 * generate store-owner phrasings of each (full name + size slang, brand-only,
 * a fat-finger typo, no size), run each through resolveOrderLine EXACTLY as
 * the assistant does, and score against ground truth (the source SKU):
 *
 *   EXACT   best.code === source code
 *   FAMILY  best is the same product name (any code/size) — counts for the
 *           no-size variant where any size of the right bottle is correct
 *   TOP-5   source appears in best+alternates
 *   HONEST  resolver said review/none or flagged sizeMismatch (an honest
 *           "not sure" is correct behavior on a lossy phrasing)
 *   HIGH-CONF WRONG   wrong bottle wearing a green "match" badge — the
 *                     CATASTROPHIC bucket; the whole design promises ~0
 *   MEDIUM WRONG      wrong bottle at "check" — flagged, survivable, counted
 *
 * Deterministic sampling (seeded RNG): re-running with the same N + seed
 * after a resolver fix measures the SAME bottles — a real before/after.
 * Combos / gift sets (is_combo, "W/") are excluded: owners don't phrase those.
 *
 * READ-ONLY catalog lookups. Runs on Tony's Mac against prod (LK_PROD_* in
 * services/api/.env). USAGE (from services/api/):
 *   node scripts/stress-catalog-2026-07-24.mjs            # N=200 seed=20260724
 *   node scripts/stress-catalog-2026-07-24.mjs 400        # bigger sample
 *   node scripts/stress-catalog-2026-07-24.mjs 200 7      # different seed
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  resolveOrderLine,
  sizeFromText,
  preferFromText,
} from "../src/lib/resolve-order-lines.js";

const SUPABASE_URL = process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing LK_PROD_SUPABASE_URL / LK_PROD_SUPABASE_SERVICE_ROLE_KEY in services/api/.env");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error("Points at localhost — re-run with prod creds (LK_PROD_SUPABASE_URL).");
  process.exit(1);
}

const N = Math.max(10, Math.min(2000, Number(process.argv[2]) || 200));
const SEED = Number(process.argv[3]) || 20260724;
console.log(
  `target: ${new URL(SUPABASE_URL).host} (read-only catalog stress) — N=${N} seed=${SEED}`,
);
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// Mulberry32 — tiny seeded PRNG so the sample is reproducible run-to-run.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Store-owner name cleaning: drop origin parens, combo tails, the PL token. */
function cleanName(raw) {
  let s = String(raw || "");
  s = s.replace(/\(.*?\)/g, " "); // (P R) (IRE) (HOL)
  const w = s.search(/\sW\//i); // combo/gift tails
  if (w > 0) s = s.slice(0, w);
  s = s.replace(/\bPL\b/gi, " "); // plastic marker — owners say "plastic" or nothing
  return s.replace(/\s+/g, " ").trim();
}

const SIZE_SLANG = {
  50: "50 ml",
  100: "double shot",
  200: "half pint",
  375: "pint",
  750: "fifth",
  1000: "liter",
  1750: "half gallon",
};
const slang = (ml) => (ml == null ? null : SIZE_SLANG[ml] ?? `${ml} ml`);

/** One realistic fat-finger: drop the 3rd char of the first long token. */
function typo(name) {
  const toks = name.split(" ");
  const i = toks.findIndex((t) => t.length >= 6);
  if (i < 0) return null;
  toks[i] = toks[i].slice(0, 2) + toks[i].slice(3);
  return toks.join(" ");
}

/** Build the phrasing variants for one SKU. */
function variants(sku) {
  const clean = cleanName(sku.name).toLowerCase();
  if (!clean) return [];
  const toks = clean.split(" ");
  const short = toks.slice(0, toks[0].length <= 3 ? 3 : 2).join(" ");
  const wasPlastic = /\bPL\b/i.test(sku.name);
  const sz = slang(sku.bottle_size_ml);
  const out = [];
  const push = (kind, name, withSize) =>
    name &&
    out.push({
      kind,
      name: wasPlastic && kind === "full" ? `${name} plastic` : name,
      size: withSize ? sz : null,
    });
  push("full", clean, true);
  if (short !== clean) push("short", short, true);
  push("typo", typo(clean), true);
  push("nosize", short, false);
  return out;
}

const norm = (s) => cleanName(s).toUpperCase();

async function fetchCatalog() {
  const rows = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, bottle_size_ml, is_combo")
      .order("code", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`catalog page ${page}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows.filter(
    (r) =>
      r.name &&
      r.name.trim().length >= 4 &&
      r.is_combo !== true &&
      !/\sW\//i.test(r.name),
  );
}

async function runOne(sku, v) {
  const sizeMl = v.size ? sizeFromText(v.size) : null;
  const text = v.size ? `${v.name} ${v.size}` : v.name;
  const r = await resolveOrderLine(supabase, {
    name: v.name,
    sizeMl,
    prefer: preferFromText(text),
    rawText: text,
  });
  const best = r.best ?? null;
  const top5 = [r.best, ...(r.alternates ?? [])]
    .filter(Boolean)
    .some((c) => c.code === sku.code);
  const exact = best?.code === sku.code;
  const family = !exact && best && norm(best.name) === norm(sku.name);
  const honest =
    r.confidence === "review" || r.confidence === "none" || r.sizeMismatch === true;
  // For nosize, the right bottle at ANY size is a win (family counts as right).
  const right = exact || (v.kind === "nosize" && family) || family;
  // BRAND-FAIR (round 2, 2026-07-24): same brand family, different variant —
  // "evan williams" → EW BLACK LABEL when the sampled truth was EW CHERRY.
  // The phrase never carried the variant word, so the plain/flagship pick is
  // Tony's law working, not a miss. Separated so the wrong-columns show ONLY
  // true cross-brand errors.
  const fam = (s) =>
    norm(s)
      .split(" ")
      .slice(0, 2)
      .join(" ");
  const brandFair = !right && best && fam(best.name) === fam(sku.name);
  let bucket;
  if (right) bucket = "right";
  else if (brandFair) bucket = "brand_fair";
  else if (honest) bucket = "honest_miss";
  else if (r.confidence === "high") bucket = "HIGH_CONF_WRONG";
  else bucket = "medium_wrong";
  return { bucket, top5, conf: r.confidence, best, exact };
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "-");

const main = async () => {
  const t0 = Date.now();
  const catalog = await fetchCatalog();
  console.log(`catalog: ${catalog.length} orderable SKUs (combos/gift sets excluded)`);
  const rnd = mulberry32(SEED);
  const sample = [...catalog].sort(() => rnd() - 0.5).slice(0, N);

  const stats = {}; // kind -> { n, right, honest, medWrong, highWrong, top5 }
  const offenders = [];
  const highOffenders = []; // uncapped — every HIGH-CONF-WRONG is evidence
  let done = 0;

  const queue = [];
  for (const sku of sample) for (const v of variants(sku)) queue.push({ sku, v });
  console.log(`running ${queue.length} resolves (${N} SKUs × ~4 phrasings)…`);

  const POOL = 6;
  let qi = 0;
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      while (qi < queue.length) {
        const { sku, v } = queue[qi++];
        let r;
        try {
          r = await runOne(sku, v);
        } catch (e) {
          r = { bucket: "error", top5: false, conf: "err", best: null };
          r.err = e?.message;
        }
        const s = (stats[v.kind] ??= {
          n: 0,
          right: 0,
          brandFair: 0,
          honest: 0,
          medWrong: 0,
          highWrong: 0,
          top5: 0,
          error: 0,
        });
        s.n += 1;
        if (r.top5) s.top5 += 1;
        if (r.bucket === "right") s.right += 1;
        else if (r.bucket === "brand_fair") s.brandFair += 1;
        else if (r.bucket === "honest_miss") s.honest += 1;
        else if (r.bucket === "medium_wrong") s.medWrong += 1;
        else if (r.bucket === "HIGH_CONF_WRONG") s.highWrong += 1;
        else s.error += 1;
        // HIGH offenders are the catastrophic class — capture EVERY one
        // (2026-07-24 first run had 2 that fell off a shared 40-cap list).
        const line = `[${r.bucket === "HIGH_CONF_WRONG" ? "HIGH!" : "med"}] said "${v.name}${v.size ? " " + v.size : ""}" (truth: ${sku.code} ${sku.name} ${sku.bottle_size_ml ?? "?"}ml) → got ${r.best ? `${r.best.code} ${r.best.name} ${r.best.bottle_size_ml ?? "?"}ml` : "(none)"} conf=${r.conf}${r.top5 ? " (truth WAS in top-5)" : ""}`;
        if (r.bucket === "HIGH_CONF_WRONG") highOffenders.push(line);
        else if (r.bucket === "medium_wrong" && offenders.length < 30) offenders.push(line);
        done += 1;
        if (done % 100 === 0) console.log(`  …${done}/${queue.length}`);
      }
    }),
  );

  console.log(`\n===== SCORECARD (N=${N} seed=${SEED}, ${((Date.now() - t0) / 1000).toFixed(0)}s) =====`);
  const kinds = ["full", "short", "typo", "nosize"];
  let T = { n: 0, right: 0, brandFair: 0, honest: 0, medWrong: 0, highWrong: 0, top5: 0, error: 0 };
  const row = (label, s) =>
    console.log(
      `${label.padEnd(7)} n=${String(s.n).padStart(4)}  right=${pct(s.right, s.n).padStart(6)}  brand-fair=${pct(s.brandFair, s.n).padStart(6)}  honest-miss=${pct(s.honest, s.n).padStart(6)}  med-wrong=${pct(s.medWrong, s.n).padStart(6)}  HIGH-WRONG=${pct(s.highWrong, s.n).padStart(6)}  truth-in-top5=${pct(s.top5, s.n).padStart(6)}${s.error ? `  errors=${s.error}` : ""}`,
    );
  for (const k of kinds) {
    const s = stats[k];
    if (!s) continue;
    for (const key of Object.keys(T)) T[key] += s[key];
    row(k, s);
  }
  row("TOTAL", T);
  console.log(
    `\nTHE metric: HIGH-WRONG must be ~0 (a wrong bottle wearing the green badge).` +
      `\nmed-wrong is flagged "check" in the UI — survivable, but drives alarm fatigue.` +
      `\nhonest-miss on short/typo/nosize phrasings is CORRECT behavior, not failure.`,
  );
  if (highOffenders.length) {
    console.log(`\n===== HIGH-CONF-WRONG (ALL ${highOffenders.length} — the catastrophic class) =====`);
    for (const o of highOffenders) console.log(o);
  }
  if (offenders.length) {
    console.log(`\n===== MEDIUM-WRONG SAMPLE (first ${offenders.length}) =====`);
    for (const o of offenders) console.log(o);
  }
  console.log(`\ndone — paste this whole output back.`);
};

main().catch((e) => {
  console.error(`stress run failed: ${e?.message ?? e}`);
  process.exit(1);
});
