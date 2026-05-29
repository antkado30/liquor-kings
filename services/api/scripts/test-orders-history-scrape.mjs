/**
 * Stand-alone diagnostic for the /milo/orders history-page scraper.
 *
 * Built 2026-05-28 to de-risk the Stage 5 false-negative fix WITHOUT
 * placing another real MLCC order. Logs in, navigates straight to
 * /milo/orders, runs the same parser Stage 5 will call as its happy-path
 * (thank-you signal) and as its timeout backstop, and prints what it
 * found.
 *
 * Use this any time you suspect MILO's orders-page HTML has changed —
 * cheap signal vs. running a real Stage 5 dry run.
 *
 * Usage from inside the Fly container:
 *
 *   read -p "MLCC Username: " LK_U
 *   read -s -p "MLCC Password: " LK_P; echo
 *   read -p "MLCC License: " LK_L
 *   MLCC_USERNAME="$LK_U" \
 *   MLCC_PASSWORD="$LK_P" \
 *   MLCC_LICENSE="$LK_L" \
 *   node /app/services/api/scripts/test-orders-history-scrape.mjs
 *   unset LK_U LK_P LK_L
 *
 * The license is used only for login (the orders page shows orders for
 * whichever license is in session). NO carts are touched. NO submits
 * happen. This is purely read-only navigation + DOM scrape.
 */
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginToMilo } from "../src/rpa/stages/login.js";
import { navigateToProducts } from "../src/rpa/stages/navigate-to-products.js";
import { navigateToOrdersAndCapture } from "../src/rpa/stages/checkout.js";

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const username = process.env.MLCC_USERNAME?.trim();
const password = process.env.MLCC_PASSWORD?.trim();
const licenseNumber = process.env.MLCC_LICENSE?.trim();

if (!username || !password) {
  console.error("Missing MLCC_USERNAME or MLCC_PASSWORD");
  process.exit(1);
}
if (!licenseNumber) {
  console.error("Missing MLCC_LICENSE");
  process.exit(1);
}

const outputDir = `/tmp/rpa-test/orders-scrape_${ts()}`;
await mkdir(outputDir, { recursive: true });
console.log(`[diagnostic] artifacts → ${outputDir}`);

let session = null;
let exitCode = 0;
try {
  console.log("[diagnostic] logging in...");
  session = await loginToMilo({ username, password, outputDir });
  console.log(`[diagnostic] login OK — at ${session.currentUrl}`);

  console.log(`[diagnostic] navigating to products for license ${licenseNumber}...`);
  // We don't actually need products page to scrape orders, but going
  // through Stage 2 puts the license into session — that's what tells
  // MILO whose orders to render on the history page.
  session = await navigateToProducts(session, { licenseNumber, outputDir });
  console.log(`[diagnostic] license card resolved — at ${session.currentUrl}`);

  console.log("[diagnostic] navigating to /milo/orders + running scraper...");
  // navigateToOrdersAndCapture expects (page, session, outputDir, artifacts).
  // For the diagnostic we pass an empty adaOrders so the scraper returns
  // ALL of today's orders rather than slicing to N.
  const diagnosticSession = { ...session, adaOrders: [] };
  const artifacts = [];
  const result = await navigateToOrdersAndCapture(
    session.page,
    diagnosticSession,
    outputDir,
    artifacts,
  );

  console.log(`[diagnostic] scrape OK`);
  console.log(`  currentUrl: ${result.currentUrl}`);
  console.log(`  historyOrders found: ${result.historyOrders?.length ?? 0}`);
  console.log(`  confirmationNumbers keyed: ${Object.keys(result.confirmationNumbers || {}).join(", ") || "(none)"}`);

  if (Array.isArray(result.historyOrders) && result.historyOrders.length > 0) {
    console.log("");
    console.log("HISTORY ORDERS:");
    for (const o of result.historyOrders) {
      const parts = [
        `distributor=${o.distributorRaw ?? "?"}`,
        `conf#=${o.confirmationNumber ?? "?"}`,
        `order#=${o.orderNumber ?? "?"}`,
        `placed=${o.placedRaw ?? "?"} → ${o.placedDate ?? "?"}`,
        `delivery=${o.deliveryRaw ?? "?"}`,
        `sub=$${o.subtotal ?? "?"}`,
        `tot=$${o.total ?? "?"}`,
        `status=${o.status ?? "?"}`,
        `lines=${o.lineItemCount ?? 0}`,
      ];
      console.log(`  - ${parts.join(" | ")}`);
      if (Array.isArray(o.lineItems) && o.lineItems.length > 0) {
        for (const li of o.lineItems) {
          console.log(
            `      · code=${li.liquorCode} | qty=${li.quantity ?? "?"} | unit=$${li.unitPrice ?? "?"} | sub=$${li.lineSubtotal ?? "?"} | type=${li.orderType ?? "?"} | ${li.productName ?? "?"}`,
          );
        }
      }
    }
  } else {
    console.log("");
    console.log("⚠ No orders parsed. Possible reasons:");
    console.log("  - License has no order history (new account)");
    console.log("  - MILO orders page selectors have changed — parser needs an update");
    console.log("  - Page didn't fully render within budget");
    console.log("  Check the screenshot + HTML artifact in:", outputDir);
  }

  // Write structured diagnostic result
  const diagResult = {
    ranAt: new Date().toISOString(),
    license: licenseNumber,
    outputDir,
    result,
  };
  await writeFile(
    path.join(outputDir, "orders-scrape-result.json"),
    JSON.stringify(diagResult, null, 2),
    "utf8",
  );
  console.log(`\n[diagnostic] result JSON: ${outputDir}/orders-scrape-result.json`);

} catch (error) {
  console.error(`[diagnostic] FAILED — ${error.code ?? "(no code)"}: ${error.message}`);
  if (error.details) console.error("  details:", JSON.stringify(error.details, null, 2));
  if (error.screenshotPath) console.error("  screenshot:", error.screenshotPath);
  exitCode = 1;
} finally {
  if (session?.browser) {
    try {
      await session.browser.close();
      console.log("[diagnostic] browser closed");
    } catch {}
  }
}

process.exit(exitCode);
