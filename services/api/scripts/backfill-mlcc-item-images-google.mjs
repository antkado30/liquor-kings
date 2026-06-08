#!/usr/bin/env node
/**
 * Backfill mlcc_items.image_url from Google Programmable Search (Custom
 * Search JSON API), image mode (task: catalog photos, 2026-06-07).
 *
 * WHY THIS EXISTS:
 *   Tony: "I hate the pictures, bro. The pictures are ugly as fuck ... we're
 *   gonna figure out how to get every single picture of an MLCC ... each one."
 *   UPCitemdb was unviable (rate-limited at 7 calls, sparse liquor coverage —
 *   see project_upcitemdb_unviable). Google image search has far broader
 *   coverage. Locked plan A+C: bulk Google fill (verified) + manual top-SKU
 *   curation via /admin/catalog-images.
 *
 * QUALITY / SAFETY (integrity doctrine — "no Tito's photo on a Hennessy code"):
 *   1. Pin-point verify every hit: the result's title/snippet must contain a
 *      high fraction of the MLCC name's tokens AND (when both have a parseable
 *      size) the sizes must match within tolerance. Mismatch → skip, no write.
 *   2. RE-HOST the verified image into our own Supabase Storage bucket instead
 *      of hot-linking Google's result URL. Hot-linked URLs expire / hotlink-
 *      block / 403 → broken images, which is exactly the "ugly" Tony hates.
 *      Re-hosting also serves from our CDN (faster — helps the instant-feel goal).
 *   3. Process MOST-SCANNED bottles first (scan_count desc) so a limited daily
 *      quota lands on the SKUs that actually matter to the store.
 *
 * COST: Custom Search JSON API is $5 / 1000 queries (100/day free, 10k/day cap).
 *   ~13.8k SKUs ≈ $70 one-time if every SKU takes one query. Run in batches.
 *
 * MODES:
 *   --dry-run            Print what WOULD happen; no Google calls billed? (NO —
 *                        dry-run STILL calls Google to show real candidates, but
 *                        does NOT download/upload/write. Use --limit small.)
 *   --limit=N            Cap candidates (default 25). Keep small while testing.
 *   --code=XXX           Single MLCC code (debug / quality spot-check).
 *   --no-rehost          Write the Google image URL directly (fragile; testing).
 *   --query-suffix="..." Extra query words (default "liquor bottle").
 *
 * ENV (set in services/api/.env or shell):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_API_KEY            (Google Cloud → Custom Search API key)
 *   GOOGLE_CSE_ID            (Programmable Search Engine "Search engine ID", cx)
 *
 * USAGE (from services/api/):
 *   node scripts/backfill-mlcc-item-images-google.mjs --code=100009 --dry-run
 *   node scripts/backfill-mlcc-item-images-google.mjs --limit=25
 *
 * Idempotent: only touches rows where image_url IS NULL. Re-run safely.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractBottleSizeMl } from "../src/lib/upcitemdb.js";

// ── Verification tunables ──────────────────────────────────────────────────
const NAME_SIMILARITY_THRESHOLD = 0.6; // 60% of MLCC tokens must appear in title
const SIZE_TOLERANCE_ML = 50;
const STORAGE_BUCKET = "bottle-images";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // skip absurdly large files
const GOOGLE_RESULTS_PER_QUERY = 6;

const STOPWORDS = new Set([
  "ml", "l", "ltr", "liter", "litre", "oz", "floz", "fl",
  "the", "of", "and", "with", "a", "an", "&",
  "pack", "bottle", "bottles", "btl", "case",
]);

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

/**
 * Verify a Google image result is safe for this MLCC item. We compare against
 * the result's title + snippet + context page title (whatever text we have).
 */
function verifyMatch({ mlccItem, candidateText, candidateSizeText }) {
  const sim = nameContainment(mlccItem.name, candidateText);
  if (sim < NAME_SIMILARITY_THRESHOLD) {
    return {
      ok: false,
      reason: `name mismatch (${sim.toFixed(2)}) "${String(candidateText).slice(0, 50)}"`,
    };
  }
  const candSize =
    extractBottleSizeMl(candidateSizeText) ?? extractBottleSizeMl(candidateText);
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
const REHOST = argv["no-rehost"] !== "true";
const QUERY_SUFFIX =
  typeof argv["query-suffix"] === "string" && argv["query-suffix"] !== "true"
    ? argv["query-suffix"]
    : "liquor bottle";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY, GOOGLE_CSE_ID } =
  process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
  console.error(
    "Missing GOOGLE_API_KEY or GOOGLE_CSE_ID. Get an API key (Google Cloud → " +
      "Custom Search API) and a Programmable Search Engine ID (cx).",
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
    .select("code, name, bottle_size_ml, bottle_size_label, scan_count")
    .is("image_url", null)
    .eq("is_active", true);
  if (SINGLE_CODE) q = q.eq("code", SINGLE_CODE);
  // Most-scanned first so a limited quota covers the bottles that matter.
  q = q.order("scan_count", { ascending: false, nullsFirst: false }).limit(LIMIT * 3);
  const { data, error } = await q;
  if (error) throw error;
  // Dedupe by code (same code can repeat across ADAs; same photo applies).
  const byCode = new Map();
  for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
  return [...byCode.values()].slice(0, LIMIT);
}

// ── Google Custom Search image query ───────────────────────────────────────
async function googleImageSearch(query) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(GOOGLE_RESULTS_PER_QUERY));
  url.searchParams.set("safe", "active");
  const res = await fetch(url);
  if (res.status === 429) return { ok: false, error: "quota" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  const json = await res.json();
  const items = Array.isArray(json.items) ? json.items : [];
  return {
    ok: true,
    results: items.map((it) => ({
      imageUrl: it.link,
      mime: it.mime ?? null,
      title: it.title ?? "",
      snippet: it.snippet ?? "",
      contextTitle: it.image?.contextLink ?? "",
    })),
  };
}

// ── Re-host a verified image into Supabase Storage; return public URL ───────
let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: true,
  });
  // "already exists" is fine.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
  bucketEnsured = true;
}

async function rehostImage(code, imageUrl) {
  let res;
  try {
    res = await fetch(imageUrl, { redirect: "follow" });
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
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const path = `${code}.${ext}`;
  await ensureBucket();
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (upErr) return { ok: false, reason: `upload failed: ${upErr.message}` };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, reason: "no public url" };
  return { ok: true, publicUrl: data.publicUrl };
}

async function updateAllCodeRows(code, imageUrl, source) {
  const { error } = await supabase
    .from("mlcc_items")
    .update({
      image_url: imageUrl,
      image_source: source,
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code)
    .is("image_url", null); // never overwrite a manually-curated image
  if (error) {
    console.warn(`[google-img] ${code} update failed: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(
    `[google-img] mode=${DRY_RUN ? "DRY-RUN" : "WRITE"} limit=${LIMIT} ` +
      `rehost=${REHOST} suffix="${QUERY_SUFFIX}"` +
      (SINGLE_CODE ? ` code=${SINGLE_CODE}` : ""),
  );
  const candidates = await loadCandidates();
  console.log(`[google-img] ${candidates.length} candidate SKU(s)`);
  if (candidates.length === 0) return;

  let written = 0;
  let rejected = 0;
  let misses = 0;
  let queries = 0;

  for (const item of candidates) {
    const sizeLabel = item.bottle_size_label ?? `${item.bottle_size_ml ?? ""}ml`;
    const query = `${item.name} ${sizeLabel} ${QUERY_SUFFIX}`.trim();
    process.stdout.write(`  ${item.code}  "${item.name}" ... `);

    const search = await googleImageSearch(query);
    queries += 1;
    if (!search.ok) {
      if (search.error === "quota") {
        console.log("QUOTA hit — stopping early");
        break;
      }
      misses += 1;
      console.log(`search ${search.error}`);
      await sleep(300);
      continue;
    }

    // Find the first result that passes pin-point verification.
    let chosen = null;
    let chosenSim = 0;
    for (const r of search.results) {
      const candidateText = `${r.title} ${r.snippet} ${r.contextTitle}`;
      const check = verifyMatch({
        mlccItem: item,
        candidateText,
        candidateSizeText: `${r.title} ${r.snippet}`,
      });
      if (check.ok) {
        chosen = r;
        chosenSim = check.sim;
        break;
      }
    }

    if (!chosen) {
      rejected += 1;
      console.log("✗ no verified match");
      await sleep(300);
      continue;
    }

    if (DRY_RUN) {
      console.log(`would use (sim=${chosenSim.toFixed(2)}) ${chosen.imageUrl.slice(0, 60)}…`);
      await sleep(300);
      continue;
    }

    let finalUrl = chosen.imageUrl;
    let source = "google_cse_hotlink";
    if (REHOST) {
      const hosted = await rehostImage(item.code, chosen.imageUrl);
      if (!hosted.ok) {
        // Try the next verified result rather than writing a fragile hotlink.
        rejected += 1;
        console.log(`✗ rehost failed (${hosted.reason})`);
        await sleep(300);
        continue;
      }
      finalUrl = hosted.publicUrl;
      source = "google_cse";
    }

    const ok = await updateAllCodeRows(item.code, finalUrl, source);
    if (ok) {
      written += 1;
      console.log(`✓ set (sim=${chosenSim.toFixed(2)})`);
    } else {
      console.log("write failed");
    }
    await sleep(300);
  }

  const estCost = (queries / 1000) * 5;
  console.log(
    `[google-img] done. written=${written} rejected=${rejected} misses=${misses} ` +
      `queries=${queries} (~$${estCost.toFixed(2)})`,
  );
}

main().catch((e) => {
  console.error("[google-img] fatal", e);
  process.exit(1);
});
