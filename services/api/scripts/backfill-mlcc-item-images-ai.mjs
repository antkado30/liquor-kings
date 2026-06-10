#!/usr/bin/env node
/**
 * Backfill mlcc_items.image_url with AI-GENERATED bottle renders
 * (task: catalog photos, NEXT PATH after Google CSE dead-ended 2026-06-08).
 *
 * WHY THIS EXISTS:
 *   13.8k MLCC SKUs have no product photo. UPCitemdb: unviable (rate limits +
 *   sparse coverage). Google Custom Search: dead end (persistent 403 on a
 *   correctly-configured project + "entire web" image search is deprecated).
 *   AI generation is the only path to TRUE 100% coverage: consistent premium
 *   on-white renders, most-scanned-first.
 *
 * THE KNOWN RISK (integrity doctrine — pre-mortem'd):
 *   Image models garble label text. A generated "Tito's" might render
 *   "Titto's" or gibberish — worse than no photo, because it lies.
 *   Mitigations, all ON by default:
 *     1. Claude vision VERIFY gate: every generated image is checked —
 *        right product category? label plausibly reads the brand? no
 *        obvious text gibberish? Fail → reject, never written.
 *     2. image_source = "ai_generated" on every row this script touches,
 *        so AI renders are queryable/replaceable wholesale later and the
 *        /admin/catalog-images curation UI can filter them.
 *     3. Only fills image_url IS NULL — never overwrites curated/real photos.
 *     4. DRY-RUN is the default. Generation costs real money; nothing is
 *        generated, uploaded, or written unless --spend is passed.
 *
 * COST (approximate, check current pricing before a full run):
 *   OpenAI gpt-image-1 1024×1024 ≈ $0.01-0.05/image depending on quality
 *   + a Claude vision verify call ≈ $0.01/image.
 *   Full 13.8k catalog ≈ $300-700 all-in. Run in batches, spot-check first.
 *
 * MODES:
 *   (default)            DRY-RUN: list candidates + prompts + est. cost. $0.
 *   --spend              Actually generate / verify / upload / write.
 *   --limit=N            Cap SKUs this run (default 8; keep small at first).
 *   --code=XXX           Single MLCC code (quality spot-check).
 *   --quality=low|medium|high   gpt-image-1 quality (default medium).
 *   --skip-verify        Skip the Claude vision gate (NOT recommended).
 *   --concurrency=N      Parallel workers (default 3, max 8). A serial
 *                        13.8k run is ~24h; 4 workers ≈ 6h overnight.
 *
 * FULL-CATALOG RUN (after the spot-check passes Tony's eye):
 *   caffeinate -i node scripts/backfill-mlcc-item-images-ai.mjs \
 *     --limit=14000 --spend --concurrency=4
 *   (caffeinate keeps the Mac awake; the script is resumable — it only
 *   ever targets image_url IS NULL, so a crash/stop loses nothing.)
 *
 * ENV (services/api/.env or shell):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (existing)
 *   OPENAI_API_KEY                            (image generation)
 *   ANTHROPIC_API_KEY                         (vision verify; existing secret)
 *
 * USAGE (from services/api/):
 *   node scripts/backfill-mlcc-item-images-ai.mjs --code=100009          # dry
 *   node scripts/backfill-mlcc-item-images-ai.mjs --code=100009 --spend  # 1 real
 *   node scripts/backfill-mlcc-item-images-ai.mjs --limit=25 --spend
 *
 * Idempotent: only touches rows where image_url IS NULL. Re-run safely.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ── Tunables ───────────────────────────────────────────────────────────────
const STORAGE_BUCKET = "bottle-images";
const IMAGE_SIZE = "1024x1024";
const VERIFY_MODEL = "claude-haiku-4-5-20251001"; // cheap + good enough for a yes/no label check
const OPENAI_IMAGE_MODEL = "gpt-image-1";
// Rough per-image estimates for the cost printout only (not billing truth).
const EST_GEN_COST = { low: 0.011, medium: 0.042, high: 0.167 };
const EST_VERIFY_COST = 0.01;

// ── Args + env ─────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const SPEND = argv.spend === "true";
const LIMIT = Number.parseInt(argv.limit ?? "8", 10) || 8;
const SINGLE_CODE =
  typeof argv.code === "string" && argv.code !== "true" ? argv.code : null;
const QUALITY = ["low", "medium", "high"].includes(argv.quality)
  ? argv.quality
  : "medium";
const VERIFY = argv["skip-verify"] !== "true";
const CONCURRENCY = Math.min(
  8,
  Math.max(1, Number.parseInt(argv.concurrency ?? "3", 10) || 3),
);

/*
 * Supabase target: prefer the LK_PROD_* pair when set. The plain
 * SUPABASE_URL in services/api/.env points at the LOCAL dev stack
 * (127.0.0.1:54321) on Tony's Mac — images must land in PROD
 * (eamoozfhqolshdztbrez). Refuse localhost so a half-configured env
 * can't silently write to the wrong database (doctrine: loud failures).
 */
const SUPABASE_URL =
  process.env.LK_PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const { OPENAI_API_KEY, ANTHROPIC_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
  console.error(
    "SUPABASE_URL points at the LOCAL dev stack. This script targets the " +
      "production catalog. Add these two lines to services/api/.env:\n" +
      "  LK_PROD_SUPABASE_URL=https://eamoozfhqolshdztbrez.supabase.co\n" +
      "  LK_PROD_SUPABASE_SERVICE_ROLE_KEY=<service_role key from the Supabase dashboard>\n" +
      "Dashboard: https://supabase.com/dashboard/project/eamoozfhqolshdztbrez/settings/api",
  );
  process.exit(1);
}
if (SPEND && !OPENAI_API_KEY) {
  console.error(
    "Missing OPENAI_API_KEY (needed for --spend). Add it to services/api/.env.",
  );
  process.exit(1);
}
if (SPEND && VERIFY && !ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY for the vision verify gate. Add it, or pass " +
      "--skip-verify (not recommended — unverified AI labels can lie).",
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
    .is("image_url", null)
    .eq("is_active", true);
  if (SINGLE_CODE) q = q.eq("code", SINGLE_CODE);
  q = q.order("scan_count", { ascending: false, nullsFirst: false }).limit(LIMIT * 3);
  const { data, error } = await q;
  if (error) throw error;
  // Dedupe by code (same code repeats across ADAs; same image applies).
  const byCode = new Map();
  for (const it of data ?? []) if (!byCode.has(it.code)) byCode.set(it.code, it);
  return [...byCode.values()].slice(0, LIMIT);
}

// ── Prompt — consistent premium on-white render across the whole catalog ────
function buildPrompt(item) {
  const size = item.bottle_size_label ?? (item.bottle_size_ml ? `${item.bottle_size_ml} mL` : "");
  const category = item.category ?? "spirits";
  return (
    `Professional studio product photograph of a single ${size} bottle of ` +
    `${item.name} (${category}). Centered, upright, full bottle in frame on a ` +
    `pure white seamless background with a soft natural shadow. Photorealistic, ` +
    `even diffused lighting, crisp focus. The brand label must clearly and ` +
    `accurately read "${item.name}" with clean, legible typography. No props, ` +
    `no glassware, no watermarks, no extra text anywhere in the image.`
  );
}

// ── OpenAI image generation ────────────────────────────────────────────────
async function generateImage(prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: IMAGE_SIZE,
      quality: QUALITY,
      n: 1,
    }),
  });
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `http_${res.status} ${body.slice(0, 200)}` };
  }
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) return { ok: false, error: "no image in response" };
  return { ok: true, buf: Buffer.from(b64, "base64") };
}

// ── Claude vision verify gate ──────────────────────────────────────────────
/**
 * Returns { pass: boolean, reason: string }. Conservative by design: any
 * parse failure or API error counts as a FAIL (we'd rather re-generate or
 * skip than ship a lying label — doctrine #5, loud failures only).
 */
async function verifyImage(item, imageBuf) {
  const prompt =
    `You are a strict product-image QA checker for a liquor catalog. ` +
    `This image was AI-generated to depict: "${item.name}" ` +
    `(${item.category ?? "spirits"}${item.bottle_size_label ? `, ${item.bottle_size_label}` : ""}). ` +
    `Check: (1) it shows exactly one bottle of the right product type, ` +
    `(2) the label text plausibly reads the brand/product name above — minor ` +
    `stylization is fine, but misspellings or gibberish text are an automatic fail, ` +
    `(3) no watermarks or extraneous text. ` +
    `Respond with ONLY a JSON object: {"pass": true|false, "reason": "<short>"}.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VERIFY_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageBuf.toString("base64"),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { pass: false, reason: `verify api http_${res.status} ${body.slice(0, 120)}` };
  }
  const json = await res.json();
  const text = (json?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: false, reason: `unparseable verify reply: ${text.slice(0, 120)}` };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      pass: parsed.pass === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { pass: false, reason: `verify JSON parse failed: ${text.slice(0, 120)}` };
  }
}

// ── Upload to Supabase Storage; return public URL ──────────────────────────
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

async function uploadImage(code, buf) {
  await ensureBucket();
  const path = `${code}.png`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType: "image/png", upsert: true });
  if (upErr) return { ok: false, reason: `upload failed: ${upErr.message}` };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, reason: "no public url" };
  return { ok: true, publicUrl: data.publicUrl };
}

async function updateAllCodeRows(code, imageUrl) {
  const { error } = await supabase
    .from("mlcc_items")
    .update({
      image_url: imageUrl,
      image_source: "ai_generated",
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code)
    .is("image_url", null); // never overwrite a curated/real image
  if (error) {
    console.warn(`[ai-img] ${code} update failed: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  const perImage = (EST_GEN_COST[QUALITY] ?? 0.04) + (VERIFY ? EST_VERIFY_COST : 0);
  console.log(
    `[ai-img] mode=${SPEND ? "SPEND" : "DRY-RUN ($0)"} limit=${LIMIT} ` +
      `quality=${QUALITY} verify=${VERIFY ? "on" : "OFF"} concurrency=${CONCURRENCY}` +
      (SINGLE_CODE ? ` code=${SINGLE_CODE}` : ""),
  );
  const candidates = await loadCandidates();
  console.log(
    `[ai-img] ${candidates.length} candidate SKU(s) — est. cost ~$${(candidates.length * perImage).toFixed(2)}`,
  );
  if (candidates.length === 0) return;

  if (!SPEND) {
    for (const item of candidates) {
      console.log(`  ${item.code}  "${item.name}" (scans: ${item.scan_count ?? 0})`);
      console.log(`    prompt: ${buildPrompt(item).slice(0, 110)}…`);
    }
    console.log(`[ai-img] dry-run complete. Re-run with --spend to generate.`);
    return;
  }

  const stats = { written: 0, rejected: 0, failed: 0, generated: 0, done: 0 };
  const total = candidates.length;

  /**
   * One SKU end-to-end. Logs a single complete line per item (no
   * interleaved partial writes — required once workers run in parallel).
   */
  async function processItem(item) {
    const tag = `[${++stats.done}/${total}] ${item.code} "${item.name}"`;

    const gen = await generateImage(buildPrompt(item));
    if (!gen.ok) {
      if (gen.error === "rate_limited") {
        console.log(`${tag} — RATE LIMITED, backing off 30s`);
        await sleep(30_000);
        stats.failed += 1;
        return;
      }
      stats.failed += 1;
      console.log(`${tag} — generate failed (${gen.error})`);
      return;
    }
    stats.generated += 1;

    if (VERIFY) {
      const check = await verifyImage(item, gen.buf);
      if (!check.pass) {
        stats.rejected += 1;
        console.log(`${tag} — ✗ verify rejected (${check.reason})`);
        return;
      }
    }

    const hosted = await uploadImage(item.code, gen.buf);
    if (!hosted.ok) {
      stats.failed += 1;
      console.log(`${tag} — ✗ ${hosted.reason}`);
      return;
    }

    const ok = await updateAllCodeRows(item.code, hosted.publicUrl);
    if (ok) {
      stats.written += 1;
      console.log(`${tag} — ✓ ${hosted.publicUrl}`);
    } else {
      console.log(`${tag} — write failed`);
    }
  }

  // Simple worker pool: CONCURRENCY workers pull from a shared queue.
  // Ensure the bucket exists ONCE before workers race on it.
  await ensureBucket();
  const queue = [...candidates];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        await processItem(item);
      } catch (e) {
        stats.failed += 1;
        console.log(`  ${item.code} — worker error: ${e?.message ?? e}`);
      }
      await sleep(250);
    }
  });
  await Promise.all(workers);
  const { written, rejected, failed, generated } = stats;

  console.log(
    `[ai-img] done. written=${written} rejected=${rejected} failed=${failed} ` +
      `generated=${generated} (~$${(generated * perImage).toFixed(2)})`,
  );
  if (rejected > 0) {
    console.log(
      `[ai-img] ${rejected} verify-rejected SKU(s) still have image_url NULL — ` +
        `re-run to retry them, or curate manually via /admin/catalog-images.`,
    );
  }
}

main().catch((e) => {
  console.error("[ai-img] fatal", e);
  process.exit(1);
});
