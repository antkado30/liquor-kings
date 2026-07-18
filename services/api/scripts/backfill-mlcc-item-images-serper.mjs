#!/usr/bin/env node
/**
 * Backfill mlcc_items.image_url with REAL bottle photos via Serper.dev
 * (Google Images results as an API) — task: catalog photos, 2026-06-10.
 *
 * WHY THIS EXISTS (the path history matters — don't repeat dead ends):
 *   1. UPCitemdb — DEAD (rate-limited at 7 calls, sparse liquor coverage).
 *   2. Google Custom Search JSON API — DEAD (correctly-configured project
 *      stuck returning 403 forever + "search the entire web" is deprecated).
 *   3. AI generation (gpt-image-1) — DEAD for accuracy. The 2026-06-10
 *      FRIS spot-check produced a generic flask that looks NOTHING like
 *      the real frosted FRIS bottle. AI invents trade dress it doesn't
 *      know. Tony's bar: "every single bottle has to be spot-on accurate."
 *      Only REAL photos meet that bar.
 *   4. THIS — Serper.dev queries real Google Images and returns JSON.
 *      2,500 free searches on signup, then roughly $1/1k. Full 13.8k
 *      catalog ≈ $4-14. Real photos, pin-point verified before writing.
 *
 * QUALITY / SAFETY (integrity doctrine — "no Tito's photo on a Hennessy code"):
 *   1. Pin-point verify every hit: result title/source text must contain a
 *      high fraction of the MLCC name's tokens AND sizes must match within
 *      tolerance when both are parseable. Mismatch → skip, no write.
 *   2. RE-HOST verified images into our Supabase Storage bucket (hotlinks
 *      expire/403 → broken images). Serves from our CDN.
 *   3. Most-scanned bottles first.
 *   4. Only fills image_url IS NULL — never overwrites curated images.
 *   5. image_source = "serper_google_images" for wholesale auditability.
 *
 * MODES:
 *   --dry-run            Calls Serper (those queries DO count against the
 *                        free 2,500) but does not download/upload/write.
 *   --limit=N            Cap SKUs this run (default 25).
 *   --code=XXX           Single MLCC code (quality spot-check).
 *   --concurrency=N      Parallel workers (default 3, max 6).
 *   --min-side=N         Reject images smaller than N px on either side
 *                        (default 300 — thumbnails look terrible in Browse).
 *   --force              With --code only: re-check a SKU that already has
 *                        an image (iterating on quality for one bottle).
 *   --skip-vision        Skip the Claude vision pixel-check (NOT recommended).
 *   --regate             Re-judge ALREADY-WRITTEN serper photos with the
 *                        current gate; clear failures to the placeholder
 *                        (they become refill candidates). No Serper calls.
 *                        Combine with --dry-run=true to preview verdicts.
 *   --allow-busy-fallback=true  Accept correct-but-busy-background photos when
 *                        no clean studio shot survives. OFF by default since
 *                        2026-07-11 (photo-truth mandate): clean shot or
 *                        premium placeholder, nothing in between.
 *
 * THE VISION GATE (added 2026-06-10 after the FRIS 80-vs-100-proof miss):
 *   Text matching can't see the photo. Claude (Haiku) inspects every
 *   downloaded candidate and FAILS wrong brand / wrong flavor-variant /
 *   conflicting proof-age statements / multi-packs / non-product images.
 *   Walks up to 3 ranked candidates per SKU before giving up to the
 *   placeholder. Adds ~$0.002-0.01 per image (~$30-130 full catalog) —
 *   the price of "every single one correct".
 *
 * ENV (services/api/.env):
 *   LK_PROD_SUPABASE_URL, LK_PROD_SUPABASE_SERVICE_ROLE_KEY  (prod target)
 *   SERPER_API_KEY                                            (serper.dev)
 *
 * USAGE (from services/api/):
 *   node scripts/backfill-mlcc-item-images-serper.mjs --code=100009
 *   node scripts/backfill-mlcc-item-images-serper.mjs --limit=25
 *   caffeinate -i node scripts/backfill-mlcc-item-images-serper.mjs \
 *     --limit=14000 --concurrency=4
 *
 * Idempotent: only touches rows where image_url IS NULL. Re-run safely.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { extractBottleSizeMl } from "../src/lib/upcitemdb.js";
import { expandMlccNameForImageSearch } from "../src/mlcc/mlcc-name-search-expansion.js";

// ── Verification tunables ──────────────────────────────────────────────────
const NAME_SIMILARITY_THRESHOLD = 0.6;
const SIZE_TOLERANCE_ML = 50;
const STORAGE_BUCKET = "bottle-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RESULTS_PER_QUERY = 10;

// Known liquor-retail domains get a ranking boost — their product shots
// are professional, on-white, and reliably the right bottle.
const TRUSTED_DOMAIN_RE =
  /totalwine|wine\.com|drizly|reservebar|caskers|seelbachs|binnys|specsonline|abc\.virginia|ohlq|finewineandgoodspirits|liquorandwineoutlets|bevmo|klwines|astorwines|missionliquor|woodencork|sipwhiskey|caskcartel|nationwideliquor|arlingtonwine|shopliquor/i;

const STOPWORDS = new Set([
  "ml", "l", "ltr", "liter", "litre", "oz", "floz", "fl",
  "the", "of", "and", "with", "a", "an", "&",
  "pack", "bottle", "bottles", "btl", "case",
]);

/*
  Known sub-brand / product-line collisions: lines that share a parent
  brand with a flagship product, so brand-token matching alone can't tell
  them apart (Rule 3 below). Lowercase phrases, matched against the result
  title/snippet. Add to this list whenever a new one is caught.
*/
const SUBBRAND_CONFLICT_PHRASES = [
  "parrot bay",
  "country cocktails",
  "downhome punch",
  "down home punch",
  "smirnoff ice",
  "malibu splash",
  "bacardi breezer",
  "jose cuervo playamar",
  "crown royal washington apple", // pre-mixed RTD line vs the whisky
  // Crown Royal ↔ Royal Canadian collision (Tony, 2026-07-17 on device):
  // "ROYAL CANADIAN" (budget Canadian whisky) kept getting CROWN ROYAL
  // photos. Crown Royal IS Canadian whisky, so its listings read
  // "Crown Royal ... Canadian Whisky" — both target tokens (royal +
  // canadian) match, no numeric/variant tripped, and the vision gate got
  // fooled by "Royal/Canadian" text on the crown-shaped bottle. The
  // directional exemption below saves real Crown Royal SKUs: a target
  // that itself contains "crown royal" is exempt; "ROYAL CANADIAN" is not.
  "crown royal",
  "hard seltzer",
  "ranch water",
];

/*
 * Collision negatives (Tony, 2026-07-17). A budget brand whose name is a
 * SUBSET of a dominant premium brand gets swamped in image search by the
 * premium one — "ROYAL CANADIAN" returns Crown Royal everywhere. The text +
 * vision gates then correctly REJECT the impostor, but with no real photo
 * surviving the SKU falls to a placeholder. Excluding the impostor at the
 * SEARCH level (Google honors `-"phrase"` via Serper) surfaces the real
 * brand instead. Directional by construction: `unless` exempts the premium
 * brand's own SKUs so their searches are untouched. Add a row per known
 * collision; the same guard class as SUBBRAND_CONFLICT_PHRASES, one layer
 * earlier (search recall vs. candidate rejection).
 */
const COLLISION_NEGATIVES = [
  { when: /\broyal canadian\b/i, unless: /\bcrown royal\b/i, negatives: ['-"crown royal"'] },
];

function collisionNegativesFor(expandedName) {
  const name = String(expandedName ?? "");
  const out = [];
  for (const rule of COLLISION_NEGATIVES) {
    if (rule.when.test(name) && !rule.unless.test(name)) out.push(...rule.negatives);
  }
  return out;
}

function normalizeTokens(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function nameContainment(mlccName, candidateText) {
  const mlccTokens = normalizeTokens(mlccName);
  if (mlccTokens.length === 0) return 0;
  const set = new Set(normalizeTokens(candidateText));
  let hits = 0;
  for (const t of mlccTokens) if (set.has(t)) hits += 1;
  return hits / mlccTokens.length;
}

/*
 * Variant guard (Tony, 2026-06-10 after the FRIS 80-vs-100-proof miss):
 * "imagine we're trying to get a picture for a fifth of Smirnoff and a
 * picture of Smirnoff Raspberry pops up — no. Every single one correctly."
 * Two text-level rules, then the vision gate does the final visual check:
 *   1. Numeric tokens in the MLCC name (proof, age statements: "100",
 *      "12") MUST appear in the candidate text.
 *   2. If the candidate text contains a flavor/variant word the MLCC name
 *      does NOT have (raspberry, peach, spiced…), reject.
 */
const VARIANT_TOKENS = new Set([
  "raspberry", "strawberry", "blueberry", "blackberry", "cherry", "peach",
  "apple", "mango", "watermelon", "pineapple", "coconut", "banana",
  "citrus", "lime", "lemon", "orange", "grapefruit", "grape", "pomegranate",
  "passionfruit", "tropical", "punch", "vanilla", "caramel", "honey",
  "cinnamon", "coffee", "espresso", "mocha", "chocolate", "peppermint",
  "spiced", "salted", "pepper", "habanero", "jalapeno", "sweet", "sour",
  "cream", "whipped", "flavored", "infused",
]);

function verifyMatch({ mlccItem, candidateText }) {
  const sim = nameContainment(mlccItem.name, candidateText);
  if (sim < NAME_SIMILARITY_THRESHOLD) {
    return {
      ok: false,
      reason: `name mismatch (${sim.toFixed(2)}) "${String(candidateText).slice(0, 50)}"`,
    };
  }
  const nameTokens = new Set(normalizeTokens(mlccItem.name));
  const candTokens = normalizeTokens(candidateText);
  // Rule 1: every numeric token in the MLCC name must appear in the result.
  for (const t of nameTokens) {
    if (/^\d+$/.test(t) && !candTokens.includes(t)) {
      return { ok: false, reason: `missing numeric token "${t}" (proof/age)` };
    }
  }
  // Rule 2: result mentions a flavor/variant the MLCC name doesn't have.
  for (const t of candTokens) {
    if (VARIANT_TOKENS.has(t) && !nameTokens.has(t)) {
      return { ok: false, reason: `wrong variant (mentions "${t}")` };
    }
  }
  /*
    Rule 3 — sub-brand / product-line conflicts (the Parrot Bay lesson,
    2026-06-12: "CAPTAIN MORGAN COCONUT RUM" got a PARROT BAY photo —
    Parrot Bay is a Captain Morgan PRODUCT LINE, so brand tokens matched
    and no flavor variant tripped Rule 2). Phrase-based and curated to
    stay precise: retailer titles are full of site fluff ("| Total Wine"),
    so a generic unknown-token reject would nuke good candidates. The
    vision gate carries the general version of this rule; this catches
    the known offenders before we spend a vision call.
  */
  const candLower = String(candidateText ?? "").toLowerCase();
  const targetLower = String(mlccItem.name ?? "").toLowerCase();
  for (const phrase of SUBBRAND_CONFLICT_PHRASES) {
    // Exempt only when the TARGET ITSELF is that product line (full-phrase
    // match — "smirnoff" alone must not exempt a SMIRNOFF ICE candidate
    // from a plain SMIRNOFF VODKA target). If MLCC abbreviates the line
    // name, the SKU just falls to the placeholder — safe direction.
    if (candLower.includes(phrase) && !targetLower.includes(phrase)) {
      return { ok: false, reason: `different product line ("${phrase}")` };
    }
  }
  const candSize = extractBottleSizeMl(candidateText);
  if (
    candSize != null &&
    mlccItem.bottle_size_ml != null &&
    Math.abs(candSize - mlccItem.bottle_size_ml) > SIZE_TOLERANCE_ML
  ) {
    return {
      ok: false,
      reason: `size mismatch (${candSize} vs ${mlccItem.bottle_size_ml} mL)`,
    };
  }
  return { ok: true, sim };
}

// ── Args + env ─────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const DRY_RUN = argv["dry-run"] === "true";
/*
  --regate (2026-07-12 night): re-judge ALREADY-WRITTEN serper photos
  against the CURRENT vision gate and clear the ones that no longer pass.
  Born the night the strict run's first ~6,200 photos were audited on
  device and ad creatives (bottle + slogan tiles on white/colored
  backdrops) turned out to sail through the old prompt — the gate policed
  the SCENE (shelves/hands/rooms) but never named MARKETING GRAPHICS.
  The prompt now rejects ad tiles; this mode applies that standard
  retroactively so one gate governs every photo, whenever it was written.
  No Serper searches, no uploads — just vision checks (~$0.002-0.01/photo)
  + row clears. Cleared rows go back to the premium placeholder and become
  refill candidates for the next backfill run (image_source='regate_cleared'
  keeps provenance and stays eligible — only 'reported_wrong' is quarantined).
  DRY-RUN by default-ish: pass --dry-run=true to preview verdicts; a real
  run needs no extra flag but every clear is logged with the vision reason.
*/
const REGATE = argv.regate === "true";
const LIMIT = Number.parseInt(argv.limit ?? (REGATE ? "20000" : "25"), 10) || 25;
const SINGLE_CODE =
  typeof argv.code === "string" && argv.code !== "true" ? argv.code : null;
const CONCURRENCY = Math.min(
  6,
  Math.max(1, Number.parseInt(argv.concurrency ?? "3", 10) || 3),
);
const MIN_SIDE = Number.parseInt(argv["min-side"] ?? "300", 10) || 300;
const VISION = argv["skip-vision"] !== "true";
const FORCE = argv.force === "true" && SINGLE_CODE !== null; // re-check one code

/*
  PARALLEL SHARDING (2026-07-12) — `--shard=i/n` lets N terminals split the
  catalog into DISJOINT slices so they never process the same bottle. The
  slice is chosen by a stable hash of the CODE (not the row's position in a
  live-changing NULL-image list), so it's robust even when the terminals
  start at different times or fill rows mid-run: a code always belongs to
  exactly one shard, and the N shards together cover every code with zero
  overlap. Run e.g. `--shard=0/4` … `--shard=3/4` in four terminals.
*/
let SHARD_I = 0;
let SHARD_N = 1;
if (typeof argv.shard === "string" && /^\d+\/\d+$/.test(argv.shard)) {
  const [i, n] = argv.shard.split("/").map((x) => Number.parseInt(x, 10));
  if (n >= 1 && i >= 0 && i < n) {
    SHARD_I = i;
    SHARD_N = n;
  } else {
    console.error(`--shard=i/n needs 0 <= i < n; got "${argv.shard}"`);
    process.exit(1);
  }
}
/** Stable per-code shard: same code → same shard forever, regardless of state. */
function shardOfCode(code) {
  const s = String(code ?? "");
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
  return h % SHARD_N;
}
/*
  STRICT BACKGROUND POLICY — the default (2026-07-11, photo-truth mandate).
  Tony's verdict on the corpus that busy-background fallbacks produced:
  "inconsistent, wrong, ugly, incorrect, or mediocre — this goes against
  everything we stand for." From now on a photo is written ONLY when the
  vision gate confirms a clean studio background; a correct bottle on a
  busy background (shelves, hands, rooms, table scenes) is REJECTED and
  the SKU keeps the premium placeholder. `--allow-busy-fallback=true`
  restores the old coverage-over-beauty behavior deliberately — not
  recommended, kept for experiments only.

  (Attribution note: an equivalent change appeared in the tree tonight
  from an unattributed writer and was quarantined per zero-trust —
  evidence in UNATTRIBUTED-EDIT-2026-07-11.diff. THIS implementation is
  mine, written and audited in-session.)
*/
const ALLOW_BUSY_FALLBACK = argv["allow-busy-fallback"] === "true";

const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const { SERPER_API_KEY, ANTHROPIC_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env (LK_PROD_SUPABASE_URL / _SERVICE_ROLE_KEY).");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error(
    "SUPABASE_URL points at the LOCAL dev stack. Add LK_PROD_SUPABASE_URL + " +
      "LK_PROD_SUPABASE_SERVICE_ROLE_KEY to services/api/.env (dashboard: " +
      "https://supabase.com/dashboard/project/eamoozfhqolshdztbrez/settings/api).",
  );
  process.exit(1);
}
if (!SERPER_API_KEY && !REGATE) {
  console.error(
    "Missing SERPER_API_KEY. Sign up at https://serper.dev (2,500 free " +
      "searches), copy the API key from the dashboard, add a line\n" +
      "  SERPER_API_KEY=\nwith the key after the = to services/api/.env.",
  );
  process.exit(1);
}
if (REGATE && !VISION) {
  console.error("--regate IS the vision check — it cannot run with --skip-vision.");
  process.exit(1);
}
if (VISION && !ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY for the vision variant-check gate. It should " +
      "already be in services/api/.env — or pass --skip-vision (NOT " +
      "recommended: text matching alone let an 80-proof FRIS through for " +
      "the 100-proof SKU).",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Candidate loading: missing image, active, most-scanned first ────────────
async function loadCandidates() {
  // Single-code path (spot-checks / --force quality iteration): one row,
  // no paging needed — behavior identical to the original.
  if (SINGLE_CODE) {
    let q = supabase
      .from("mlcc_items")
      .select("code, name, category, bottle_size_ml, bottle_size_label, scan_count")
      .eq("is_active", true)
      .eq("code", SINGLE_CODE);
    if (!FORCE) q = q.is("image_url", null);
    if (!FORCE) q = q.or("image_source.is.null,image_source.neq.reported_wrong");
    const { data, error } = await q.limit(10);
    if (error) throw error;
    const byCode = new Map();
    for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
    return [...byCode.values()].slice(0, LIMIT);
  }

  /*
    PAGE past PostgREST's silent 1000-row response cap (2026-07-12 —
    the THIRD encounter with this scar: the 7/4 productId backfill, the
    7/11 census one-liner, and this script's first strict run, which was
    asked for 14,000 candidates and silently got exactly 1,000). Same
    fix as backfill-milo-product-ids.mjs: walk fixed .range() windows
    until a short page or enough distinct codes.

    The secondary .order("code") is load-bearing: scan_count is 0 for
    most of the catalog, and paging windows over a non-deterministic
    tie order can skip or duplicate rows between pages. The tiebreak
    makes pagination exact.
  */
  const PAGE_SIZE = 1000;
  const byCode = new Map();
  /*
    When sharding, we must page the ENTIRE remaining NULL-image set (not
    stop at LIMIT) so this shard sees all of its own codes — the shard
    filter is applied after loading. Un-sharded, stop once we have LIMIT.
  */
  for (let from = 0; SHARD_N > 1 || byCode.size < LIMIT; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, category, bottle_size_ml, bottle_size_label, scan_count")
      .eq("is_active", true)
      .is("image_url", null)
      .or("image_source.is.null,image_source.neq.reported_wrong")
      .order("scan_count", { ascending: false, nullsFirst: false })
      .order("code", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
    if (!data || data.length < PAGE_SIZE) break; // catalog exhausted
  }
  let ordered = [...byCode.values()];
  if (SHARD_N > 1) {
    ordered = ordered.filter((c) => shardOfCode(c.code) === SHARD_I);
  }
  return ordered.slice(0, LIMIT);
}

// ── Serper Google Images query ─────────────────────────────────────────────
async function serperImageSearch(query) {
  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: RESULTS_PER_QUERY }),
  });
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status === 403) return { ok: false, error: "quota_or_key" };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `http_${res.status} ${body.slice(0, 120)}` };
  }
  const json = await res.json();
  const images = Array.isArray(json.images) ? json.images : [];
  return {
    ok: true,
    results: images.map((it) => ({
      imageUrl: it.imageUrl,
      width: it.imageWidth ?? 0,
      height: it.imageHeight ?? 0,
      title: it.title ?? "",
      source: it.source ?? "",
      link: it.link ?? "",
    })),
  };
}

/**
 * Rank ALL verified results (not just the best one): the vision gate may
 * reject the top pick, so processItem walks down this list.
 *   - must pass name+size+variant text verification (hard gate)
 *   - must meet the minimum pixel size (hard gate)
 *   - trusted retailer domains rank first, then name similarity, then area
 */
function rankVerified(item, results) {
  const scored = [];
  for (const r of results) {
    if (!r.imageUrl) continue;
    if (Math.min(r.width, r.height) < MIN_SIDE && (r.width || r.height)) continue;
    const candidateText = `${r.title} ${r.source} ${r.link}`;
    const check = verifyMatch({ mlccItem: item, candidateText });
    if (!check.ok) continue;
    const trusted = TRUSTED_DOMAIN_RE.test(`${r.source} ${r.link}`) ? 1 : 0;
    scored.push({ r, sim: check.sim, trusted, area: r.width * r.height });
  }
  scored.sort(
    (a, b) => b.trusted - a.trusted || b.sim - a.sim || b.area - a.area,
  );
  return scored;
}

// ── Claude vision gate — looks at the ACTUAL image ─────────────────────────
/**
 * The FRIS lesson: text said "FRIS VODKA 100" but the photo was the plain
 * 80-proof bottle. Only inspecting the pixels catches that. Conservative:
 * any API/parse failure = FAIL (skip candidate), never a silent pass.
 */
async function visionCheck(item, buf, mediaType) {
  /*
    429-aware (2026-06-10 batch-200 lesson): concurrency × candidates
    hammered the Anthropic API and rate limits were counted as quality
    FAILS, burning legit candidates. A 429 is not a verdict — retry
    with exponential backoff + jitter before giving up.
  */
  const MAX_VISION_TRIES = 5;
  for (let attempt = 1; attempt <= MAX_VISION_TRIES; attempt += 1) {
    const result = await visionCheckOnce(item, buf, mediaType);
    if (!result.rateLimited) return result;
    if (attempt < MAX_VISION_TRIES) {
      const backoff = 2000 * 2 ** (attempt - 1) + Math.random() * 1000;
      await sleep(backoff);
    }
  }
  return {
    pass: false,
    cleanBackground: false,
    apiError: true,
    reason: "vision rate-limited after retries",
  };
}

async function visionCheckOnce(item, buf, mediaType) {
  const prompt =
    `You are a strict product-image QA checker for a liquor-store catalog. ` +
    `Target SKU: "${item.name}" (${item.category ?? "spirits"}` +
    `${item.bottle_size_label ? `, ${item.bottle_size_label}` : ""}). ` +
    `The target name is a TERSE WHOLESALE CATALOG STRING, not consumer ` +
    `packaging text. Common abbreviations in these names: BBN=bourbon, ` +
    `PL=plastic/traveler bottle, J DANIELS=Jack Daniel's, W/=with, ` +
    `(TN)=Tennessee, FLVD=flavored, LIQ=liqueur, RTD=ready to drink. ` +
    `Never fail a photo because the label doesn't literally contain a ` +
    `catalog abbreviation. ` +
    `Does this photo show this product? FAIL if: different brand; a ` +
    `DIFFERENT PRODUCT LINE or sub-brand of the same parent brand (e.g. a ` +
    `PARROT BAY bottle when the target is plain CAPTAIN MORGAN COCONUT RUM — ` +
    `if the label prominently shows a line name that is NOT in the target ` +
    `name, it is the WRONG product even when the parent brand matches); ` +
    `different ` +
    `flavor or named variant (e.g. raspberry when target is plain, Double ` +
    `Oaked when target is the standard expression); the label READABLY shows ` +
    `a proof or age statement that CONTRADICTS one in the target name; a ` +
    `multi-bottle pack or gift set when the target is a single bottle; not a ` +
    `product photo (logo, person, store shelf, meme); an ADVERTISEMENT or ` +
    `marketing creative — any added slogan, tagline, campaign text, price ` +
    `badge, or promotional graphic overlaid on or placed beside the product ` +
    `(text printed on the physical bottle label itself is fine; text added ` +
    `AROUND the bottle is an ad, not a product photo — FAIL it even on a ` +
    `white background). ` +
    `PACK RULE: if the target name contains a pack count like "4PK", "10PK", ` +
    `"15PK", "20PK", the product IS a multi-bottle pack — pack/display/bucket ` +
    `shots are CORRECT for those and a single-bottle shot is also acceptable. ` +
    `SIZE RULE: judge size ONLY from readable label text (e.g. "750ML" ` +
    `printed on the label). NEVER estimate size from bottle proportions — ` +
    `you cannot tell 375ml from 750ml in an isolated product shot. If no ` +
    `size text is readable, treat size as unknown and do NOT fail on size. ` +
    `Photo angle, lighting, and glass-vs-plastic are all fine. ` +
    `ALSO assess the background: "clean_background" is true ONLY for a ` +
    `professional product shot on a white, light, or plain studio ` +
    `background showing the product and NOTHING else. It is false if you ` +
    `can see store shelves, a room, a hand, a table setting, other ` +
    `products, or any busy scene behind the bottle — or ANY added ` +
    `graphics, text, borders, or color-block panels that are not part of ` +
    `the physical product (a plain colored backdrop with a slogan next to ` +
    `the bottle is an ad tile, NOT a clean product shot). ` +
    `Respond ONLY with raw JSON (no code fence) and keep "reason" UNDER 15 ` +
    `words: {"pass": true|false, "clean_background": true|false, "reason": "<short>"}.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: buf.toString("base64"),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (res.status === 429 || res.status === 529) {
    return { pass: false, cleanBackground: false, rateLimited: true, reason: "rate limited" };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    /*
      apiError marks this as a FAILURE TO JUDGE, not a judgment (2026-07-12
      night — the regate dry-run printed 60 "WOULD CLEAR" lines that were
      actually 60 out-of-credits errors; a live run would have wiped
      photos on them). Consumers must treat apiError as "no verdict":
      the backfill skips the candidate, the regate KEEPS the photo.
    */
    return {
      pass: false,
      cleanBackground: false,
      apiError: true,
      creditsExhausted: /credit balance is too low/i.test(body),
      reason: `vision api http_${res.status} ${body.slice(0, 100)}`,
    };
  }
  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  // Unparseable model output is also "no verdict" — never a clear signal.
  if (!match) {
    return { pass: false, apiError: true, reason: `unparseable: ${text.slice(0, 100)}` };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      pass: parsed.pass === true,
      cleanBackground: parsed.clean_background === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return {
      pass: false,
      cleanBackground: false,
      apiError: true,
      reason: `bad JSON: ${text.slice(0, 100)}`,
    };
  }
}

// ── Re-host into Supabase Storage ──────────────────────────────────────────
let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: true,
  });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
  bucketEnsured = true;
}

async function downloadImage(imageUrl) {
  let res;
  try {
    res = await fetch(imageUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LiquorKings/1.0)" },
    });
  } catch (e) {
    return { ok: false, reason: `download failed: ${e?.message ?? e}` };
  }
  if (!res.ok) return { ok: false, reason: `download http ${res.status}` };
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return { ok: false, reason: `not an image (${contentType})` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return { ok: false, reason: "empty image" };
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `too large (${buf.byteLength} bytes)` };
  }
  // Claude vision accepts jpeg/png/gif/webp — normalize the media type.
  const mediaType = contentType.includes("png")
    ? "image/png"
    : contentType.includes("webp")
      ? "image/webp"
      : contentType.includes("gif")
        ? "image/gif"
        : "image/jpeg";
  const ext = mediaType.split("/")[1].replace("jpeg", "jpg");
  return { ok: true, buf, contentType, mediaType, ext };
}

// Right-size at birth (quality mandate, 2026-06-12): we used to upload the
// ORIGINAL retailer bytes (often 1-3 MB) and let phones melt decoding them
// into 150px grid tiles. Now every accepted photo is stored twice, both
// WebP: a capped full for the ProductCard detail view and a ~360px thumb
// for the Browse grid / candidate pickers.
const FULL_MAX_WIDTH = 1600;
const FULL_QUALITY = 82;
const THUMB_WIDTH = 360;
const THUMB_QUALITY = 72;

async function uploadImage(code, dl) {
  let fullBuf;
  let thumbBuf;
  try {
    fullBuf = await sharp(dl.buf)
      .rotate() // honor EXIF orientation
      .resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toBuffer();
    thumbBuf = await sharp(dl.buf)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch (e) {
    return { ok: false, reason: `sharp re-encode failed: ${e.message}` };
  }

  const fullPath = `full/${code}.webp`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fullPath, fullBuf, { contentType: "image/webp", upsert: true });
  if (upErr) return { ok: false, reason: `upload failed: ${upErr.message}` };

  const thumbPath = `thumbs/${code}.webp`;
  const { error: thumbErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(thumbPath, thumbBuf, { contentType: "image/webp", upsert: true });
  if (thumbErr) return { ok: false, reason: `thumb upload failed: ${thumbErr.message}` };

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fullPath);
  const { data: thumbData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(thumbPath);
  if (!data?.publicUrl || !thumbData?.publicUrl) {
    return { ok: false, reason: "no public url" };
  }
  return { ok: true, publicUrl: data.publicUrl, thumbUrl: thumbData.publicUrl };
}

async function updateAllCodeRows(code, imageUrl, thumbUrl) {
  let upd = supabase
    .from("mlcc_items")
    .update({
      image_url: imageUrl,
      image_thumb_url: thumbUrl ?? null,
      image_source: "serper_google_images",
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code);
  if (!FORCE) upd = upd.is("image_url", null); // never overwrite, except --force single-code
  const { error } = await upd;
  if (error) {
    console.warn(`[serper-img] ${code} update failed: ${error.message}`);
    return false;
  }
  return true;
}

// ── --regate: apply the CURRENT gate to already-written serper photos ──────
async function loadRegateTargets() {
  // Same exact-pagination pattern as loadCandidates (1000-row cap scar,
  // stable code tiebreak) — but selecting rows that HAVE a serper photo.
  const PAGE_SIZE = 1000;
  const byCode = new Map();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, category, bottle_size_ml, bottle_size_label, scan_count, image_url")
      .eq("is_active", true)
      .not("image_url", "is", null)
      .eq("image_source", "serper_google_images")
      .order("scan_count", { ascending: false, nullsFirst: false })
      .order("code", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
    if (!data || data.length < PAGE_SIZE) break;
  }
  let ordered = [...byCode.values()];
  if (SHARD_N > 1) ordered = ordered.filter((c) => shardOfCode(c.code) === SHARD_I);
  if (SINGLE_CODE) ordered = ordered.filter((c) => c.code === SINGLE_CODE);
  return ordered.slice(0, LIMIT);
}

/**
 * Clear a failed photo back to the premium placeholder. Scoped to
 * image_source='serper_google_images' so an in-store photo snapped
 * between load and write can NEVER be cleared by this pass (in_store
 * outranks backfill — photo-truth precedence). Storage objects are left
 * in place on purpose: refills upsert the same path, and an orphaned
 * webp is harmless while a wrongly-deleted one is not.
 */
async function clearCodeRows(code) {
  const { error } = await supabase
    .from("mlcc_items")
    .update({
      image_url: null,
      image_thumb_url: null,
      image_source: "regate_cleared",
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code)
    .eq("image_source", "serper_google_images");
  if (error) {
    console.warn(`[regate] ${code} clear failed: ${error.message}`);
    return false;
  }
  return true;
}

async function mainRegate() {
  console.log(
    `[regate] mode=${DRY_RUN ? "DRY-RUN (verdicts only, no writes)" : "WRITE (failures cleared to placeholder)"} ` +
      `limit=${LIMIT} concurrency=${CONCURRENCY}` +
      (SHARD_N > 1 ? ` shard=${SHARD_I}/${SHARD_N}` : "") +
      (SINGLE_CODE ? ` code=${SINGLE_CODE}` : ""),
  );
  const targets = await loadRegateTargets();
  console.log(
    `[regate] ${targets.length} photo(s) to re-judge — est. vision cost ` +
      `$${(targets.length * 0.002).toFixed(2)}-$${(targets.length * 0.01).toFixed(2)}`,
  );
  if (targets.length === 0) return;

  const stats = { kept: 0, cleared: 0, retry: 0, done: 0 };
  const total = targets.length;
  let abort = false;
  let apiErrorStreak = 0;

  async function regateItem(item) {
    const tag = `[${++stats.done}/${total}] ${item.code} "${item.name}"`;
    const dl = await downloadImage(item.image_url);
    if (!dl.ok) {
      // Fail CLOSED for deletion: uncertainty never destroys a photo.
      stats.retry += 1;
      console.log(`${tag} — download failed (${dl.reason}) — kept, re-run to retry`);
      return;
    }
    const check = await visionCheck(item, dl.buf, dl.mediaType);
    /*
      NO VERDICT ≠ FAIL (the 2026-07-12 out-of-credits lesson: the first
      dry-run printed 60 "WOULD CLEAR" lines that were 60 http_400s — a
      live run would have wiped photos on API errors). An apiError KEEPS
      the photo, and credit exhaustion / persistent errors stop the whole
      pass instead of spending hours judging nothing.
    */
    if (check.apiError) {
      stats.retry += 1;
      apiErrorStreak += 1;
      if (check.creditsExhausted || apiErrorStreak >= 8) {
        abort = true;
        console.log(
          `${tag} — ${check.creditsExhausted ? "ANTHROPIC CREDITS EXHAUSTED" : "vision API failing repeatedly"} ` +
            `— stopping. Nothing is cleared on errors; add credits and re-run.`,
        );
        return;
      }
      console.log(`${tag} — vision unavailable (${check.reason}) — kept, re-run to retry`);
      return;
    }
    apiErrorStreak = 0;
    if (check.pass && check.cleanBackground) {
      stats.kept += 1;
      return;
    }
    const verdict = !check.pass ? `rejected: ${check.reason}` : "busy/ad background";
    if (DRY_RUN) {
      stats.cleared += 1;
      console.log(`${tag} — WOULD CLEAR (${verdict})`);
      return;
    }
    if (await clearCodeRows(item.code)) {
      stats.cleared += 1;
      console.log(`${tag} — ✗ cleared (${verdict})`);
    } else {
      stats.retry += 1;
    }
  }

  const queue = [...targets];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      if (abort) return;
      const item = queue.shift();
      if (!item) return;
      try {
        await regateItem(item);
      } catch (e) {
        stats.retry += 1;
        console.log(`  ${item.code} — worker error: ${e?.message ?? e}`);
      }
      await sleep(150);
    }
  });
  await Promise.all(workers);

  console.log(
    `[regate] done. kept=${stats.kept} cleared=${stats.cleared} retry=${stats.retry}`,
  );
  if (stats.cleared > 0 && !DRY_RUN) {
    console.log(
      `[regate] ${stats.cleared} code(s) back on the premium placeholder — ` +
        `the next backfill run re-searches them through the tightened gate.`,
    );
  }
}

async function main() {
  if (REGATE) return mainRegate();
  console.log(
    `[serper-img] mode=${DRY_RUN ? "DRY-RUN (no writes; queries still count)" : "WRITE"} ` +
      `limit=${LIMIT} concurrency=${CONCURRENCY} minSide=${MIN_SIDE} ` +
      `vision=${VISION ? "on" : "OFF"}${FORCE ? " FORCE" : ""}` +
      (SHARD_N > 1 ? ` shard=${SHARD_I}/${SHARD_N}` : "") +
      (SINGLE_CODE ? ` code=${SINGLE_CODE}` : ""),
  );
  const candidates = await loadCandidates();
  console.log(`[serper-img] ${candidates.length} candidate SKU(s)`);
  if (candidates.length === 0) return;

  if (!DRY_RUN) await ensureBucket();

  const stats = { written: 0, noMatch: 0, failed: 0, queries: 0, done: 0 };
  const total = candidates.length;
  let abort = false;

  async function processItem(item) {
    const tag = `[${++stats.done}/${total}] ${item.code} "${item.name}"`;
    const sizeLabel = item.bottle_size_label ?? `${item.bottle_size_ml ?? ""}ml`;
    /*
      RECALL FIX (2026-07-14): search AND text-match on the EXPANDED name.
      The raw wholesale string ("ARROW PPRMNT SCHNAPPS PL") found nothing
      AND the variant guard rejected correct results ("mentions
      peppermint" — a flavor the raw token set didn't contain). One
      expanded truth feeds the query, the containment score, the variant
      guard, and the sub-brand check. The VISION gate keeps the raw name —
      its prompt decodes abbreviations itself and is proven at scale.
    */
    const expandedName = expandMlccNameForImageSearch(item.name) || item.name;
    const matchItem = expandedName === item.name ? item : { ...item, name: expandedName };
    if (expandedName !== item.name) {
      console.log(`${tag} — searching as "${expandedName}"`);
    }
    // Exclude a known collision brand at the search level so the real
    // (budget) brand's photos aren't buried by the premium impostor.
    const negatives = collisionNegativesFor(expandedName);
    const query = `${expandedName} ${sizeLabel} liquor bottle${
      negatives.length ? " " + negatives.join(" ") : ""
    }`.trim();
    if (negatives.length) {
      console.log(`${tag} — excluding at search: ${negatives.join(" ")}`);
    }

    const search = await serperImageSearch(query);
    stats.queries += 1;
    if (!search.ok) {
      if (search.error === "rate_limited") {
        console.log(`${tag} — rate limited, backing off 15s`);
        await sleep(15_000);
        stats.failed += 1;
        return;
      }
      if (search.error === "quota_or_key") {
        console.log(`${tag} — QUOTA EXHAUSTED or bad key. Stopping all workers.`);
        abort = true;
        return;
      }
      stats.failed += 1;
      console.log(`${tag} — search ${search.error}`);
      return;
    }

    const ranked = rankVerified(matchItem, search.results);
    if (ranked.length === 0) {
      stats.noMatch += 1;
      console.log(`${tag} — ✗ no verified match (${search.results.length} results)`);
      return;
    }

    if (DRY_RUN) {
      const best = ranked[0];
      console.log(
        `${tag} — would try (sim=${best.sim.toFixed(2)} trusted=${best.trusted}) ${best.r.imageUrl.slice(0, 70)}…`,
      );
      return;
    }

    /*
     * Walk the ranked candidates: download → vision-inspect the pixels.
     * Background policy (Tony, 2026-06-10 — "I'd rather just have all
     * white backgrounds, it looks way more professional"):
     *   - a candidate that passes AND has a clean studio background is
     *     written immediately;
     *   - a candidate that passes but has a busy background (store
     *     shelves, hands, rooms) is held as a FALLBACK — used only if
     *     no clean shot survives the walk;
     *   - nothing passes at all → placeholder (accurate or nothing).
     */
    // 4 → 8 (2026-07-14 recall fix): with expanded names producing more
    // verified candidates, a clean shot at position 6 deserves its walk.
    // Only stubborn items pay the extra vision calls — clean hits still
    // stop at the first accept.
    const MAX_TRIES = 8;
    let fallback = null; // first correct-but-busy-background candidate
    for (const cand of ranked.slice(0, MAX_TRIES)) {
      const dl = await downloadImage(cand.r.imageUrl);
      if (!dl.ok) {
        console.log(`${tag} — candidate skipped (${dl.reason}), trying next`);
        continue;
      }

      if (VISION) {
        const check = await visionCheck(item, dl.buf, dl.mediaType);
        /*
          apiError = the gate couldn't judge (out of credits, 5xx, bad
          key) — NOT a quality verdict. Credit exhaustion stops the whole
          run: without a working gate every candidate "fails", so the
          run would spend real Serper searches producing only noMatch
          placeholders (exactly what the tail of the 7/12 evening run
          did once the balance hit zero).
        */
        if (check.apiError) {
          if (check.creditsExhausted) {
            console.log(
              `${tag} — ANTHROPIC CREDITS EXHAUSTED — stopping all workers ` +
                `(searches without a gate are money for nothing; add credits and re-run).`,
            );
            abort = true;
            return;
          }
          console.log(`${tag} — vision error (${check.reason}), trying next`);
          continue;
        }
        if (!check.pass) {
          console.log(`${tag} — vision rejected (${check.reason}), trying next`);
          continue;
        }
        if (!check.cleanBackground) {
          if (ALLOW_BUSY_FALLBACK) {
            if (!fallback) fallback = dl;
            console.log(`${tag} — correct bottle but busy background, holding as fallback`);
          } else {
            // STRICT default (2026-07-11): clean studio shot or premium
            // placeholder — a correct bottle on a messy background is
            // still not good enough to represent the catalog.
            console.log(`${tag} — correct bottle but busy background — strict mode, rejected`);
          }
          continue;
        }
      }

      const written = await writeImage(item, dl, tag);
      if (written) stats.written += 1;
      return;
    }

    if (fallback && ALLOW_BUSY_FALLBACK) {
      const written = await writeImage(item, fallback, tag, " (busy-bg fallback)");
      if (written) stats.written += 1;
      return;
    }

    stats.noMatch += 1;
    console.log(`${tag} — ✗ all ${Math.min(ranked.length, MAX_TRIES)} candidates failed vision/download`);
  }

  /** Upload + DB write for a vision-approved download. Returns success. */
  async function writeImage(item, dl, tag, note = "") {
    const hosted = await uploadImage(item.code, dl);
    if (!hosted.ok) {
      stats.failed += 1;
      console.log(`${tag} — ✗ ${hosted.reason}`);
      return false;
    }
    const ok = await updateAllCodeRows(item.code, hosted.publicUrl, hosted.thumbUrl);
    if (ok) {
      console.log(`${tag} — ✓${note} ${hosted.publicUrl}`);
      return true;
    }
    console.log(`${tag} — write failed`);
    return false;
  }

  const queue = [...candidates];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      if (abort) return;
      const item = queue.shift();
      if (!item) return;
      try {
        await processItem(item);
      } catch (e) {
        stats.failed += 1;
        console.log(`  ${item.code} — worker error: ${e?.message ?? e}`);
      }
      await sleep(150);
    }
  });
  await Promise.all(workers);

  console.log(
    `[serper-img] done. written=${stats.written} noMatch=${stats.noMatch} ` +
      `failed=${stats.failed} queries=${stats.queries}`,
  );
  if (stats.noMatch > 0) {
    console.log(
      `[serper-img] ${stats.noMatch} SKU(s) had no verified match — they keep ` +
        `the premium BottleArt placeholder. Re-run later or curate via /admin/catalog-images.`,
    );
  }
}

main().catch((e) => {
  console.error("[serper-img] fatal", e);
  process.exit(1);
});
