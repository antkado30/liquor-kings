#!/usr/bin/env node
/**
 * probe:milo-node-direct — THE DECISIVE EXPERIMENT (written 2026-07-18)
 *
 * QUESTION
 * --------
 * Every MILO call today runs INSIDE a Playwright page (`page.evaluate` +
 * `fetch(..., credentials:"include")`) because that's how the Cloudflare
 * `cf_clearance` cookie rides along. That browser is why a COLD check costs
 * ~31 seconds of Chromium launch + login form, while the actual MILO work is
 * only ~2.7s.
 *
 * But cf_clearance is just a cookie and the accessToken is just a header.
 * If MILO/Cloudflare accept both from a plain Node client, we can harvest them
 * ONCE with a browser, cache them, and run every subsequent check and submit
 * from Node with NO browser at all:
 *
 *     cold check   34s  ->  ~2.7s   (the MILO floor)
 *     armed submit mins ->  one API call
 *
 * This script answers that question with evidence instead of opinion.
 *
 * SAFETY
 * ------
 * READ-ONLY. It logs in and calls GET /account. It never clears a cart, never
 * adds an item, never validates, never submits. Nothing it does can place an
 * order. Run it any day, including a non-order day.
 *
 * HOW TO RUN (on the worker — it has MILO network access + a stable egress IP,
 * which matters because cf_clearance is usually bound to IP + User-Agent):
 *
 *     fly ssh console -a liquor-kings-worker
 *     cd /app/services/api
 *     MILO_USERNAME=... MILO_PASSWORD=... node scripts/probe-milo-node-direct.mjs
 *
 * WHAT THE RESULT MEANS
 * ---------------------
 *   PHASE 3 status 200  -> Node-direct works. Build the token/clearance cache;
 *                          cold collapses to the MILO floor. This is the win.
 *   PHASE 3 status 403  -> Cloudflare rejected the Node client. Fall back to
 *          (or 503)        pre-warming the browser during user think-time.
 *   PHASE 3 status 401  -> Clearance passed but auth didn't; token handling
 *                          needs work, NOT a Cloudflare wall. Still promising.
 *
 * TTL follow-up: if PHASE 3 passes, re-run ONLY phase 3 (reuse the printed
 * cookie/token) every ~15 min to learn how long the clearance stays valid.
 * That number decides how often a browser refresh is needed.
 */

import process from "node:process";

import { loginToMilo } from "../src/rpa/stages/login.js";
import { apiCall } from "../src/rpa/engine/engine-api.js";

/*
 * Must match API_BASE in src/rpa/engine/engine-api.js. Kept as an env override
 * so this probe never drifts silently from the engine — if it 404s everywhere,
 * check this value first.
 */
const API_BASE = process.env.MILO_API_BASE ?? "";

function redact(s) {
  return String(s ?? "").replace(/[A-Za-z0-9._-]{20,}/g, "<redacted>");
}

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  if (!username || !password) {
    console.error("MILO_USERNAME and MILO_PASSWORD are required (read-only probe).");
    process.exit(2);
  }
  if (!API_BASE) {
    console.error(
      "MILO_API_BASE is empty. Set it to the same value as API_BASE in " +
        "src/rpa/engine/engine-api.js, e.g. MILO_API_BASE=https://... node scripts/probe-milo-node-direct.mjs",
    );
    process.exit(2);
  }

  let session = null;
  let token = null;
  let cfClearance = null;
  let allCookies = "";
  let userAgent = "";

  try {
    // ── PHASE 1: browser login (the expensive thing we want to delete) ──
    const t0 = Date.now();
    console.log("\n[PHASE 1] browser login (this is the ~31s we are trying to kill)…");
    // loginToMilo(credentials, options) — verified against src/rpa/stages/login.js:
    // credentials = {username, password[, loginUrl]}; options carry headless etc.
    // (Was one merged object; worked only because options.headless defaults true.)
    session = await loginToMilo({ username, password }, { headless: true });
    console.log(`[PHASE 1] login complete in ${Date.now() - t0}ms`);

    const page = session.page;
    const context = page.context();

    // ── PHASE 2: harvest the two secrets the browser earned ──
    console.log("\n[PHASE 2] harvesting cf_clearance + accessToken…");
    const r = await apiCall(page, "POST", "/auth/login", {
      body: { username, password },
      label: "POST /auth/login (capture token)",
    });
    if (!r.ok || !r.body?.accessToken) {
      throw new Error(`in-page /auth/login failed (${r.status})`);
    }
    token = r.body.accessToken;

    const cookies = await context.cookies();
    const cf = cookies.find((c) => c.name === "cf_clearance");
    cfClearance = cf?.value ?? null;
    allCookies = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    userAgent = await page.evaluate(() => navigator.userAgent);

    console.log(`  accessToken:   ${token.length} chars (${redact(token)})`);
    console.log(`  cf_clearance:  ${cfClearance ? `present (${cfClearance.length} chars)` : "NOT FOUND"}`);
    console.log(`  cookies total: ${cookies.length}`);
    console.log(`  userAgent:     ${userAgent}`);
    if (!cfClearance) {
      console.log(
        "  NOTE: no cf_clearance cookie. Either Cloudflare isn't challenging this\n" +
          "  route right now, or protection is header/JA3-based. Phase 3 still tells\n" +
          "  us what matters: does a Node client get through?",
      );
    }

    // Close the browser BEFORE phase 3 — proves Node stands on its own.
    await session.browser.close().catch(() => {});
    session = null;
    console.log("  browser CLOSED — phase 3 runs with no browser alive.");

    // ── PHASE 3: the actual question ──
    console.log("\n[PHASE 3] calling MILO from pure Node (no browser)…");
    const t3 = Date.now();
    const res = await fetch(`${API_BASE}/account`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Cookie: allCookies,
        "User-Agent": userAgent,
      },
    });
    const ms = Date.now() - t3;
    const text = await res.text();

    console.log(`  GET /account -> ${res.status} in ${ms}ms`);
    console.log(`  body (first 300): ${redact(text).slice(0, 300)}`);

    console.log("\n──────────── VERDICT ────────────");
    if (res.ok) {
      console.log("✅ NODE-DIRECT WORKS.");
      console.log(`   MILO answered a browserless request in ${ms}ms.`);
      console.log("   → Build the clearance/token cache. Cold check should drop");
      console.log("     from ~34s to roughly the MILO floor (~2.7s), and armed");
      console.log("     submit becomes a single fast API call.");
      console.log("   → NEXT: re-run phase 3 every ~15 min to measure clearance TTL.");
    } else if (res.status === 403 || res.status === 503) {
      console.log("❌ CLOUDFLARE BLOCKED THE NODE CLIENT.");
      console.log("   The browser is load-bearing for the challenge, not just habit.");
      console.log("   → Fall back to PRE-WARM: launch + login during the user's");
      console.log("     think-time (cart open) so the check itself is always warm.");
    } else if (res.status === 401) {
      console.log("⚠️  CLEARANCE OK, AUTH REJECTED.");
      console.log("   Not a Cloudflare wall — a token-handling problem. Still promising:");
      console.log("   check token freshness/format and whether /account needs extra headers.");
    } else {
      console.log(`⚠️  UNEXPECTED ${res.status}. Check MILO_API_BASE matches engine-api.js.`);
    }
    console.log("─────────────────────────────────\n");
  } finally {
    if (session?.browser) await session.browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n[probe] FAILED: ${redact(err?.message ?? err)}`);
  process.exit(1);
});
