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
 *   STAGES=1,2,3,4,5 — full run incl. checkout (Stage 5 submits ONLY when armed)
 *
 * MLCC_CART — comma-separated code:qty pairs for a REAL order with per-line
 *   quantities, e.g. "2086:6,7746:3,9603:1". Takes precedence over MLCC_CODES.
 * MLCC_CODES — comma-separated MLCC codes to add in Stage 3, e.g. "5246,12184"
 * MLCC_QUANTITY — quantity to apply to every code (default 1; only used with
 *   MLCC_CODES). Use to build a cart that meets MLCC's per-ADA 9L minimum,
 *   e.g. MLCC_QUANTITY=6 with two 750mL codes on the same ADA = 9L exactly.
 *
 * MLCC_SUBMIT — set to "yes" to ARM Stage 5 to actually submit the order.
 *   Stage 5 submits ONLY when STAGES includes 5 AND MLCC_SUBMIT=yes AND the
 *   container env LK_ALLOW_ORDER_SUBMISSION=yes. Any lock missing → Stage 5
 *   runs in dry_run mode (walks to checkout, never clicks submit).
 *
 * Output dir: /tmp/rpa-test/<timestamp>/ — screenshots, HTML snapshots,
 *   video. Download with `flyctl ssh sftp shell` if needed.
 */

import { loginToMilo } from "../src/rpa/stages/login.js";
import { navigateToProducts } from "../src/rpa/stages/navigate-to-products.js";
import { addItemsToCart } from "../src/rpa/stages/add-items-to-cart.js";
import { validateCartOnMilo } from "../src/rpa/stages/validate-cart.js";
import { checkoutOnMilo } from "../src/rpa/stages/checkout.js";

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
const cartEnv = (process.env.MLCC_CART ?? "").trim();
const codesEnv = (process.env.MLCC_CODES ?? "").trim();
// MLCC_QUANTITY applies the same quantity to every code (default 1). Used
// ONLY with MLCC_CODES to build a cart that clears MLCC's per-ADA 9L minimum
// without listing each bottle. Example: MLCC_CODES="100001,100009"
// MLCC_QUANTITY=6 → 6 of each code. Ignored when MLCC_CART is set.
const quantityPerCode = Math.max(1, parseInt(process.env.MLCC_QUANTITY ?? "1", 10) || 1);

// MLCC_CART takes precedence: comma-separated code:qty pairs for a real order
// with per-line quantities (e.g. "2086:6,7746:3"). Falls back to MLCC_CODES.
/** @type {{code: string, quantity: number}[]} */
let cartLines = [];
if (cartEnv) {
  const parseErrors = [];
  cartLines = cartEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [rawCode, rawQty] = pair.split(":").map((x) => (x ?? "").trim());
      const quantity = parseInt(rawQty, 10);
      if (!rawCode || !Number.isInteger(quantity) || quantity <= 0) {
        parseErrors.push(pair);
      }
      return { code: rawCode, quantity };
    });
  if (parseErrors.length) {
    console.error(`MLCC_CART has invalid entries (expected code:qty): ${parseErrors.join(", ")}`);
    process.exit(1);
  }
} else if (codesEnv) {
  cartLines = codesEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code) => ({ code, quantity: quantityPerCode }));
}
const codes = cartLines.map((l) => l.code);

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
let stage4Result = null;

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
    items = cartLines.map(({ code, quantity }) => ({
      code,
      quantity,
      bottle_size_ml: Number(sizeByCode.get(code)),
    }));
    const totalBottles = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalLiters = items.reduce(
      (sum, i) => sum + (i.bottle_size_ml * i.quantity) / 1000,
      0,
    );
    console.log(
      `  resolved sizes: ${items.map((i) => `${i.code}×${i.quantity}=${i.bottle_size_ml}mL`).join(", ")}`,
    );
    console.log(
      `  cart volume: ${totalBottles} bottles, ${totalLiters.toFixed(2)}L total (NOT yet split by ADA; per-ADA 9L check happens at MILO Validate)`,
    );
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
    if (stage3Result.cartClearResult) {
      const c = stage3Result.cartClearResult;
      if (c.cleared) {
        console.log(`  pre-flight cart-clear: removed ${c.itemCountBefore} stale item(s)`);
      } else if (c.skipped) {
        console.log(`  pre-flight cart-clear: skipped (${c.reason})`);
      } else {
        console.log(`  pre-flight cart-clear: cart was already empty`);
      }
    }
    const added = Array.isArray(stage3Result.itemsAdded) ? stage3Result.itemsAdded.length : "?";
    const rejected = Array.isArray(stage3Result.itemsRejected) ? stage3Result.itemsRejected.length : 0;
    console.log(`  items added (verified in cart): ${added}/${codes.length}`);
    if (rejected > 0) {
      console.log(`  items rejected: ${JSON.stringify(stage3Result.itemsRejected)}`);
    }
    if (stage3Result.cartVerification) {
      const cv = stage3Result.cartVerification;
      console.log(
        `  cart verification: reported=${cv.reportedAddedCount}, confirmed=${cv.confirmedInCartCount}, demoted=${cv.demotedCount}`,
      );
      if (cv.activeCart) {
        console.log(`  active cart: ${JSON.stringify(cv.activeCart)}`);
      }
      if (cv.oosSection?.length) {
        console.log(`  OOS section: ${JSON.stringify(cv.oosSection)}`);
      }
      if (cv.clampedItems?.length) {
        console.log(`  quantity-clamped: ${JSON.stringify(cv.clampedItems)}`);
      }
      if (cv.oosItems?.length) {
        console.log(`  items in OOS: ${JSON.stringify(cv.oosItems)}`);
      }
      if (cv.missingItems?.length) {
        console.log(`  items missing from cart: ${JSON.stringify(cv.missingItems)}`);
      }
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
    stage4Result = await validateCartOnMilo(stage3Result, {
      captureArtifacts: true,
      outputDir: `${outputDir}/stage4`,
    });
    console.log(`[stage 4] OK in ${stage4Result.stage4DurationMs ?? "?"}ms`);
    console.log(`  validated: ${stage4Result.validated}`);
    console.log(`  canCheckout: ${stage4Result.canCheckout}`);
    if (stage4Result.outOfStockItems?.length) {
      console.log(`  out-of-stock: ${JSON.stringify(stage4Result.outOfStockItems)}`);
    }
    if (stage4Result.validationMessages?.length) {
      console.log(`  messages: ${JSON.stringify(stage4Result.validationMessages)}`);
    }
    if (stage4Result.orderSummary) {
      console.log(`  orderSummary: ${JSON.stringify(stage4Result.orderSummary)}`);
    }
  } catch (e) {
    console.error(`[stage 4] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
  }
}

// ---- Stage 5: checkout ----
// Triple-locked. Submits ONLY when: STAGES includes 5, MLCC_SUBMIT=yes (this
// script), and LK_ALLOW_ORDER_SUBMISSION=yes (container env, checked inside
// checkoutOnMilo). Any lock missing → checkoutOnMilo runs in dry_run mode:
// it walks to the checkout button but never clicks submit.
if (stages.has("5")) {
  if (!stage4Result) {
    console.error("[stage 5] needs a Stage 4 session — run STAGES with 4 included");
    process.exit(1);
  }
  const submitArmed = (process.env.MLCC_SUBMIT ?? "").trim().toLowerCase() === "yes";
  console.log(
    `\n[stage 5] checkout — ${submitArmed ? "ARMED: will SUBMIT this order" : "dry_run: will NOT submit"}...`,
  );
  try {
    const stage5Result = await checkoutOnMilo(stage4Result, {
      mode: submitArmed ? "submit" : "dry_run",
      allowOrderSubmission: submitArmed,
      captureArtifacts: true,
      outputDir: `${outputDir}/stage5`,
    });
    console.log(`[stage 5] OK in ${stage5Result.stage5DurationMs ?? "?"}ms`);
    console.log(`  mode: ${stage5Result.mode}`);
    console.log(`  submitted: ${stage5Result.submitted}`);
    if (stage5Result.dryRunReason) {
      console.log(`  dry-run reason: ${stage5Result.dryRunReason}`);
    }
    if (stage5Result.confirmationNumbers) {
      console.log(`  CONFIRMATION NUMBERS: ${JSON.stringify(stage5Result.confirmationNumbers)}`);
    }
    if (stage5Result.submittedTimestamp) {
      console.log(`  submitted at: ${stage5Result.submittedTimestamp}`);
    }
    if (stage5Result.confirmationEmail) {
      console.log(`  confirmation email: ${stage5Result.confirmationEmail}`);
    }
    if (stage5Result.successToastMessages?.length) {
      console.log(`  success toasts: ${JSON.stringify(stage5Result.successToastMessages)}`);
    }
    if (stage5Result.errorToastMessages?.length) {
      console.log(`  error toasts: ${JSON.stringify(stage5Result.errorToastMessages)}`);
    }
    // NEW (2026-05-28): when confirmation data was recovered from the
    // /milo/orders history page (either via the thank-you happy path or
    // via the timeout backstop), print per-order detail so the operator
    // sees confirmation #, order #, distributor, totals, status without
    // having to download artifacts.
    if (stage5Result.recoveredFromBackstop) {
      console.log(`  ⚠ recovered via backstop after post-submit wait timed out — submit DID succeed`);
    }
    if (Array.isArray(stage5Result.historyOrders) && stage5Result.historyOrders.length > 0) {
      console.log(`  HISTORY ORDERS (${stage5Result.historyOrders.length}):`);
      for (const o of stage5Result.historyOrders) {
        const parts = [
          o.distributorRaw ? `distributor=${o.distributorRaw}` : null,
          o.confirmationNumber ? `conf#=${o.confirmationNumber}` : null,
          o.orderNumber ? `order#=${o.orderNumber}` : null,
          o.subtotal != null ? `sub=$${o.subtotal}` : null,
          o.total != null ? `tot=$${o.total}` : null,
          o.status ? `status=${o.status}` : null,
          o.deliveryRaw ? `delivery=${o.deliveryRaw}` : null,
        ].filter(Boolean);
        console.log(`    - ${parts.join(" | ")}`);
      }
    }
    // Structured result file — machine-readable record per run. Lives
    // alongside the screenshots/HTML in the run's artifact dir. Lets the
    // operator (or downstream tooling) ingest confirmation data without
    // scraping stdout. Tony asked us to "capture everything" 2026-05-28.
    try {
      const resultJson = {
        ranAt: new Date().toISOString(),
        outputDir,
        license: licenseNumber,
        stage5: {
          mode: stage5Result.mode,
          submitted: stage5Result.submitted,
          stage5DurationMs: stage5Result.stage5DurationMs,
          dryRunReason: stage5Result.dryRunReason ?? null,
          recoveredFromBackstop: Boolean(stage5Result.recoveredFromBackstop),
          recoveredFromHistoryPage: Boolean(stage5Result.recoveredFromHistoryPage),
          confirmationNumbers: stage5Result.confirmationNumbers ?? null,
          submittedTimestamp: stage5Result.submittedTimestamp ?? null,
          confirmationEmail: stage5Result.confirmationEmail ?? null,
          successToastMessages: stage5Result.successToastMessages ?? [],
          errorToastMessages: stage5Result.errorToastMessages ?? [],
          historyOrders: stage5Result.historyOrders ?? [],
          currentUrl: stage5Result.currentUrl,
        },
        stage4Summary: stage4Result?.orderSummary ?? null,
        cartLines,
      };
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${outputDir}/stage5-result.json`, JSON.stringify(resultJson, null, 2), "utf8");
      console.log(`  RESULT JSON: ${outputDir}/stage5-result.json`);
    } catch (jsonErr) {
      console.warn(`  (could not write stage5-result.json: ${jsonErr.message})`);
    }
  } catch (e) {
    console.error(`[stage 5] FAILED — ${e.code ?? "(no code)"}: ${e.message}`);
    if (e.details) console.error("  details:", JSON.stringify(e.details));
    if (e.screenshotPath) console.error("  screenshot:", e.screenshotPath);
    // Even on failure, write a result file with the error so we have a
    // record for debugging without having to download artifacts.
    try {
      const { writeFile } = await import("node:fs/promises");
      const failResult = {
        ranAt: new Date().toISOString(),
        outputDir,
        license: licenseNumber,
        stage5: { failed: true, errorCode: e.code ?? null, errorMessage: e.message, details: e.details ?? null, screenshotPath: e.screenshotPath ?? null },
        cartLines,
      };
      await writeFile(`${outputDir}/stage5-result.json`, JSON.stringify(failResult, null, 2), "utf8");
    } catch {/* best effort */}
  }
} else {
  console.log(`\n[test] Stage 5 not requested — stopped after Stage 4 (dry run by design)`);
}

console.log(`[test] artifacts: ${outputDir}`);

if (session?.browser) {
  try {
    await session.browser.close();
    console.log("[test] browser closed");
  } catch {}
}
