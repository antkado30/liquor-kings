/**
 * MILO / OLO read-only discovery: login once, walk typical UI, capture artifacts.
 * SAFE MODE: never submits orders; see BLOCKLIST_RE and clickSafely().
 *
 * Run: node services/api/src/rpa/milo-discovery.js
 * Docs: services/api/src/rpa/README.md
 */

import { appendFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { launchChromium } from "../lib/chromium-launch.js";

/** Buttons / actions that must never be clicked in discovery (case-insensitive). */
export const BLOCKLIST_RE = /checkout|validate|place order|submit|confirm order/i;

/** Same patterns except "place order" — used only with explicit license-nav override. */
const BLOCKLIST_NO_PLACE_ORDER_RE = /checkout|validate|submit|confirm order/i;

const PAGE_LOAD_MS = 30_000;
/** Initial page load / post-goto stabilization (SPA; was 5s, too short for MILO). */
const STABILIZE_MS = 15_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_ROOT = path.resolve(__dirname, "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampDirName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function requireEnv(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

function parseSlowMo() {
  const raw = process.env.MILO_DISCOVERY_SLOWMO;
  const n = raw == null ? 250 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 250;
}

function resolveOutputDir() {
  const custom = process.env.MILO_OUTPUT_DIR;
  if (custom && custom.trim()) {
    return path.isAbsolute(custom.trim()) ? custom.trim() : path.resolve(process.cwd(), custom.trim());
  }
  return path.join(API_ROOT, "rpa-output", timestampDirName());
}

function buildHostnameAllowPredicate(loginUrlStr) {
  const seed = new URL(loginUrlStr);
  const seedHost = seed.hostname.toLowerCase();
  const allowed = new Set([seedHost]);
  if (seedHost.endsWith(".michigan.gov") || seedHost === "michigan.gov") {
    allowed.add("michigan.gov");
  }
  return (hostname) => {
    const h = String(hostname).toLowerCase();
    if (allowed.has(h)) return true;
    if (h.endsWith(`.${seedHost}`)) return true;
    if (h === "michigan.gov" || h.endsWith(".michigan.gov")) return true;
    return false;
  };
}

let isHostnameAllowed = () => true;
let expectedHostsDescription = "";

function assertAllowedUrl(urlStr, label) {
  let hostname;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    throw new Error(`SAFE MODE: invalid URL during ${label}: ${urlStr}`);
  }
  if (!isHostnameAllowed(hostname)) {
    throw new Error(
      `SAFE MODE: unexpected host "${hostname}" during ${label}. Allowed: ${expectedHostsDescription}`,
    );
  }
}

/** @type {import('node:fs').WriteStream | null} */
let networkStream = null;
let warnings = [];

function logWarning(msg) {
  warnings.push(msg);
  console.warn(`[warn] ${msg}`);
}

async function appendActionLine(obj) {
  const line = JSON.stringify(obj) + "\n";
  await appendFile(path.join(outputDirGlobal, "actions.jsonl"), line, "utf8");
}

let outputDirGlobal = "";

/**
 * @param {import('playwright').Page} page
 * @param {string | import('playwright').Locator} locatorOrSelector
 * @param {number} [timeoutMs]
 * @returns {Promise<{ msWaited: number }>}
 */
export async function waitForElementEnabled(page, locatorOrSelector, timeoutMs = 10_000) {
  const start = Date.now();
  const first =
    typeof locatorOrSelector === "string"
      ? page.locator(locatorOrSelector).first()
      : locatorOrSelector.first();
  while (Date.now() - start < timeoutMs) {
    const ok = await first
      .evaluate((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.disabled) return false;
        if (el.hasAttribute("disabled")) return false;
        if (el.getAttribute("aria-disabled") === "true") return false;
        if (el.querySelector(":scope .spinner-border")) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        return true;
      })
      .catch(() => false);
    if (ok) return { msWaited: Date.now() - start };
    await sleep(200);
  }
  const snippet = await first
    .evaluate((el) => (el && "outerHTML" in el ? el.outerHTML.slice(0, 240) : ""))
    .catch(() => "");
  throw new Error(
    `waitForElementEnabled: still disabled, hidden, or showing spinner after ${timeoutMs}ms. Snippet: ${snippet}`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {number} [timeoutMs]
 */
export async function waitForAngularStable(page, timeoutMs = 15_000) {
  await page.waitForFunction(() => document.readyState === "complete", null, { timeout: timeoutMs });
  await sleep(1000);
}

/**
 * Wait for Angular client-side route + key UI to paint.
 * @param {import('playwright').Page} page
 * @param {string} expectedUrlSubstring
 * @param {string | string[]} waitForSelector
 * @param {number} [timeoutMs]
 * @param {string} [stepLabel]
 */
/**
 * After auth, MILO may land on `/milo/home` (navbar “select a license”) or already on `/milo/location`.
 * @param {import('playwright').Page} page
 * @param {number} [timeoutMs]
 */
async function waitForPostLoginShell(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = "";
  while (Date.now() < deadline) {
    lastUrl = page.url();
    assertAllowedUrl(lastUrl, "post-login-shell");
    if (lastUrl.includes("/milo/home")) {
      const vis = await page
        .locator('.navbar__help-text a >> text=/select a license/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (vis) {
        await sleep(500);
        return;
      }
    }
    if (lastUrl.includes("/milo/location")) {
      const vis = await page
        .getByRole("button", { name: /place order/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (vis) {
        await sleep(500);
        return;
      }
    }
    await sleep(200);
  }
  throw new Error(
    `waitForPostLoginShell[post-login]: timed out after ${timeoutMs}ms waiting for /milo/home (navbar “select a license” link) or /milo/location (Place Order visible). Current URL: ${lastUrl}`,
  );
}

export async function waitForSpaNavigation(
  page,
  expectedUrlSubstring,
  waitForSelector,
  timeoutMs = 15_000,
  stepLabel = "spa-nav",
) {
  const deadline = Date.now() + timeoutMs;
  const selectors = Array.isArray(waitForSelector) ? waitForSelector : [waitForSelector];
  let lastUrl = "";
  while (Date.now() < deadline) {
    lastUrl = page.url();
    assertAllowedUrl(lastUrl, stepLabel);
    if (lastUrl.includes(expectedUrlSubstring)) {
      for (const sel of selectors) {
        const vis = await page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false);
        if (vis) {
          await sleep(500);
          return;
        }
      }
    }
    await sleep(200);
  }
  throw new Error(
    `waitForSpaNavigation[${stepLabel}]: timed out after ${timeoutMs}ms waiting for URL to contain "${expectedUrlSubstring}" and one of ${JSON.stringify(
      selectors,
    )} to be visible. Current URL: ${lastUrl}`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 * @param {{ step: string, selectorNote?: string, allowPlaceOrderLicenseNav?: boolean, msWaitedForReady?: number }} opts
 */
export async function clickSafely(page, locator, opts) {
  const first = locator.first();
  const count = await first.count();
  if (count === 0) {
    throw new Error(`SAFE MODE: no element for click (${opts.step})`);
  }
  const text = await first
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const val = ("value" in el && el.value ? String(el.value) : "").trim();
      const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const piece = t || val;
      return piece.slice(0, 500);
    })
    .catch(() => "");
  const tag = (await first.evaluate((el) => el.tagName)).toLowerCase();
  const typeAttr = (await first.getAttribute("type").catch(() => "")) || "";

  const blockedCore = BLOCKLIST_NO_PLACE_ORDER_RE.test(text);
  const blockedPlaceOrder = /place order/i.test(text) && !opts.allowPlaceOrderLicenseNav;
  if (blockedCore || blockedPlaceOrder) {
    throw new Error(`SAFE MODE: refused to click element '[${text || tag}]' (${opts.step})`);
  }
  if (opts.allowPlaceOrderLicenseNav && /place order/i.test(text)) {
    const url = page.url().toLowerCase();
    const bodySnippet = await page
      .evaluate(() => (document.body?.innerText ?? "").slice(0, 4000).toLowerCase())
      .catch(() => "");
    const looksLicense =
      url.includes("license") ||
      bodySnippet.includes("your license") ||
      bodySnippet.includes("select a license") ||
      bodySnippet.includes("place order");
    if (!looksLicense) {
      throw new Error(
        `SAFE_MODE: refused Place Order click — page does not look like license selection (${opts.step})`,
      );
    }
  }

  const elementWasVisible = await first.isVisible().catch(() => false);
  const elementWasEnabled = await first.isEnabled().catch(() => true);
  const urlBefore = page.url();
  await first.click({ timeout: 15_000 });
  await sleep(parseSlowMo());
  const urlAfter = page.url();
  assertAllowedUrl(urlAfter, opts.step);
  await sleep(300);
  const finalUrl = page.url();
  assertAllowedUrl(finalUrl, `${opts.step}-final`);
  await appendActionLine({
    step: opts.step,
    selectorNote: opts.selectorNote ?? null,
    text: text.slice(0, 500),
    tag,
    typeAttr,
    url_before: urlBefore,
    url_after: urlAfter,
    finalUrl,
    elementWasEnabled,
    elementWasVisible,
    msWaitedForReady: opts.msWaitedForReady ?? 0,
    ts: new Date().toISOString(),
  });
}

async function saveUrlFile(baseName, urlStr) {
  await writeFile(path.join(outputDirGlobal, `${baseName}.url.txt`), `${urlStr}\n`, "utf8");
}

async function saveBodyCapture(page, baseName) {
  const bodyInner = await page.evaluate(() => {
    const body = document.body;
    if (!body) return "";
    const clone = body.cloneNode(true);
    clone.querySelectorAll('input[type="password"]').forEach((el) => {
      el.value = "";
      el.setAttribute("value", "");
    });
    return clone.innerHTML;
  });
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title></head><body>` +
    bodyInner +
    `</body></html>`;
  await writeFile(path.join(outputDirGlobal, `${baseName}.html`), html, "utf8");
  await page.screenshot({ path: path.join(outputDirGlobal, `${baseName}.png`), fullPage: true });
  await saveUrlFile(baseName, page.url());
}

async function saveJson(name, data) {
  await writeFile(path.join(outputDirGlobal, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function gotoStable(page, url, stepLabel) {
  assertAllowedUrl(url, `${stepLabel} pre-goto`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_MS });
  await waitForAngularStable(page, STABILIZE_MS);
  assertAllowedUrl(page.url(), `${stepLabel} post-goto`);
}

async function inspectLoginLikeDom(page) {
  return page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((el) => ({
      tag: el.tagName,
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      required: el.required === true,
    }));
    const labels = [...document.querySelectorAll("label")].map((el) => ({
      text: (el.textContent || "").trim().slice(0, 500),
      forId: el.getAttribute("for") || "",
      parentText: (el.parentElement?.textContent || "").trim().slice(0, 200),
    }));
    const buttons = [...document.querySelectorAll("button, input[type='submit'], input[type='button']")].map(
      (el) => ({
        tag: el.tagName,
        text: (el.textContent || el.getAttribute("value") || "").trim().slice(0, 300),
        type: el.getAttribute("type") || "",
        id: el.id || "",
        className: el.className || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      }),
    );
    const anchors = [...document.querySelectorAll("a[href]")].map((el) => ({
      text: (el.textContent || "").trim().slice(0, 300),
      href: el.getAttribute("href") || "",
    }));
    return { inputs, labels, buttons, anchors };
  });
}

async function inspectButtonsAndLinks(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, [role='button']")].map((el) => ({
      tag: el.tagName,
      text: (el.textContent || "").trim().slice(0, 300),
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      ariaLabel: el.getAttribute("aria-label") || "",
    }));
    const anchors = [...document.querySelectorAll("a[href]")].map((el) => ({
      text: (el.textContent || "").trim().slice(0, 300),
      href: el.getAttribute("href") || "",
    }));
    return { buttons, anchors };
  });
}

async function findUsernameLocator(page) {
  const email = page.locator('input[type="email"]').first();
  if ((await email.count()) > 0) return email;
  const byName = page.locator('input[name*="email" i], input[name*="user" i]').first();
  if ((await byName.count()) > 0) return byName;
  const all = page.locator("input[type='text'], input:not([type]), input[type='email']");
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const loc = all.nth(i);
    const aria = ((await loc.getAttribute("aria-label")) || "").toLowerCase();
    const name = ((await loc.getAttribute("name")) || "").toLowerCase();
    const id = ((await loc.getAttribute("id")) || "").toLowerCase();
    const ph = ((await loc.getAttribute("placeholder")) || "").toLowerCase();
    const hay = `${aria} ${name} ${id} ${ph}`;
    if (/(email|user|login)/i.test(hay)) return loc;
  }
  return page.locator("input").first();
}

async function findPasswordLocator(page) {
  return page.locator('input[type="password"]').first();
}

async function findTermsCheckbox(page) {
  const boxes = page.locator("input[type='checkbox']");
  const c = await boxes.count();
  for (let i = 0; i < c; i++) {
    const b = boxes.nth(i);
    const id = await b.getAttribute("id");
    let labelText = "";
    if (id) {
      const lbl = page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if ((await lbl.count()) > 0) labelText = (await lbl.innerText().catch(() => "")) || "";
    }
    const aria = (await b.getAttribute("aria-label")) || "";
    const t = `${labelText} ${aria}`.toLowerCase();
    if (/(read|accept|terms)/i.test(t)) return b;
  }
  return page.locator("input[type='checkbox']").first();
}

async function findLoginSubmitLocator(page) {
  const role = page.getByRole("button", { name: /^(log\s*in|login|sign\s*in)$/i });
  if ((await role.count()) > 0) return role.first();
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if ((await submit.count()) > 0) return submit;
  return page.getByRole("button", { name: /log|sign/i }).first();
}

async function collectLicenseSelectOptions(page) {
  return page.evaluate(() => {
    const sel = document.querySelector("select");
    if (!sel) return null;
    return [...sel.options].map((o) => ({ value: o.value, text: (o.textContent || "").trim() }));
  });
}

async function deepSampleRow(page, rowSelectorHints) {
  return page.evaluate((hints) => {
    let row = null;
    for (const h of hints) {
      row = document.querySelector(h);
      if (row) break;
    }
    if (!row) {
      row =
        document.querySelector("table tbody tr") ||
        document.querySelector("[role='row']") ||
        document.querySelector("li.product, .product-row, [data-product]");
    }
    if (!row) return null;

    function attrs(el) {
      const o = {};
      if (!el.attributes) return o;
      for (const a of el.attributes) o[a.name] = a.value;
      return o;
    }

    function walk(el, depth, maxChildren) {
      if (!el || depth < 0) return null;
      const node = {
        tag: el.tagName,
        attrs: attrs(el),
        text: (el.childNodes?.length === 1 && el.childNodes[0].nodeType === 3
          ? el.textContent
          : ""
        )
          .trim()
          .slice(0, 200),
      };
      if (depth === 0) return node;
      const kids = [...el.children].slice(0, maxChildren);
      node.children = kids.map((k) => walk(k, depth - 1, maxChildren)).filter(Boolean);
      return node;
    }
    return walk(row, 5, 25);
  }, rowSelectorHints);
}

async function summarizeOutputBytes(dir) {
  let total = 0;
  let fileCount = 0;
  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else {
        total += (await stat(p)).size;
        fileCount += 1;
      }
    }
  }
  await walk(dir);
  return { total, fileCount };
}

async function main() {
  console.log("=== MILO discovery (read-only, SAFE MODE) ===");
  const MILO_LOGIN_URL = requireEnv("MILO_LOGIN_URL");
  requireEnv("MILO_USERNAME");
  requireEnv("MILO_PASSWORD");
  const username = process.env.MILO_USERNAME.trim();
  const password = process.env.MILO_PASSWORD;

  outputDirGlobal = resolveOutputDir();
  await mkdir(outputDirGlobal, { recursive: true });
  console.log("Output:", outputDirGlobal);

  const seedUrl = new URL(MILO_LOGIN_URL);
  isHostnameAllowed = buildHostnameAllowPredicate(MILO_LOGIN_URL);
  expectedHostsDescription = `${seedUrl.hostname} (exact), *.${seedUrl.hostname}, michigan.gov, *.michigan.gov`;
  console.log("Allowed hosts:", expectedHostsDescription);

  const headless = process.env.MILO_DISCOVERY_HEADFUL !== "1";
  const slowMo = parseSlowMo();

  const harPath = path.join(outputDirGlobal, "network.har");
  networkStream = createWriteStream(path.join(outputDirGlobal, "network-log.jsonl"), { flags: "a" });

  const browser = await launchChromium({ headless, slowMo });
  const context = await browser.newContext({
    recordHar: { path: harPath, omitContent: false },
    recordVideo: { dir: outputDirGlobal },
  });

  const page = await context.newPage();

  page.on("request", (req) => {
    try {
      const u = req.url();
      if (/password=/i.test(u)) return;
      networkStream.write(
        JSON.stringify({
          type: "request",
          ts: new Date().toISOString(),
          method: req.method(),
          url: u,
          resourceType: req.resourceType(),
        }) + "\n",
      );
    } catch {
      /* ignore */
    }
  });
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (/password=/i.test(u)) return;
      networkStream.write(
        JSON.stringify({
          type: "response",
          ts: new Date().toISOString(),
          status: res.status(),
          url: u,
        }) + "\n",
      );
    } catch {
      /* ignore */
    }
  });

  try {
    // Step 2
    await gotoStable(page, MILO_LOGIN_URL, "01-login-page");
    await saveBodyCapture(page, "01-login-page");

    // Step 3
    const loginInspection = await inspectLoginLikeDom(page);
    await saveJson("01-login-form-inspection.json", loginInspection);

    // Step 4 — fill (password never logged)
    const userLoc = await findUsernameLocator(page);
    const passLoc = await findPasswordLocator(page);
    const termsLoc = await findTermsCheckbox(page);
    await userLoc.fill(username, { timeout: 15_000 });
    await passLoc.fill(password, { timeout: 15_000 });
    await termsLoc.check({ timeout: 10_000 });

    await saveBodyCapture(page, "02-login-filled");

    const loginBtn = await findLoginSubmitLocator(page);
    await clickSafely(page, loginBtn, { step: "04-login-submit", selectorNote: "login button" });
    await waitForPostLoginShell(page, 20_000);

    // Step 5
    await saveBodyCapture(page, "03-dashboard");
    const dashInspect = await inspectButtonsAndLinks(page);
    await saveJson("03-dashboard-elements.json", {
      ...dashInspect,
      selectorNotes: {
        licenseHints: ["Click here to select a license", "Choose License", "license"],
        loginUrlHost: seedUrl.hostname,
      },
    });
    const licOptions = await collectLicenseSelectOptions(page);
    if (licOptions && licOptions.length > 1) {
      await saveJson("03-license-options.json", licOptions);
      logWarning(`Multiple license options (${licOptions.length}); using first available navigation path.`);
    }

    // Step 6 — license selection (Place Order allowed here only)
    const alreadyOnLocation = page.url().includes("/milo/location");
    const licenseLink = page.getByRole("link", { name: /select a license/i }).first();
    const licenseDropdown = page.locator("select").first();
    if (!alreadyOnLocation && (await licenseLink.count()) > 0) {
      await clickSafely(page, licenseLink, { step: "06-license-link", selectorNote: "select a license → /milo/location" });
      await waitForAngularStable(page, 10_000);
      await page.getByRole("button", { name: /place order/i }).first().waitFor({ state: "visible", timeout: 15_000 });
    } else if (alreadyOnLocation) {
      await waitForAngularStable(page, 10_000);
      await page.getByRole("button", { name: /place order/i }).first().waitFor({ state: "visible", timeout: 15_000 });
    } else if ((await licenseDropdown.count()) > 0) {
      const opts = await licenseDropdown.locator("option").count();
      if (opts > 1) logWarning("License <select> has multiple options; choosing index 1 if available.");
      await licenseDropdown.selectOption({ index: 1 }).catch(async () => {
        await licenseDropdown.selectOption({ index: 0 });
      });
      await sleep(slowMo);
      await waitForAngularStable(page, 10_000);
      await page
        .getByRole("button", { name: /place order/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => {});
    }

    const placeOrderButtons = page.getByRole("button", { name: /place order/i });
    const poCount = await placeOrderButtons.count();
    if (poCount > 1) {
      logWarning(`Found ${poCount} "Place Order" buttons; clicking the first (test account assumption).`);
    }
    const poLink = page.getByRole("link", { name: /place order/i }).first();
    const poLinkCount = await poLink.count();
    const placeOrderTarget = poCount > 0 ? placeOrderButtons.first() : poLinkCount > 0 ? poLink : null;
    if (placeOrderTarget) {
      const { msWaited } = await waitForElementEnabled(page, placeOrderTarget, 10_000);
      const stepId = poCount > 0 ? "06-license-place-order" : "06-license-place-order-link";
      const note = poCount > 0 ? "first Place Order on license list" : "Place Order link";
      await clickSafely(page, placeOrderTarget, {
        step: stepId,
        selectorNote: note,
        allowPlaceOrderLicenseNav: true,
        msWaitedForReady: msWaited,
      });
      await waitForSpaNavigation(
        page,
        "/milo/products",
        "input[placeholder*='Search for products' i]",
        20_000,
        "post-license-products",
      );
    } else {
      logWarning('No "Place Order" button/link found; continuing — page may already be past license selection.');
    }
    await saveBodyCapture(page, "04-license-validated");
    assertAllowedUrl(page.url(), "04-after-license");

    // Step 7 — products
    await saveBodyCapture(page, "05-products-page");
    assertAllowedUrl(page.url(), "05-products");
    const navAnchors = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => ({
          text: (a.textContent || "").trim().slice(0, 200),
          href: a.getAttribute("href") || "",
        }))
        .filter((x) =>
          /home|product|order|favorite|code|quick|add by code|cart/i.test(`${x.text} ${x.href}`),
        ),
    );
    await saveJson("05-nav-elements.json", { anchors: navAnchors.slice(0, 200) });

    const productsMeta = await page.evaluate(() => {
      const search =
        document.querySelector("input[type='search'], input[name*='search' i], input[placeholder*='search' i]") ||
        document.querySelector("input[type='text']");
      const banner = [...document.querySelectorAll("*")]
        .filter((el) => /delivery/i.test((el.textContent || "").slice(0, 80)))
        .slice(0, 3)
        .map((el) => ({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 300) }));
      return {
        search: search
          ? { tag: search.tagName, id: search.id, name: search.getAttribute("name"), type: search.getAttribute("type") }
          : null,
        deliveryBannerHints: banner,
      };
    });
    await saveJson("05-products-elements.json", {
      ...productsMeta,
      hints: {
        productRows: "table tbody tr, [role='row'], .product-row",
        addToCart: "button:has-text('Add to Cart'), [aria-label*='cart' i]",
        quantity: "input[type=number], input[type=text][name*='qty' i]",
        cartIcon: "a[href*='cart' i], [aria-label*='cart' i], img[alt*='cart' i]",
      },
    });

    // Step 8 — search read-only
    let searchLoc = page.locator("input[type='search']").first();
    if ((await searchLoc.count()) === 0) {
      const ph = page.getByPlaceholder(/search/i).first();
      if ((await ph.count()) > 0) searchLoc = ph;
      else searchLoc = page.locator("input[type='text']").first();
    }
    await searchLoc.fill("9121", { timeout: 15_000 });
    await page.keyboard.press("Enter").catch(() => {});
    await waitForAngularStable(page, 10_000);
    await page
      .locator("table tbody tr, [role='row'], .search-result tr")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
    await sleep(Math.max(slowMo, 400));
    await saveBodyCapture(page, "06-search-results");
    assertAllowedUrl(page.url(), "06-search");
    const rowSample = await deepSampleRow(page, [
      "table tbody tr",
      "[role='row']",
      ".search-result tr",
      "li",
    ]);
    await saveJson("06-product-row-sample.json", { sample: rowSample });

    // Step 9 — Add By Code (/milo/products/bycode)
    const quickByRole = page.getByRole("link", { name: /add by code/i }).first();
    const quickByHref = page.locator('a[href*="bycode" i]').first();
    const quickLegacy = page.getByRole("link", { name: /add.*code|quick add|by code/i }).first();
    let quickNav = null;
    let quickNote = "";
    if ((await quickByRole.count()) > 0) {
      quickNav = quickByRole;
      quickNote = "Add By Code (nav text)";
    } else if ((await quickByHref.count()) > 0) {
      quickNav = quickByHref;
      quickNote = "Add By Code (href contains bycode)";
    } else if ((await quickLegacy.count()) > 0) {
      quickNav = quickLegacy;
      quickNote = "Add By Code (legacy nav match)";
    }
    if (quickNav) {
      await clickSafely(page, quickNav, { step: "09-quickadd-nav", selectorNote: quickNote });
      await waitForSpaNavigation(
        page,
        "/milo/products/bycode",
        ["input[placeholder*='Search by code' i]", ".liquor-code input"],
        20_000,
        "quickadd-bycode",
      );
    } else {
      const t = page.getByText(/click here to add products by code/i).first();
      if ((await t.count()) > 0) {
        await clickSafely(page, t, { step: "09-quickadd-text-click", selectorNote: "text click" });
        await waitForSpaNavigation(
          page,
          "/milo/products/bycode",
          ["input[placeholder*='Search by code' i]", ".liquor-code input"],
          20_000,
          "quickadd-bycode-text",
        );
      } else logWarning("Add By Code link not found; skipping dedicated by-code page.");
    }
    await saveBodyCapture(page, "07-quickadd-page");
    assertAllowedUrl(page.url(), "07-quickadd");

    const quickMeta = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input")].map((el) => ({
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        id: el.id,
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
      }));
      const buttons = [...document.querySelectorAll("button")].map((el) => ({
        text: (el.textContent || "").trim().slice(0, 200),
        id: el.id,
        type: el.getAttribute("type"),
      }));
      return { inputs, buttons };
    });
    await saveJson("07-quickadd-elements.json", quickMeta);

    // Step 10 — Orders (/milo/account/orders)
    const ordersHref = page.locator('a[href="/milo/account/orders"]').first();
    const ordersNav = page.getByRole("link", { name: /^Orders$/i }).first();
    let ordersClick = null;
    let ordersNote = "";
    if ((await ordersHref.count()) > 0) {
      ordersClick = ordersHref;
      ordersNote = "Orders (exact href)";
    } else if ((await ordersNav.count()) > 0) {
      ordersClick = ordersNav;
      ordersNote = "Orders (nav text)";
    }
    if (ordersClick) {
      await clickSafely(page, ordersClick, { step: "10-orders-tab", selectorNote: ordersNote });
      await waitForSpaNavigation(
        page,
        "/milo/account/orders",
        [
          "text=/ORDER PLACED/i",
          "text=/Order Summary/i",
          'button:has-text("Search")',
          "table",
          ".order-card",
          "[class*='order']",
        ],
        20_000,
        "orders-page",
      );
    } else {
      logWarning("Orders nav link not found (href or main nav).");
    }
    await saveBodyCapture(page, "08-orders-page");
    assertAllowedUrl(page.url(), "08-orders");

    const ordersMeta = await inspectButtonsAndLinks(page);
    await saveJson("08-orders-structure-hints.json", ordersMeta);
    const orderRow = await deepSampleRow(page, ["table tbody tr", "[role='row']", ".order-row", "tr"]);
    await saveJson("08-order-row-sample.json", { sample: orderRow });

    // Step 11 — Cart (/milo/cart)
    const cartCandidates = page
      .locator("a[href='/milo/cart'], a[href=\"/milo/cart\"], [class*='cart-icon'], img[alt*='cart' i]")
      .first();
    if ((await cartCandidates.count()) > 0) {
      await clickSafely(page, cartCandidates, { step: "11-cart-open", selectorNote: "cart icon/link" });
      await waitForSpaNavigation(
        page,
        "/milo/cart",
        ['button:has-text("Validate")', "text=/Cart is empty/i", "text=/Clear Cart/i"],
        20_000,
        "cart-page",
      );
    } else {
      logWarning("Cart icon not found with heuristics.");
    }
    await saveBodyCapture(page, "09-cart-empty");
    assertAllowedUrl(page.url(), "09-cart");

    const cartButtons = await page.evaluate(() =>
      [...document.querySelectorAll("button, a, [role='button']")].map((el) => ({
        text: (el.textContent || "").trim().slice(0, 200),
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        id: el.id || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      })),
    );
    await saveJson("09-cart-elements.json", { controls: cartButtons });

    // Step 12 — Logout (profile dropdown → Sign out); non-fatal if it fails
    try {
      const profileWidget = page.locator("#user-profile, app-user-profile, [class*='user-profile']").first();
      if ((await profileWidget.count()) === 0) {
        throw new Error("user profile widget not found (#user-profile, app-user-profile, [class*='user-profile'])");
      }
      await clickSafely(page, profileWidget, { step: "12a-open-user-menu", selectorNote: "user profile dropdown" });
      await sleep(500);
      const signOut = page.locator("a.dropdown-item").filter({ hasText: /sign\s*out/i }).first();
      await signOut.waitFor({ state: "visible", timeout: 10_000 });
      await clickSafely(page, signOut, { step: "12b-sign-out", selectorNote: "dropdown Sign out" });
      const logoutDeadline = Date.now() + 20_000;
      let onSignIn = false;
      while (Date.now() < logoutDeadline) {
        const u = page.url();
        assertAllowedUrl(u, "12-logout-wait");
        if (u.includes("/auth/sign-in")) {
          onSignIn = true;
          break;
        }
        const loginField = page
          .locator(
            'input[type="email"], input[name*="user" i], input[placeholder*="Username" i], input[placeholder*="email" i]',
          )
          .first();
        if (await loginField.isVisible().catch(() => false)) {
          onSignIn = true;
          break;
        }
        await sleep(200);
      }
      if (!onSignIn) {
        logWarning("Logout navigation did not reach /auth/sign-in or login field within 20s.");
      }
      await saveBodyCapture(page, "10-logout-confirmed");
    } catch (err) {
      await appendActionLine({
        step: "12-logout-failed",
        error: String(err && err.message ? err.message : err),
        url: page.url(),
        ts: new Date().toISOString(),
      });
      logWarning(`Logout failed (non-fatal): ${err && err.message ? err.message : err}`);
    }

    // Step 13
    await context.storageState({ path: path.join(outputDirGlobal, "session-state.json") });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => {
      if (networkStream && !networkStream.destroyed) {
        networkStream.end(() => resolve());
      } else resolve();
    });
  }

  if (warnings.length) await saveJson("discovery-warnings.json", { warnings });

  const { total, fileCount } = await summarizeOutputBytes(outputDirGlobal);
  console.log("=== Discovery complete ===");
  console.log("Artifacts under:", outputDirGlobal);
  console.log(`Wrote ${fileCount} entries (files) in directory; ~${total} bytes total (excluding subdir depth).`);
  if (warnings.length) console.log(`Warnings: ${warnings.length} (see discovery-warnings.json)`);
  console.log("Review session-state.json locally only; do not commit (rpa-output/ is gitignored).");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
