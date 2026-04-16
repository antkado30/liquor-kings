/**
 * SAFE MODE invariant: MLCC RPA network guards use a single policy module
 * (`mlcc-guards.js`) — the same one `installMlccSafetyNetworkGuards` applies in
 * the browser worker. This file does not duplicate URL rules; it exercises
 * that module and proves blocked “real MLCC-shaped” requests never complete as
 * successful HTTP responses inside a guarded Playwright context.
 *
 * Run (repo root): node --test tests/rpa/safe-mode-invariant.test.js
 *
 * Requires: devDependency `playwright` at repo root (see root package.json).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  installMlccSafetyNetworkGuards,
  shouldBlockHttpRequest,
} from "../../services/api/src/workers/mlcc-guards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

/** Hostnames shaped like production MLCC / MILO (no traffic unless a request incorrectly continues). */
const MLCC_REALISTIC_BASE_URLS = [
  "https://www.lara.michigan.gov",
  "https://mlcc-intent.vendor.example",
];

/**
 * Representative high-risk paths that SAFE MODE must never let complete over the wire.
 * Each pair must remain blocked by `shouldBlockHttpRequest` (same rules as route interception).
 */
const BLOCKED_MUTATION_PATHS = [
  "/milo/order/submit",
  "/milo/order/place",
  "/order/complete",
  "/order/payment",
  "/cart/checkout",
  "/checkout/confirm",
];

test("worker remains explicitly in browser dry-run SAFE MODE (read-only source check)", () => {
  const workerPath = path.join(
    repoRoot,
    "services/api/src/workers/mlcc-browser-worker.js",
  );
  const src = fs.readFileSync(workerPath, "utf8");
  assert.match(
    src,
    /export const MLCC_BROWSER_DRY_RUN_SAFE_MODE = true/,
    "mlcc-browser-worker.js must keep MLCC_BROWSER_DRY_RUN_SAFE_MODE = true",
  );
});

test("shouldBlockHttpRequest blocks every representative MLCC order-risk URL (policy invariant)", () => {
  for (const base of MLCC_REALISTIC_BASE_URLS) {
    for (const p of BLOCKED_MUTATION_PATHS) {
      const url = `${base}${p}`;
      const decision = shouldBlockHttpRequest(url, "POST");
      assert.equal(
        decision.block,
        true,
        `expected POST block for ${url}, got ${JSON.stringify(decision)}`,
      );
    }
  }

  const allow2n = shouldBlockHttpRequest(
    `${MLCC_REALISTIC_BASE_URLS[0]}/order/apply-line`,
    "POST",
  );
  assert.equal(allow2n.block, false, "Phase 2n apply-line POST must stay allowed");

  const allow2q = shouldBlockHttpRequest(
    `${MLCC_REALISTIC_BASE_URLS[0]}/order/validate`,
    "POST",
  );
  assert.equal(allow2q.block, false, "Phase 2q validate POST must stay allowed");
});

test("installMlccSafetyNetworkGuards aborts blocked fetches — zero successful MLCC-shaped order-risk responses", async () => {
  const browser = await chromium.launch({ headless: true });
  const guardStats = { blockedRequestCount: 0 };

  const responsesOnRealisticHosts = [];

  try {
    const context = await browser.newContext();
    await installMlccSafetyNetworkGuards(context, guardStats);

    context.on("response", (res) => {
      const u = res.url();
      if (
        u.includes("lara.michigan.gov") ||
        u.includes("mlcc-intent.vendor.example")
      ) {
        responsesOnRealisticHosts.push({ url: u, status: res.status() });
      }
    });

    const page = await context.newPage();

    const urlsToProbe = [];
    for (const base of MLCC_REALISTIC_BASE_URLS) {
      for (const p of BLOCKED_MUTATION_PATHS) {
        const url = `${base}${p}`;
        assert.equal(
          shouldBlockHttpRequest(url, "POST").block,
          true,
          `precondition: ${url} must be blocked by policy`,
        );
        urlsToProbe.push({ url, method: "POST" });
      }
    }

    const results = await page.evaluate(async (list) => {
      const out = [];
      for (const { url, method } of list) {
        try {
          const res = await fetch(url, {
            method,
            headers: { "content-type": "application/json" },
            body: method === "POST" ? "{}" : undefined,
          });
          out.push({
            url,
            kind: "response",
            ok: res.ok,
            status: res.status,
          });
        } catch (e) {
          out.push({
            url,
            kind: "error",
            name: e instanceof Error ? e.name : "unknown",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return out;
    }, urlsToProbe);

    for (const row of results) {
      assert.notEqual(
        row.kind,
        "response",
        `blocked URL must not produce a fetch response object; got ${JSON.stringify(row)}`,
      );
      assert.equal(row.kind, "error", JSON.stringify(row));
    }

    assert.ok(
      guardStats.blockedRequestCount >= urlsToProbe.length,
      `expected at least ${urlsToProbe.length} guard aborts, got ${guardStats.blockedRequestCount}`,
    );

    assert.equal(
      responsesOnRealisticHosts.length,
      0,
      `zero HTTP responses on MLCC-realistic hosts; saw: ${JSON.stringify(responsesOnRealisticHosts)}`,
    );
  } finally {
    await browser.close();
  }
});
