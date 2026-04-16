/**
 * DB-free Vitest mirror of repo-root tests/rpa/safe-mode-invariant.test.js policy checks,
 * so `npm run test:ci` (vitest) continuously proves high-risk MLCC-shaped POSTs stay blocked.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { shouldBlockHttpRequest } from "../src/workers/mlcc-guards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "../src/workers/mlcc-browser-worker.js");

const MLCC_REALISTIC_BASE_URLS = [
  "https://www.lara.michigan.gov",
  "https://mlcc-intent.vendor.example",
];

const BLOCKED_MUTATION_PATHS = [
  "/milo/order/submit",
  "/milo/order/place",
  "/order/complete",
  "/order/payment",
  "/cart/checkout",
  "/checkout/confirm",
];

describe("SAFE MODE: no successful real MLCC order-risk POST (policy invariant)", () => {
  it("mlcc-browser-worker keeps MLCC_BROWSER_DRY_RUN_SAFE_MODE = true", () => {
    const src = fs.readFileSync(WORKER, "utf8");
    expect(src).toMatch(/export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true\b/);
  });

  it("shouldBlockHttpRequest blocks every representative order-risk POST on realistic hosts", () => {
    for (const base of MLCC_REALISTIC_BASE_URLS) {
      for (const p of BLOCKED_MUTATION_PATHS) {
        const url = `${base}${p}`;
        const decision = shouldBlockHttpRequest(url, "POST");
        expect(decision.block, url).toBe(true);
      }
    }
  });

  it("keeps Phase 2n apply-line and Phase 2q validate POST allowlisted on the same hosts", () => {
    const base = MLCC_REALISTIC_BASE_URLS[0];
    expect(
      shouldBlockHttpRequest(`${base}/order/apply-line`, "POST").block,
    ).toBe(false);
    expect(shouldBlockHttpRequest(`${base}/order/validate`, "POST").block).toBe(
      false,
    );
  });
});
