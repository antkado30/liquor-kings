/**
 * _test_engine_api — standalone harness for the live dry-run engine API module
 * (Phase 1b, 2026-06-28). Mirrors _test_r2_replay.js's safety posture.
 *
 * DRY-RUN: logs in via the browser (Cloudflare), then buildAndValidateViaApi
 * builds + prices + validates the cart via MILO's API — NO DOM typing, NO
 * submit/checkout. Creds from the gitignored services/api/.env. Token redacted.
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { loginToMilo } from "../stages/login.js";
import { buildAndValidateViaApi } from "./engine-api.js";

const TEST_CART = [
  { code: "9121", quantity: 12 },
  { code: "11022", quantity: 12 },
];

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing MILO_USERNAME / MILO_PASSWORD in services/api/.env");
  }

  console.log("=== ENGINE API DRY-RUN (build + price + validate, no submit) ===\n");
  console.log("Step 1: browser login (Cloudflare)…");
  const loginStart = Date.now();
  const session = await loginToMilo(
    { username, password },
    { headless: true, slowMo: 0, captureArtifacts: false },
  );
  console.log(`  logged in (${Date.now() - loginStart}ms) — url: ${session.page.url()}\n`);

  console.log("Step 2: build + price + validate via MILO API…");
  let result;
  try {
    result = await buildAndValidateViaApi(session, TEST_CART, { username, password });
  } finally {
    // Close context THEN browser so any recording flushes; never leak a handle.
    if (session?.context) await session.context.close().catch(() => {});
    if (session?.browser) await session.browser.close().catch(() => {});
  }

  console.log("\n=== PARSED RESULT ===");
  console.log(`validated: ${result.validated}`);
  console.log(`canCheckout: ${result.canCheckout}`);
  console.log(`orderSummary: gross=${money(result.orderSummary.grossTotal)} tax=${money(result.orderSummary.liquorTax)} discount=${money(result.orderSummary.discount)} net=${money(result.orderSummary.netTotal)}`);
  console.log(`outOfStockItems: ${result.outOfStockItems.length}`);
  for (const o of result.outOfStockItems) {
    console.log(`  - ${o.code} ${o.name} qty=${o.quantity ?? "?"}${o.needsRecheck ? " (needsRecheck)" : ""}`);
  }
  console.log(`adaOrders: ${result.adaOrders.length}`);
  for (const a of result.adaOrders) {
    console.log(
      `  - ${a.adaName} (${a.adaNumber}): delivery=${a.deliveryDate ?? "n/a"} liters=${a.subtotalLiters} dollars=${money(a.subtotalDollars)} meetsMinimum=${a.meetsMinimum} items=${a.items.length}`,
    );
  }
  console.log(`validationMessages: ${JSON.stringify(result.validationMessages)}`);

  const t = result.engineTimings;
  console.log("\n=== ENGINE TIMINGS ===");
  console.log(`login (in-page /auth/login): ${t.loginMs}ms`);
  console.log(`direct API total: ${t.totalApiMs}ms across ${t.perCallMs.length} calls`);
  for (const c of t.perCallMs) {
    console.log(`  ${c.label}: ${c.status} (${c.ms}ms)${c.ok ? "" : " ⚠️"}`);
  }
  console.log("\nDRY-RUN COMPLETE. No submit/checkout endpoint was called.");
}

main().catch((error) => {
  console.error("Engine API harness failed:", error?.message || String(error));
  process.exit(1);
});
