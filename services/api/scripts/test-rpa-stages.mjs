/**
 * Stage-by-stage RPA test runner.
 *
 * Designed to run from inside the Fly machine (via `flyctl ssh console`) to
 * prove that each RPA stage works against real MILO in the deployed
 * environment. Lower risk than orchestrating a full execution_run because
 * we test stages individually + always stop before Stage 5 (checkout).
 *
 * Usage (from inside the running Fly container):
 *
 *   read -p "Username: " LK_U
 *   read -s -p "Password: " LK_P; echo
 *   read -p "License: " LK_L
 *   MLCC_USERNAME="$LK_U" \
 *   MLCC_PASSWORD="$LK_P" \
 *   MLCC_LICENSE="$LK_L" \
 *   STAGES="1,2" \
 *   node /app/services/api/scripts/test-rpa-stages.mjs
 *   unset LK_U LK_P LK_L
 *
 * STAGES env var controls which stages run, comma-separated:
 *   STAGES=1       — just login
 *   STAGES=1,2     — login + navigate to products (default)
 *   STAGES=1,2,3   — login + navigate + add items (requires MLCC_CODES)
 *   STAGES=1,2,3,4 — login + navigate + add + validate (requires MLCC_CODES)
 *
 * MLCC_CODES — comma-separated MLCC codes to add in Stage 3, e.g. "5246,12184"
 *
 * Stage 5 (checkout/submit) is intentionally never run by this script.
 *
 * Output dir: /tmp/rpa-test/<timestamp>/ — screenshots, HTML snapshots,
 *   video. Download with `flyctl ssh sftp shell` if needed.
 */

import { loginToMilo } from "../src/rpa/stages/login.js";
import { navigateToProducts } from "../src/rpa/stages/navigate-to-products.js";
import { addItemsToCart } from "../src/rpa/stages/add-items-to-cart.js";
import { validateCartOnMilo } from "../src/rpa/stages/validate-cart.js";

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const username = process.env.MLCC_USERNAME?.trim();
const password = process.env.MLCC_PASSWORD?.trim();
const licenseNumber = process.env.MLCC_LICENSE?.trim();
const stagesEnv = (process.env.STAGES ?? "1,2").trim();
const stages = new Set(stagesEnv.split(",").map((s) => s.trim()).filter(Boolean));
const codesEnv = (process.env.MLCC_CODES ?? "").trim();
const codes = codesEnv ? codesEnv.split(",").map((s) => s.trim()).filter(Boolean) : [];

if (!username || !password) {
  console.error("Missing MLCC_USERNAME or MLCC_PASSWORD");
  process.exit(1);
}
if (stages.has("2") && !licenseNumber) {
  console.error("Stage 2 requires MLCC_LICENSE env var");
  process.exit(1);
}
if ((stages.has("3") || stages.has("4")) && codes.length === 0) {
  console.error("Stage 3+ requires MLCC_CODES env var (comma-separated)");
  process.exit(1);
}

const outputDir = `/tmp/rpa-test/${ts()}`;
console.log(`[test] artifacts → ${outputDir}`);
console.log(`[test] running stages: ${[...stages].sort().join(",")}`);

let session = null;
let stage2Result = null;
let stage3Result = null;

// ---- Stage 1: login ----
if (stages.has("1")) {
  console.log("\n[stage 1] logging in...");
  try {
    session = await loginToMilo(
      { username, password },
      {
        headless: true,
        slowMo: 250,
        captureArtifacts: true,
        outputDir: `${outputDir}/stage1`,
        timeoutMs: 90_000,
      },
    );
    console.log(`[stage 1] OK in ${session.durationMs}ms — at ${session.postLoginUrl}`);
  } catch (e) {
    console.error(`[stage 1] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
    process.exit(1);
  }
}

// ---- Stage 2: navigate to products ----
if (stages.has("2")) {
  if (!session) {
    console.error("[stage 2] no session — Stage 1 must run first");
    process.exit(1);
  }
  console.log(`\n[stage 2] navigate to products for license ${licenseNumber}...`);
  try {
    stage2Result = await navigateToProducts(session, {
      licenseNumber,
      captureArtifacts: true,
      outputDir: `${outputDir}/stage2`,
    });
    console.log(`[stage 2] OK in ${stage2Result.stage2DurationMs}ms`);
    console.log(`  current URL: ${stage2Result.currentUrl}`);
    console.log(`  license: ${JSON.stringify(stage2Result.selectedLicense)}`);
    console.log(`  delivery 221: ${stage2Result.deliveryDates?.["221"] ?? "—"}`);
    console.log(`  delivery 321: ${stage2Result.deliveryDates?.["321"] ?? "—"}`);
  } catch (e) {
    console.error(`[stage 2] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
    try {
      await session.browser.close();
    } catch {}
    process.exit(1);
  }
}

// ---- Stage 3: add items to cart ----
if (stages.has("3")) {
  if (!stage2Result) {
    console.error("[stage 3] needs Stage 2 session");
    process.exit(1);
  }
  console.log(`\n[stage 3] adding ${codes.length} items to cart: ${codes.join(", ")}...`);

  // Stage 3 validation requires bottle_size_ml + code (not mlccCode). Look up
  // size_ml for each code from mlcc_items so the test is self-contained and
  // doesn't require the caller to know bottle sizes.
  let items;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars must be set in the container");
    }
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await sb
      .from("mlcc_items")
      .select("code,size_ml")
      .in("code", codes);
    if (error) throw error;
    const sizeByCode = new Map((data ?? []).map((r) => [String(r.code), r.size_ml]));
    const missing = codes.filter((c) => !sizeByCode.has(c) || !sizeByCode.get(c));
    if (missing.length) {
      console.error(`[stage 3] missing size_ml in mlcc_items for codes: ${missing.join(", ")}`);
      console.error("  (the test script requires bottle_size_ml; ensure the catalog has size data for these codes)");
      process.exit(1);
    }
    items = codes.map((code) => ({
      code,
      quantity: 1,
      bottle_size_ml: Number(sizeByCode.get(code)),
    }));
    console.log(`  resolved sizes: ${items.map((i) => `${i.code}=${i.bottle_size_ml}mL`).join(", ")}`);
  } catch (e) {
    console.error(`[stage 3] size lookup FAILED — ${e.message ?? e}`);
    process.exit(1);
  }

  try {
    // Signature: addItemsToCart(session, items, options). skipPreValidation
    // bypasses the ada_number lookup that would otherwise require mlccLookup.
    stage3Result = await addItemsToCart(stage2Result, items, {
      skipPreValidation: true,
      captureArtifacts: true,
      outputDir: `${outputDir}/stage3`,
    });
    console.log(`[stage 3] OK in ${stage3Result.stage3DurationMs ?? "?"}ms`);
    console.log(`  items added: ${stage3Result.addedCount ?? "?"}/${codes.length}`);
    if (stage3Result.failedItems?.length) {
      console.log(`  failed items: ${JSON.stringify(stage3Result.failedItems)}`);
    }
  } catch (e) {
    console.error(`[stage 3] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
    try {
      await session.browser.close();
    } catch {}
    process.exit(1);
  }
}

// ---- Stage 4: validate cart ----
if (stages.has("4")) {
  if (!stage3Result) {
    console.error("[stage 4] needs Stage 3 session");
    process.exit(1);
  }
  console.log(`\n[stage 4] validating cart...`);
  try {
    const stage4Result = await validateCartOnMilo(stage3Result, {
      captureArtifacts: true,
      outputDir: `${outputDir}/stage4`,
    });
    console.log(`[stage 4] OK in ${stage4Result.stage4DurationMs ?? "?"}ms`);
    console.log(`  validated: ${JSON.stringify(stage4Result.validationSummary ?? {})}`);
  } catch (e) {
    console.error(`[stage 4] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
  }
}

// ---- never run stage 5 from this test script ----
console.log(`\n[test] stopping before Stage 5 (checkout) — dry-run by design`);
console.log(`[test] artifacts: ${outputDir}`);

if (session?.browser) {
  try {
    await session.browser.close();
    console.log("[test] browser closed");
  } catch {}
}
