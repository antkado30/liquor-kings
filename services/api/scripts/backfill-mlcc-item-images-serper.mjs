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
  "hard seltzer",
  "ranch water",
];

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
const LIMIT = Number.parseInt(argv.limit ?? "25", 10) || 25;
const SINGLE_CODE =
  typeof argv.code === "string" && argv.code !== "true" ? argv.code : null;
const CONCURRENCY = Math.min(
  6,
  Math.max(1, Number.parseInt(argv.concurrency ?? "3", 10) || 3),
);
const MIN_SIDE = Number.parseInt(argv["min-side"] ?? "300", 10) || 300;
const VISION = argv["skip-vision"] !== "true";
const FORCE = argv.force === "true" && SINGLE_CODE !== null; // re-check one code

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
if (!SERPER_API_KEY) {
  console.error(
    "Missing SERPER_API_KEY. Sign up at https://serper.dev (2,500 free " +
      "searches), copy the API key from the dashboard, add a line\n" +
      "  SERPER_API_KEY=\nwith the key after the = to services/api/.env.",
  );
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
  let q = supabase
    .from("mlcc_items")
    .select("code, name, category, bottle_size_ml, bottle_size_label, scan_count")
    .eq("is_active", true);
  // --force (single-code only) re-checks a SKU that already has an image —
  // used when iterating on quality for one bottle.
  if (!FORCE) q = q.is("image_url", null);
  // Never re-fill a code a store user reported as wrong ("wrong photo?"
  // flag, 2026-06-10) — those wait for in-store capture or manual curation.
  if (!FORCE) q = q.or("image_source.is.null,image_source.neq.reported_wrong");
  if (SINGLE_CODE) q = q.eq("code", SINGLE_CODE);
  q = q.order("scan_count", { ascending: false, nullsFirst: false }).limit(LIMIT * 3);
  const { data, error } = await q;
  if (error) throw error;
  const byCode = new Map();
  for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
  return [...byCode.values()].slice(0, LIMIT);
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
  return { pass: false, cleanBackground: false, reason: "vision rate-limited after retries" };
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
    `product photo (logo, person, store shelf, meme). ` +
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
    `background. It is false if you can see store shelves, a room, a hand, ` +
    `a table setting, other products, or any busy scene behind the bottle. ` +
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
    return { pass: false, cleanBackground: false, reason: `vision api http_${res.status} ${body.slice(0, 100)}` };
  }
  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: false, reason: `unparseable: ${text.slice(0, 100)}` };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      pass: parsed.pass === true,
      cleanBackground: parsed.clean_background === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { pass: false, cleanBackground: false, reason: `bad JSON: ${text.slice(0, 100)}` };
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

async function main() {
  console.log(
    `[serper-img] mode=${DRY_RUN ? "DRY-RUN (no writes; queries still count)" : "WRITE"} ` +
      `limit=${LIMIT} concurrency=${CONCURRENCY} minSide=${MIN_SIDE} ` +
      `vision=${VISION ? "on" : "OFF"}${FORCE ? " FORCE" : ""}` +
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
    const query = `${item.name} ${sizeLabel} liquor bottle`.trim();

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

    const ranked = rankVerified(item, search.results);
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
    const MAX_TRIES = 4;
    let fallback = null; // first correct-but-busy-background candidate
    for (const cand of ranked.slice(0, MAX_TRIES)) {
      const dl = await downloadImage(cand.r.imageUrl);
      if (!dl.ok) {
        console.log(`${tag} — candidate skipped (${dl.reason}), trying next`);
        continue;
      }

      if (VISION) {
        const check = await visionCheck(item, dl.buf, dl.mediaType);
        if (!check.pass) {
          console.log(`${tag} — vision rejected (${check.reason}), trying next`);
          continue;
        }
        if (!check.cleanBackground) {
          if (!fallback) fallback = dl;
          console.log(`${tag} — correct bottle but busy background, holding as fallback`);
          continue;
        }
      }

      const written = await writeImage(item, dl, tag);
      if (written) stats.written += 1;
      return;
    }

    if (fallback) {
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
