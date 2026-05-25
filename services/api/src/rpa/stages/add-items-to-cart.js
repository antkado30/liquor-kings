import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BLOCKLIST_RE, clickSafely, waitForAngularStable, waitForSpaNavigation } from "../milo-discovery.js";
import { validateCart, SPLIT_CASE_RULES_BY_SIZE_ML } from "../../mlcc/milo-ordering-rules.js";

/**
 * A size is "full-case-only" when its split-case rule is an empty array
 * (50ml / 100ml). Pre-validation needs the per-product case size to verify
 * quantities for those sizes — see validateQuantityForSize.
 */
function isFullCaseOnlySize(sizeMl) {
  const rule = SPLIT_CASE_RULES_BY_SIZE_ML[sizeMl];
  return Array.isArray(rule) && rule.length === 0;
}

// 240s overall budget for Stage 3 — same reasoning as the Stage 2 bump
// from 45s → 90s on 2026-05-14. Internal waits on a slow-MILO day can
// stack: cart-clear (~30s w/ populated cart) + navigateBackToProducts
// (up to 20s) + addByCodeNav + waitForSpaNavigation (20s) +
// per-batch typing (~10s per item × batch size) + waitForRowCountIncrease
// (perItemTimeoutMs × items). On 2026-05-17 a Stage 3 run with auto-clear
// hit the previous 120s outer budget on a slow-MILO day, killing the
// run before any specific inner error could surface. 240s lets the
// inner stages either complete or fire their own typed errors.
// Happy-path warm-session Stage 3 still finishes in ~10-20s.
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_PER_ITEM_TIMEOUT_MS = 8_000;
const CART_NAV_TIMEOUT_MS = 15_000;
const ADD_BY_CODE_NAV_TIMEOUT_MS = 20_000;
// Bound for the post-add /milo/cart content read. page.evaluate has NO
// timeout of its own — a stuck cart-page JS context once hung the read for
// the entire 240s Stage 3 budget (observed 2026-05-24).
const CART_READ_TIMEOUT_MS = 25_000;

/**
 * Max items per "Add all to Cart" click. Empirically, MILO silently drops 1-4
 * items per batch when this exceeds ~12 SKUs (root cause likely a server-side
 * batch size cap on the quick-add list). Splitting into smaller batches and
 * clicking "Add all" multiple times produces a near-100% first-pass success rate.
 *
 * Override via options.batchSize.
 */
const DEFAULT_BATCH_SIZE = 10;
const INTER_BATCH_SETTLE_MS = 800;

/**
 * Stage 3 typed errors:
 * - MILO_STAGE3_INVALID_SESSION
 * - MILO_STAGE3_INVALID_ITEMS
 * - MILO_STAGE3_MLCC_LOOKUP_MISSING
 * - MILO_STAGE3_UNKNOWN_CODE
 * - MILO_STAGE3_PRE_VALIDATION_FAILED
 * - MILO_STAGE3_ADD_BY_CODE_NAV_FAILED
 * - MILO_STAGE3_CODE_INPUT_NOT_FOUND
 * - MILO_STAGE3_QTY_INPUT_NOT_FOUND
 * - MILO_STAGE3_ITEM_NOT_ACCEPTED
 * - MILO_STAGE3_ADD_ALL_BUTTON_DISABLED
 * - MILO_STAGE3_ADD_ALL_FAILED
 * - MILO_STAGE3_CART_NAV_TIMEOUT
 * - MILO_STAGE3_CART_VERIFICATION_EMPTY
 * - MILO_STAGE3_CART_VERIFICATION_TIMEOUT
 * - MILO_STAGE3_ITEMS_OUT_OF_STOCK
 * - MILO_STAGE3_QUANTITY_CLAMPED
 * - MILO_STAGE3_CART_CLEAR_FAILED
 * - MILO_STAGE3_TIMEOUT
 */
function createStage3Error(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
}

/**
 * Race a promise against a timeout, rejecting with a typed Stage 3 error.
 * Used to bound page.evaluate (which has no timeout of its own) so a stuck
 * cart-page JS context cannot silently consume the whole Stage 3 budget.
 */
function raceStage3Timeout(promise, timeoutMs, code, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(createStage3Error(code, message, { timeoutMs })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function assertMichiganGov(urlValue) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw createStage3Error("MILO_STAGE3_INVALID_SESSION", "Session URL is invalid", { currentUrl: urlValue });
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "michigan.gov" && !host.endsWith(".michigan.gov")) {
    throw createStage3Error("MILO_STAGE3_INVALID_SESSION", "Session is not on michigan.gov", {
      currentUrl: urlValue,
      hostname: host,
    });
  }
}

function validateStage3Session(session) {
  if (!session?.browser || !session?.context || !session?.page) {
    throw createStage3Error("MILO_STAGE3_INVALID_SESSION", "Session is missing required Playwright handles", {
      requiredFields: ["browser", "context", "page"],
      presentFields: session ? Object.keys(session) : [],
    });
  }
  const currentUrl = session.currentUrl || session.page.url();
  if (!String(currentUrl).includes("/milo/products")) {
    throw createStage3Error("MILO_STAGE3_INVALID_SESSION", "Stage 3 must start on /milo/products", {
      currentUrl,
    });
  }
  assertMichiganGov(currentUrl);
  if (!session.selectedLicense || !session.deliveryDates) {
    throw createStage3Error("MILO_STAGE3_INVALID_SESSION", "Stage 3 expects a Stage 2 enriched session handle", {
      hasSelectedLicense: Boolean(session.selectedLicense),
      hasDeliveryDates: Boolean(session.deliveryDates),
    });
  }
}

async function validateItemsInput(items, { skipPreValidation = false, mlccLookup } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createStage3Error("MILO_STAGE3_INVALID_ITEMS", "items must be a non-empty array", {
      itemsType: typeof items,
      itemCount: Array.isArray(items) ? items.length : 0,
    });
  }

  const issues = [];
  items.forEach((item, idx) => {
    const code = typeof item?.code === "string" ? item.code.trim() : "";
    const qty = Number(item?.quantity);
    const size = Number(item?.bottle_size_ml);
    if (!code) issues.push({ index: idx, field: "code", reason: "required non-empty string" });
    if (!Number.isInteger(qty) || qty <= 0) issues.push({ index: idx, field: "quantity", reason: "required positive integer" });
    if (!Number.isFinite(size) || size <= 0) issues.push({ index: idx, field: "bottle_size_ml", reason: "required positive number" });
  });

  if (issues.length) {
    throw createStage3Error("MILO_STAGE3_INVALID_ITEMS", "One or more items are invalid", { issues });
  }

  const normalized = items.map((item) => {
    const cs = Number(item.case_size);
    return {
      code: String(item.code).trim(),
      quantity: Number(item.quantity),
      bottle_size_ml: Number(item.bottle_size_ml),
      // case_size is only needed to validate full-case-only sizes (50/100ml);
      // carried through when a caller supplies it, otherwise filled by lookup.
      case_size: Number.isInteger(cs) && cs > 0 ? cs : undefined,
      ada_number:
        typeof item.ada_number === "string" && item.ada_number.trim() !== "" ? item.ada_number.trim() : undefined,
      expected_name: item.expected_name ? String(item.expected_name).trim() : "",
    };
  });

  if (!skipPreValidation) {
    // Pre-validation needs ada_number (per-ADA 9L check) for every item, and
    // case_size for full-case-only sizes (50/100ml). Hit the MLCC lookup when
    // a caller has not already supplied what we need — a 750ml-only cart with
    // ada_numbers given still needs no lookup (no behavior change there).
    const needsLookup = normalized.some(
      (item) =>
        !item.ada_number ||
        (isFullCaseOnlySize(item.bottle_size_ml) && item.case_size == null),
    );
    if (needsLookup) {
      if (typeof mlccLookup !== "function") {
        throw createStage3Error(
          "MILO_STAGE3_MLCC_LOOKUP_MISSING",
          "mlccLookup function required for pre-validation. Pass options.mlccLookup or set skipPreValidation=true.",
          { missingAdaCodes: normalized.filter((x) => !x.ada_number).map((x) => x.code) },
        );
      }
      const uniqueCodes = [...new Set(normalized.map((x) => x.code))];
      const lookup = (await mlccLookup(uniqueCodes)) || {};
      const missingCodes = uniqueCodes.filter((code) => !lookup[code] || !lookup[code].ada_number);
      if (missingCodes.length > 0) {
        throw createStage3Error("MILO_STAGE3_UNKNOWN_CODE", "One or more item codes are missing from MLCC lookup", {
          missingCodes,
        });
      }
      for (const item of normalized) {
        if (!item.ada_number) {
          item.ada_number = String(lookup[item.code].ada_number);
        }
        if (item.case_size == null) {
          const cs = Number(lookup[item.code].case_size);
          if (Number.isInteger(cs) && cs > 0) item.case_size = cs;
        }
      }
    }
  }

  return normalized;
}

function withOverallTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createStage3Error("MILO_STAGE3_TIMEOUT", `Stage 3 exceeded timeout budget of ${timeoutMs}ms`, { timeoutMs }));
    }, timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Best-effort: artifact capture must NEVER fail a stage. Any error here is
// swallowed so a screenshot failure can't sink an otherwise-good add-to-cart.
async function captureArtifact(page, outputDir, artifacts, baseName) {
  if (!outputDir) return;
  try {
    const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
    const htmlPath = path.join(outputDir, `${baseName}.html`);
    const pngPath = path.join(outputDir, `${baseName}.png`);
    const urlPath = path.join(outputDir, `${baseName}.url.txt`);
    await writeFile(htmlPath, html, "utf8");
    await page.screenshot({ path: pngPath, fullPage: true });
    await writeFile(urlPath, `${page.url()}\n`, "utf8");
    artifacts.push(htmlPath, pngPath, urlPath);
  } catch {
    /* best-effort — never fail a stage over artifact capture */
  }
}

async function captureFailure(page, outputDir, artifacts, baseName) {
  if (!page || !outputDir) return null;
  const screenshotPath = path.join(outputDir, `${baseName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  artifacts.push(screenshotPath);
  return screenshotPath;
}

async function collectQuickAddRows(page) {
  return page.evaluate(() => {
    const removeButtons = [...document.querySelectorAll("button, a, [role='button']")].filter((el) =>
      /remove/i.test((el.textContent || "").trim()),
    );
    const rows = new Map();

    for (const btn of removeButtons) {
      let row = null;
      let el = btn;
      for (let i = 0; i < 5 && el; i += 1) {
        const className = typeof el.className === "string" ? el.className : "";
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (/row|card|item/i.test(className) || /^\s*#\d{3,}/.test(text)) {
          row = el;
          break;
        }
        el = el.parentElement;
      }
      if (!row) continue;
      if (rows.has(row)) continue;

      const text = (row.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const codeMatch = text.match(/#\s*(\d{3,})/);
      const code = codeMatch ? codeMatch[1] : "";
      const nameMatch = text.match(/#\s*\d{3,}\s+(.+?)\s+\d+\s*ml\s*bottle/i);
      const nameGuess = nameMatch
        ? nameMatch[1].trim()
        : text
            .replace(/#\s*\d{3,}/, "")
            .replace(/\/\s*#\d+\s*-\s*[^/]+/i, "")
            .replace(/qty.*$/i, "")
            .replace(/\b\d+\s*ml\b/i, "")
            .replace(/remove/i, "")
            .replace(/\s+/g, " ")
            .trim();
      rows.set(row, { text, code, nameGuess });
    }
    return [...rows.values()];
  });
}

async function findVisibleFirst(page, selectors) {
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;
      return { locator: candidate, selector };
    }
  }
  return { locator: null, selector: null };
}

async function findCodeAndQtyInputs(page) {
  const codeCandidates = [
    "input#liquorcode-search-input",
    "input[placeholder*='Search by code' i]",
    ".liquor-code input",
    "label:has-text('Liquor code') + input",
  ];
  const qtyCandidates = [
    "input#quantity",
    "input[placeholder='0']",
    "label:has-text('Quantity') + input",
    "input[type='number']:not(#liquorcode-search-input)",
  ];

  const code = await findVisibleFirst(page, codeCandidates);
  const qty = await findVisibleFirst(page, qtyCandidates);

  return {
    codeInput: code.locator,
    codeSelector: code.selector,
    qtyInput: qty.locator,
    qtySelector: qty.selector,
  };
}

async function waitForRowCountIncrease(page, startCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await collectQuickAddRows(page);
    if (rows.length > startCount) {
      return { ok: true, rows, waitedMs: Date.now() - started };
    }
    await page.waitForTimeout(200);
  }
  return { ok: false, rows: await collectQuickAddRows(page), waitedMs: Date.now() - started };
}

async function inlineItemErrorHint(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    const m = text.match(/(code not found|discontinued|invalid|not found|unable to add)/i);
    return m ? m[0] : "";
  });
}

async function readAddAllPostClickState(page, codeInput, qtyInput) {
  const codeValue = await codeInput.inputValue().catch(() => "");
  const qtyValue = await qtyInput.inputValue().catch(() => "");
  const diagnostics = await page.evaluate(() => {
    const cartCandidates = [
      ...document.querySelectorAll(
        "a[href*='/milo/cart'], [class*='cart'], [aria-label*='cart' i], [id*='cart' i], [class*='badge' i]",
      ),
    ];
    const cartBadgeText = cartCandidates
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .find((text) => /(^\d+\+?$)|\bcart\b.*\d+/i.test(text)) || "";

    const alertCandidates = [...document.querySelectorAll("[role='alert'], .toast, .alert, .notification, [class*='toast']")]
      .map((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          parseFloat(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0;
        return { text: (el.textContent || "").replace(/\s+/g, " ").trim(), visible };
      })
      .filter((x) => x.visible && x.text);

    const toastMatch = alertCandidates.find((x) => /added to cart|successfully added/i.test(x.text));
    return {
      cartBadgeText,
      visibleAlerts: alertCandidates.map((x) => x.text).slice(0, 8),
      toastMatched: Boolean(toastMatch),
    };
  });

  const formCleared = codeValue.trim() === "" && (qtyValue.trim() === "" || qtyValue.trim() === "0");
  const cartBadgeUpdated = /(^\d+\+?$)|\d+/.test(diagnostics.cartBadgeText);
  const toastVisible = diagnostics.toastMatched;

  return {
    formCleared,
    cartBadgeUpdated,
    toastVisible,
    codeValue,
    qtyValue,
    cartBadgeText: diagnostics.cartBadgeText,
    visibleAlerts: diagnostics.visibleAlerts,
  };
}

async function waitForAddAllConfirmation(page, codeInput, qtyInput, timeoutMs = 10_000) {
  const start = Date.now();
  let lastState = null;
  while (Date.now() - start < timeoutMs) {
    lastState = await readAddAllPostClickState(page, codeInput, qtyInput);
    if (lastState.formCleared || lastState.cartBadgeUpdated || lastState.toastVisible) {
      return { ok: true, waitedMs: Date.now() - start, state: lastState };
    }
    await page.waitForTimeout(300);
  }
  return { ok: false, waitedMs: Date.now() - start, state: lastState };
}

/**
 * Pre-flight: navigate to /milo/cart and clear any existing items so
 * Stage 3 starts from a known-empty state. Prevents accumulation when:
 *   - A prior RPA run failed mid-way and left stale items in cart
 *   - The same RPA test runs twice in quick succession
 *   - A customer-side scanner-submit retry fires before the prior cart
 *     state was wiped
 *
 * Best-effort: if any step fails (cart link not visible, Clear Cart
 * button missing, modal unhandled), this function logs a warning and
 * returns without throwing. The v2 cart-verification check downstream
 * is still the authoritative guard against unexpected cart state.
 *
 * If Clear Cart IS clicked but the cart doesn't actually empty within
 * 15s, MILO_STAGE3_CART_CLEAR_FAILED IS thrown — that's a real failure
 * mode we want surfaced (MILO may have errored, item may be locked).
 *
 * Returns:
 *   { skipped: true, reason }      — couldn't navigate / find cart link
 *   { cleared: false, itemCountBefore: 0 } — cart already empty
 *   { cleared: true, itemCountBefore: N }  — N items removed
 */
async function clearCartIfPopulated(page, outputDir, stage3Artifacts) {
  // Step 1: locate cart link from current page (typically /milo/products)
  const cartNav = await (async () => {
    const direct = await findVisibleFirst(page, ["a[href='/milo/cart']"]);
    if (direct.locator) return direct;
    const classed = await findVisibleFirst(page, [
      "a[href*='cart'][class*='cart']",
      "a[href*='/milo/cart']",
    ]);
    if (classed.locator) return classed;
    const iconish = await findVisibleFirst(page, [
      "[class*='cart'] a",
      "a[class*='cart']",
      "[aria-label*='cart' i]",
    ]);
    if (iconish.locator) return iconish;
    const byRole = page.getByRole("link", { name: /cart/i }).first();
    if (
      (await byRole.count()) > 0 &&
      (await byRole.isVisible().catch(() => false))
    ) {
      return { locator: byRole, selector: "role=link[name=cart]" };
    }
    return { locator: null, selector: null };
  })();

  if (!cartNav.locator) {
    console.log(
      `[stage3] pre-flight cart-clear: skipped (cart link not visible from ${page.url()})`,
    );
    return { skipped: true, reason: "cart-link-not-visible" };
  }

  await clickSafely(page, cartNav.locator, {
    step: "3pre-nav-to-cart-for-clear",
    selectorNote: cartNav.selector || "header cart link",
  });

  try {
    await waitForSpaNavigation(
      page,
      "/milo/cart",
      [
        "button:has-text('Validate')",
        "button:has-text('Clear Cart')",
        "text=/Cart is empty/i",
        "text=/Your cart/i",
        "text=/Continue Shopping/i",
      ],
      15_000,
      "stage3-pre-clear-cart-nav",
    );
  } catch (e) {
    console.warn(
      `[stage3] pre-flight cart-clear: skipped (cart nav timeout: ${String(e?.message || e)})`,
    );
    return { skipped: true, reason: "cart-nav-timeout" };
  }

  await waitForAngularStable(page, 5_000).catch(async () => {
    await page.waitForTimeout(500);
  });

  // Step 2: count existing rows (active + OOS)
  // Count ONLY rows that contain a product code (td > span.text-muted with
  // digits). Excludes the Order Summary panel which also uses
  // table.table-bordered but has Gross/Tax/Discount/Net rows that should
  // NOT be counted as cart items.
  const itemCountBefore = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll("table.table-bordered tbody tr"),
    ];
    return rows.filter((row) => {
      const codeEl = row.querySelector("td span.text-muted");
      const text = (codeEl?.textContent || "").trim();
      return /^\d+$/.test(text);
    }).length;
  });

  if (itemCountBefore === 0) {
    // Already empty — return to products page so the rest of Stage 3 picks up.
    console.log(`[stage3] pre-flight cart-clear: cart already empty.`);
    await navigateBackToProducts(page);
    return { cleared: false, itemCountBefore: 0 };
  }

  // Step 3: find Clear Cart button + click
  const clearButton = page
    .getByRole("button", { name: /^Clear Cart$/i })
    .first();
  if (
    (await clearButton.count()) === 0 ||
    !(await clearButton.isVisible().catch(() => false))
  ) {
    console.warn(
      `[stage3] pre-flight cart-clear: ${itemCountBefore} item(s) in cart but Clear Cart button not visible. Proceeding anyway; v2 verifier will catch accumulation.`,
    );
    await navigateBackToProducts(page);
    return { skipped: true, reason: "clear-button-not-visible", itemCountBefore };
  }

  await captureArtifact(page, outputDir, stage3Artifacts, "0pre-cart-before-auto-clear");

  await clickSafely(page, clearButton, {
    step: "3pre-click-clear-cart",
    selectorNote: "Clear Cart button",
  });

  // Step 4: handle confirmation modal if it appears (MILO sometimes
  // shows "Are you sure?" — best-effort: click any visible Yes/Confirm/OK).
  await page.waitForTimeout(750);
  const confirmButton = page
    .getByRole("button", { name: /^(Yes|Confirm|Clear|OK|Continue)$/i })
    .first();
  if (
    (await confirmButton.count()) > 0 &&
    (await confirmButton.isVisible().catch(() => false))
  ) {
    await clickSafely(page, confirmButton, {
      step: "3pre-confirm-clear",
      selectorNote: "Clear Cart confirmation",
    }).catch(() => {});
  }

  // Step 5: wait for cart to actually empty (15s budget)
  const clearWaitStart = Date.now();
  let emptied = false;
  while (Date.now() - clearWaitStart < 15_000) {
    const remaining = await page.evaluate(() => {
      return document.querySelectorAll(
        "table.table-bordered tbody tr",
      ).length;
    });
    if (remaining === 0) {
      emptied = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!emptied) {
    const screenshotPath = await captureFailure(
      page,
      outputDir,
      stage3Artifacts,
      "error-cart-clear-failed",
    );
    throw createStage3Error(
      "MILO_STAGE3_CART_CLEAR_FAILED",
      `Clear Cart was clicked on a cart with ${itemCountBefore} item(s) but the cart did not empty within 15s`,
      { itemCountBefore, currentUrl: page.url() },
      screenshotPath,
    );
  }

  await captureArtifact(page, outputDir, stage3Artifacts, "0pre-cart-after-auto-clear");
  console.log(
    `[stage3] pre-flight cart-clear: removed ${itemCountBefore} stale item row(s).`,
  );

  await navigateBackToProducts(page);
  return { cleared: true, itemCountBefore };
}

/**
 * Return to /milo/products from /milo/cart using MILO's own "Continue
 * Shopping" navigation (falls back to direct page.goto if button not
 * found). Used by clearCartIfPopulated so the rest of Stage 3 picks up
 * at the expected URL.
 */
async function navigateBackToProducts(page) {
  const continueButton = page
    .getByRole("button", { name: /^Continue Shopping$/i })
    .first();
  const continueLink = page
    .getByRole("link", { name: /^Continue Shopping$/i })
    .first();
  const tryClick = async (locator) => {
    if (
      (await locator.count()) > 0 &&
      (await locator.isVisible().catch(() => false))
    ) {
      await locator.click({ timeout: 5_000 }).catch(() => {});
      return true;
    }
    return false;
  };
  if (await tryClick(continueButton)) {
    /* clicked */
  } else if (await tryClick(continueLink)) {
    /* clicked */
  } else {
    // Fallback: direct nav
    try {
      const productsUrl = new URL("/milo/products", page.url()).toString();
      await page.goto(productsUrl, { waitUntil: "domcontentloaded" });
    } catch {
      /* best-effort */
    }
  }

  // Wait for the products page to actually be interactive — not just the
  // URL changed. Without this, Stage 3's subsequent click on "Add by Code"
  // can race against a not-yet-bound Angular controller, leading to
  // MILO_STAGE3_ITEM_NOT_ACCEPTED downstream. Observed 2026-05-17:
  // post-clear navigation completed but the add-by-code form wasn't
  // responsive for 8+ seconds. We wait explicitly for either:
  //   - product search input visible (means /milo/products is bound)
  //   - "Add by Code" link visible (means we can proceed)
  // Whichever lands first. 20s ceiling.
  await waitForAngularStable(page, 5_000).catch(async () => {
    await page.waitForTimeout(500);
  });

  const waitStart = Date.now();
  while (Date.now() - waitStart < 20_000) {
    const url = page.url();
    if (url.includes("/milo/products")) {
      const searchVisible = await page
        .locator("input[placeholder*='Search for products' i]")
        .first()
        .isVisible()
        .catch(() => false);
      const addByCodeVisible = await page
        .getByRole("link", { name: /add by code/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (searchVisible || addByCodeVisible) {
        // Page is interactive. One more angular settle for safety.
        await waitForAngularStable(page, 3_000).catch(() => {});
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  // Couldn't confirm interactive state within 20s — log but continue.
  // Stage 3's existing addByCodeNav resolution will surface the real
  // error if the page is genuinely broken.
  console.warn(
    `[stage3] navigateBackToProducts: did not confirm interactive products page within 20s (current url: ${page.url()}); continuing best-effort`,
  );
}

export async function addItemsToCart(session, items, options = {}) {
  validateStage3Session(session);
  const skipPreValidation = options.skipPreValidation === true;
  const mlccLookup = options.mlccLookup;
  const normalizedItems = await validateItemsInput(items, { skipPreValidation, mlccLookup });
  const failOnRejected = options.failOnRejected === true;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const perItemTimeoutMs = Number.isFinite(options.perItemTimeoutMs) ? Number(options.perItemTimeoutMs) : DEFAULT_PER_ITEM_TIMEOUT_MS;
  const captureArtifacts = options.captureArtifacts ?? true;

  if (!skipPreValidation) {
    const validation = validateCart(normalizedItems);
    if (!validation.valid) {
      throw createStage3Error("MILO_STAGE3_PRE_VALIDATION_FAILED", "MLCC validation failed before typing items", {
        errors: validation.errors,
        adaBreakdown: validation.adaBreakdown,
      });
    }
  }

  const stage3StartedAtDate = new Date();
  const stage3StartedAt = stage3StartedAtDate.toISOString();
  const stage3Artifacts = [];
  const outputDir =
    captureArtifacts === true
      ? options.outputDir
        ? path.isAbsolute(options.outputDir)
          ? options.outputDir
          : path.resolve(process.cwd(), options.outputDir)
        : session.outputDir
          ? path.join(session.outputDir, "stage3")
          : null
      : null;

  const skipCartClear = options.skipCartClear === true;
  const run = async () => {
    const page = session.page;
    if (outputDir) await mkdir(outputDir, { recursive: true });

    let cartClearResult = null;

    try {
      // Pre-flight: clear any existing cart state before adding new items.
      // Eliminates the entire class of "stale cart pollution" bugs we hit
      // repeatedly during 2026-05-17 testing. Best-effort — if clear can't
      // be performed (button missing, etc.) we log and continue; the v2
      // cart-state verification downstream will still catch unexpected
      // contents. The only hard failure is MILO_STAGE3_CART_CLEAR_FAILED
      // which fires when Clear Cart WAS clicked but cart didn't empty.
      if (!skipCartClear) {
        cartClearResult = await clearCartIfPopulated(
          page,
          outputDir,
          stage3Artifacts,
        );
      } else {
        console.log("[stage3] pre-flight cart-clear: skipped (skipCartClear=true)");
      }

      const addByCodeNav = await (async () => {
        const direct = await findVisibleFirst(page, ["a[href*='/milo/products/bycode']"]);
        if (direct.locator) return direct;
        const byRole = page.getByRole("link", { name: /add by code/i }).first();
        if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
          return { locator: byRole, selector: "role=link[name=Add By Code]" };
        }
        const gridLink = page.getByRole("link", { name: /go to add products by code/i }).first();
        if ((await gridLink.count()) > 0 && (await gridLink.isVisible().catch(() => false))) {
          return { locator: gridLink, selector: "role=link[name=Go to add products by code]" };
        }
        return { locator: null, selector: null };
      })();

      if (!addByCodeNav.locator) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-addbycode-link-missing");
        throw createStage3Error(
          "MILO_STAGE3_ADD_BY_CODE_NAV_FAILED",
          "Could not find a visible Add By Code link from /milo/products",
          {
            currentUrl: page.url(),
            selectorsTried: [
              "a[href*='/milo/products/bycode']",
              "role link Add By Code",
              "role link Go to add products by code",
            ],
          },
          screenshotPath,
        );
      }

      await clickSafely(page, addByCodeNav.locator, {
        step: "3a-to-addbycode",
        selectorNote: addByCodeNav.selector || "Add By Code navigation",
      });

      try {
        await waitForSpaNavigation(
          page,
          "/milo/products/bycode",
          ["input[placeholder*='Search by code' i]", ".liquor-code input"],
          ADD_BY_CODE_NAV_TIMEOUT_MS,
          "stage3-to-bycode",
        );
      } catch (error) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-addbycode-nav-timeout");
        throw createStage3Error(
          "MILO_STAGE3_ADD_BY_CODE_NAV_FAILED",
          "Timed out navigating to /milo/products/bycode",
          { currentUrl: page.url(), reason: String(error?.message || error) },
          screenshotPath,
        );
      }

      await waitForAngularStable(page, 10_000).catch(async () => {
        await page.waitForTimeout(500);
      });
      await captureArtifact(page, outputDir, stage3Artifacts, "01-addbycode-page");

      const { codeInput, codeSelector, qtyInput, qtySelector } = await findCodeAndQtyInputs(page);
      if (!codeInput) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-code-input-missing");
        throw createStage3Error(
          "MILO_STAGE3_CODE_INPUT_NOT_FOUND",
          "Could not find code input on Add By Code page",
          { currentUrl: page.url() },
          screenshotPath,
        );
      }
      if (!qtyInput) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-qty-input-missing");
        throw createStage3Error(
          "MILO_STAGE3_QTY_INPUT_NOT_FOUND",
          "Could not find quantity input on Add By Code page",
          { currentUrl: page.url(), codeSelector },
          screenshotPath,
        );
      }

      const itemsAdded = [];
      const itemsRejected = [];

      // === BATCHING ===
      // MILO silently drops items when too many are queued in one "Add all to
      // Cart" click. Empirical evidence (May 7 production order, 28 SKUs): drops
      // were 1-4 items per attempt. Splitting into smaller batches (default 10
      // items per batch) and clicking "Add all" once per batch eliminates the
      // silent drops. Each "Add all" clears the form but doesn't navigate, so we
      // stay on /milo/products/bycode and immediately type the next batch.
      const batchSize =
        Number.isFinite(options.batchSize) && Number(options.batchSize) > 0
          ? Math.floor(Number(options.batchSize))
          : DEFAULT_BATCH_SIZE;

      const itemBatches = [];
      for (let i = 0; i < normalizedItems.length; i += batchSize) {
        itemBatches.push(normalizedItems.slice(i, i + batchSize));
      }

      console.log(
        `[stage3] Typing ${normalizedItems.length} items across ${itemBatches.length} batch(es) of up to ${batchSize}`,
      );

      for (let batchIdx = 0; batchIdx < itemBatches.length; batchIdx += 1) {
        const batch = itemBatches[batchIdx];
        const batchLabel = `${batchIdx + 1}/${itemBatches.length}`;
        console.log(`[stage3] --- Batch ${batchLabel}: ${batch.length} item(s) ---`);

        // Type each item in this batch
        for (let idx = 0; idx < batch.length; idx += 1) {
          const item = batch[idx];
          const perItemStart = Date.now();
          const rowsBefore = await collectQuickAddRows(page);
          const rowCountBefore = rowsBefore.length;

          await codeInput.focus();
          await codeInput.fill(item.code);
          const codeValue = await codeInput.inputValue().catch(() => "");
          if (codeValue.trim() !== item.code) {
            const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-item-code-fill-${item.code}`);
            throw createStage3Error(
              "MILO_STAGE3_ITEM_NOT_ACCEPTED",
              `Code input value mismatch for ${item.code}`,
              { code: item.code, typedValue: codeValue, codeSelector, batch: batchLabel },
              screenshotPath,
            );
          }

          await page.keyboard.press("Tab");
          await page.waitForTimeout(300);
          const qtyFocused = await qtyInput.evaluate((el) => document.activeElement === el).catch(() => false);
          if (!qtyFocused) {
            await qtyInput.focus().catch(() => {});
          }

          await qtyInput.fill(String(item.quantity));
          await page.keyboard.press("Tab");

          const rowWait = await waitForRowCountIncrease(page, rowCountBefore, perItemTimeoutMs);
          if (!rowWait.ok) {
            const reasonHint = await inlineItemErrorHint(page);
            const rejected = {
              code: item.code,
              quantity: item.quantity,
              expected_name: item.expected_name,
              reason: reasonHint || "Item did not appear in quick add list",
              waitedMs: rowWait.waitedMs,
              visibleRows: rowWait.rows.map((r) => r.text).slice(0, 8),
              durationMs: Date.now() - perItemStart,
              batch: batchLabel,
            };
            itemsRejected.push(rejected);
            if (failOnRejected) {
              const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-item-not-accepted-${item.code}`);
              throw createStage3Error(
                "MILO_STAGE3_ITEM_NOT_ACCEPTED",
                `Item ${item.code} was not accepted by MILO`,
                rejected,
                screenshotPath,
              );
            }
            continue;
          }

          const rowsNow = rowWait.rows;
          const matchedByCode = [...rowsNow].reverse().find((row) => row.code === item.code);
          const newRow = matchedByCode || rowsNow[rowsNow.length - 1] || null;
          const actualName = newRow?.nameGuess || "";
          const expectedNameMatched = item.expected_name
            ? actualName.toLowerCase().includes(item.expected_name.toLowerCase())
            : null;

          itemsAdded.push({
            code: item.code,
            quantity: item.quantity,
            verified: true,
            actualNameOnPage: actualName,
            rowIndex: Math.max(rowsNow.length - 1, 0),
            expectedNameMatched,
            durationMs: Date.now() - perItemStart,
            batch: batchLabel,
          });
        }

        await captureArtifact(page, outputDir, stage3Artifacts, `02-batch-${batchIdx + 1}-typed`);

        // Click "Add all to Cart" for this batch
        const addAllBtn = page.getByRole("button", { name: /add all to cart/i }).first();
        if ((await addAllBtn.count()) === 0) {
          const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-add-all-missing-batch-${batchIdx + 1}`);
          throw createStage3Error(
            "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
            `Add all to Cart button was not found (batch ${batchLabel})`,
            { currentUrl: page.url(), qtySelector, codeSelector, batch: batchLabel },
            screenshotPath,
          );
        }
        const addAllState = await addAllBtn
          .evaluate((el) => ({
            disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.disabled === true,
            text: (el.textContent || "").replace(/\s+/g, " ").trim(),
          }))
          .catch(() => ({ disabled: true, text: "" }));
        if (addAllState.disabled) {
          const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-add-all-disabled-batch-${batchIdx + 1}`);
          throw createStage3Error(
            "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
            `Add all to Cart button remained disabled after typing items (batch ${batchLabel})`,
            {
              currentUrl: page.url(),
              addAllState,
              itemsAddedCount: itemsAdded.length,
              itemsRejectedCount: itemsRejected.length,
              batch: batchLabel,
            },
            screenshotPath,
          );
        }
        if (BLOCKLIST_RE.test(addAllState.text) && !/add all to cart/i.test(addAllState.text)) {
          const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-add-all-blocked-batch-${batchIdx + 1}`);
          throw createStage3Error(
            "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
            "SAFE MODE blocked unexpected action text on Add all to Cart button",
            { currentUrl: page.url(), buttonText: addAllState.text, batch: batchLabel },
            screenshotPath,
          );
        }

        await clickSafely(page, addAllBtn, {
          step: `3b-add-all-batch-${batchIdx + 1}`,
          selectorNote: `Add all to Cart on quick add page (batch ${batchLabel})`,
        });

        const addAllConfirmation = await waitForAddAllConfirmation(page, codeInput, qtyInput, 10_000);
        if (!addAllConfirmation.ok) {
          const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, `error-add-all-no-confirmation-batch-${batchIdx + 1}`);
          throw createStage3Error(
            "MILO_STAGE3_ADD_ALL_FAILED",
            `Add all to Cart click did not move items to cart for batch ${batchLabel} (form did not clear, no cart badge update, no toast within 10s)`,
            {
              currentUrl: page.url(),
              waitedMs: addAllConfirmation.waitedMs,
              formValues: {
                code: addAllConfirmation.state?.codeValue ?? "",
                quantity: addAllConfirmation.state?.qtyValue ?? "",
              },
              cartBadgeText: addAllConfirmation.state?.cartBadgeText ?? "",
              visibleAlerts: addAllConfirmation.state?.visibleAlerts ?? [],
              batch: batchLabel,
            },
            screenshotPath,
          );
        }
        console.log(`[stage3] Batch ${batchLabel} confirmed (form cleared/cart badge/toast).`);

        // Brief settle pause between batches so MILO's quick-add list resets cleanly
        if (batchIdx < itemBatches.length - 1) {
          await page.waitForTimeout(INTER_BATCH_SETTLE_MS);
        }
      }

      if (itemsAdded.length === 0) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-all-items-rejected");
        throw createStage3Error(
          "MILO_STAGE3_ITEM_NOT_ACCEPTED",
          "None of the requested items were accepted on Add By Code page",
          { itemsRejected, requestedCount: normalizedItems.length, batchCount: itemBatches.length },
          screenshotPath,
        );
      }

      console.log(
        `[stage3] All batches complete. Added ${itemsAdded.length}/${normalizedItems.length} items across ${itemBatches.length} batch(es).`,
      );

      const cartNav = await (async () => {
        const direct = await findVisibleFirst(page, ["a[href='/milo/cart']"]);
        if (direct.locator) return direct;
        const classed = await findVisibleFirst(page, ["a[href*='cart'][class*='cart']", "a[href*='/milo/cart']"]);
        if (classed.locator) return classed;
        const iconish = await findVisibleFirst(page, ["[class*='cart'] a", "a[class*='cart']", "[aria-label*='cart' i]"]);
        if (iconish.locator) return iconish;
        const byRole = page.getByRole("link", { name: /cart/i }).first();
        if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
          return { locator: byRole, selector: "role=link[name=cart]" };
        }
        return { locator: null, selector: null };
      })();
      if (!cartNav.locator) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-cart-link-missing");
        throw createStage3Error(
          "MILO_STAGE3_CART_NAV_TIMEOUT",
          "Could not find cart icon/link after Add all to Cart",
          { currentUrl: page.url() },
          screenshotPath,
        );
      }

      await clickSafely(page, cartNav.locator, {
        step: "3c-nav-to-cart",
        selectorNote: cartNav.selector || "header cart icon",
      });

      try {
        await waitForSpaNavigation(
          page,
          "/milo/cart",
          ["button:has-text('Validate')", "button:has-text('Clear Cart')", "text=/Cart is empty/i", "text=/Your cart/i"],
          CART_NAV_TIMEOUT_MS,
          "stage3-to-cart",
        );
      } catch (error) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-cart-nav-timeout");
        throw createStage3Error(
          "MILO_STAGE3_CART_NAV_TIMEOUT",
          "Timed out waiting for /milo/cart after Add all to Cart",
          { currentUrl: page.url(), reason: String(error?.message || error) },
          screenshotPath,
        );
      }

      await waitForAngularStable(page, 10_000).catch(async () => {
        await page.waitForTimeout(500);
      });
      await captureArtifact(page, outputDir, stage3Artifacts, "03-cart-populated");

      // ─── Cart-state verification (v2) ────────────────────────────────────
      // The add-by-code page declares "success" based on three UI signals
      // (form clear / cart badge digits / toast). All three can fire on
      // false positives. Two more failure modes observed 2026-05-17:
      //
      //   1. ITEMS LANDED IN OOS SECTION, NOT ACTIVE CART. MILO accepts an
      //      add for an out-of-stock item but moves it to the "Out of stock
      //      items" section. v1 of this verifier picked up codes from
      //      ANY table.table-bordered, including the OOS table — counted
      //      OOS items as "confirmed". Real example: code 100001 (1792
      //      Single Barrel BBN) requested qty=6, MILO put it in OOS,
      //      v1 verifier said "all confirmed", orderSummary showed only
      //      the FRIS portion at $29.34 instead of the expected ~$265.
      //
      //   2. QUANTITY SILENTLY CLAMPED. MILO accepts an add but applies a
      //      different quantity than what was typed — e.g. requesting
      //      qty=13 for a 750mL produced an "Invalid split quantities"
      //      banner because 13 isn't a legal MLCC split for 750mL. v1
      //      verifier only checked code presence, not the quantity value.
      //
      // v2 reads the cart structure with both pieces of state:
      //   - active: { code, quantity } for rows in active-cart tables
      //   - oos:    { code, quantity } for rows in the OOS section
      // The OOS section is identified by walking from an "Out of stock
      // items" heading down to the next table; everything else is active.
      // We then cross-reference each itemsAdded entry against three buckets
      // (active-with-matching-qty, active-with-clamped-qty, OOS, missing)
      // and surface specific demotion reasons.
      // Cart reader — runs in the page context. page.evaluate has no timeout,
      // so the call is bounded by raceStage3Timeout below.
      const readCartContents = () => {
        const parseQtyFromRow = (row) => {
          const qtyCell = row.querySelectorAll("td")[1];
          if (!qtyCell) return null;
          const qtyInput = qtyCell.querySelector("input");
          if (qtyInput && qtyInput.value) {
            const n = parseInt(qtyInput.value, 10);
            return Number.isFinite(n) ? n : null;
          }
          const m = (qtyCell.textContent || "").match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };

        // Find the "Out of stock items" anchor (any element whose text
        // matches that label). Tables that come AFTER this anchor in DOM
        // order are OOS tables; tables BEFORE it are active-cart tables.
        const oosAnchor = [...document.querySelectorAll("*")].find((el) => {
          const txt = (el.textContent || "").trim();
          // Match only elements whose own text label is the OOS heading,
          // not large containers that contain it as nested text.
          return (
            /^out of stock items$/i.test(txt) &&
            el.children.length === 0
          );
        });

        const active = [];
        const oos = [];
        const tables = [...document.querySelectorAll("table.table-bordered")];

        for (const table of tables) {
          // Position relative to OOS anchor decides bucket.
          const isAfterOosAnchor =
            oosAnchor &&
            (oosAnchor.compareDocumentPosition(table) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0;

          const rows = [...table.querySelectorAll("tbody > tr")];
          for (const row of rows) {
            const codeEl = row.querySelector("td span.text-muted");
            if (!codeEl) continue;
            const codeText = (codeEl.textContent || "").trim();
            if (!/^\d+$/.test(codeText)) continue;
            const qty = parseQtyFromRow(row);
            const entry = { code: codeText, quantity: qty };
            (isAfterOosAnchor ? oos : active).push(entry);
          }
        }

        return { active, oos, oosHeadingFound: Boolean(oosAnchor) };
      };

      // Bounded cart read. A stuck /milo/cart JS context once hung this for
      // the full 240s Stage 3 budget (2026-05-24). On a stall, reload the
      // cart page once and retry before giving up — recovers from a transient
      // bad page state instead of burning the whole run.
      console.log("[stage3] reading /milo/cart contents...");
      let cartContents;
      try {
        cartContents = await raceStage3Timeout(
          page.evaluate(readCartContents),
          CART_READ_TIMEOUT_MS,
          "MILO_STAGE3_CART_VERIFICATION_TIMEOUT",
          "Reading /milo/cart contents stalled — the cart page did not respond",
        );
      } catch (readErr) {
        if (readErr?.code !== "MILO_STAGE3_CART_VERIFICATION_TIMEOUT") throw readErr;
        console.warn("[stage3] cart read stalled — reloading /milo/cart and retrying once");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        await waitForAngularStable(page, 10_000).catch(async () => {
          await page.waitForTimeout(1_000);
        });
        try {
          cartContents = await raceStage3Timeout(
            page.evaluate(readCartContents),
            CART_READ_TIMEOUT_MS,
            "MILO_STAGE3_CART_VERIFICATION_TIMEOUT",
            "Reading /milo/cart contents stalled even after a reload — cart page unresponsive",
          );
        } catch (retryErr) {
          const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-cart-verification-timeout");
          retryErr.screenshotPath = retryErr.screenshotPath || screenshotPath;
          throw retryErr;
        }
      }

      const activeMap = new Map(
        cartContents.active.map((r) => [r.code, r.quantity]),
      );
      const oosMap = new Map(
        cartContents.oos.map((r) => [r.code, r.quantity]),
      );

      const verificationRejected = [];
      const verifiedItemsAdded = [];
      const clampedItems = [];
      const oosItems = [];
      const missingItems = [];

      for (const item of itemsAdded) {
        const codeStr = String(item.code);
        const requestedQty = Number(item.quantity);

        if (activeMap.has(codeStr)) {
          const actualQty = activeMap.get(codeStr);
          if (actualQty === requestedQty) {
            verifiedItemsAdded.push({ ...item, verifiedQuantity: actualQty });
          } else {
            // Quantity differs from what we requested. MILO may have
            // clamped, rejected the typed value, or merged with existing.
            const rejection = {
              ...item,
              requestedQuantity: requestedQty,
              actualQuantity: actualQty,
              rejectionReason: `Quantity mismatch: requested ${requestedQty}, MILO has ${actualQty} in active cart`,
              rejectionStage: "post-add-cart-quantity-check",
            };
            verificationRejected.push(rejection);
            clampedItems.push({
              code: codeStr,
              requested: requestedQty,
              actual: actualQty,
            });
          }
        } else if (oosMap.has(codeStr)) {
          const oosQty = oosMap.get(codeStr);
          const rejection = {
            ...item,
            oosQuantity: oosQty,
            rejectionReason: `Item moved to OOS section by MILO (qty=${oosQty}); not in active cart`,
            rejectionStage: "post-add-out-of-stock",
          };
          verificationRejected.push(rejection);
          oosItems.push({ code: codeStr, oosQuantity: oosQty });
        } else {
          const rejection = {
            ...item,
            rejectionReason:
              "Reported as added by Add-by-Code UI but not present anywhere on /milo/cart (active or OOS)",
            rejectionStage: "post-add-cart-missing",
          };
          verificationRejected.push(rejection);
          missingItems.push(codeStr);
        }
      }

      const finalItemsAdded = verifiedItemsAdded;
      const finalItemsRejected = [...itemsRejected, ...verificationRejected];

      // Verbose verification summary so test runs make the failure mode
      // obvious at a glance.
      console.log(
        `[stage3] cart-verification: active rows=${cartContents.active.length}, oos rows=${cartContents.oos.length}, oos-heading=${cartContents.oosHeadingFound ? "found" : "missing"}`,
      );
      if (clampedItems.length > 0) {
        console.log(
          `[stage3]   quantity-clamped: ${JSON.stringify(clampedItems)}`,
        );
      }
      if (oosItems.length > 0) {
        console.log(`[stage3]   in-oos: ${JSON.stringify(oosItems)}`);
      }
      if (missingItems.length > 0) {
        console.log(`[stage3]   missing: ${JSON.stringify(missingItems)}`);
      }
      console.log(
        `[stage3] ${finalItemsAdded.length}/${itemsAdded.length} items verified in active cart with matching quantity.`,
      );

      // Surface specific failure modes via typed errors. Priority order
      // matters: quantity-clamp is most actionable for the caller (it
      // means "you asked for an invalid quantity"); OOS-only is a real
      // MILO state ("item is out of stock"); missing means the add
      // mechanism failed entirely.
      if (normalizedItems.length > 0 && finalItemsAdded.length === 0) {
        // All items failed verification — pick the most descriptive error.
        if (clampedItems.length === normalizedItems.length) {
          const screenshotPath = await captureFailure(
            page,
            outputDir,
            stage3Artifacts,
            "error-quantity-clamped",
          );
          throw createStage3Error(
            "MILO_STAGE3_QUANTITY_CLAMPED",
            "Every requested item appears in the active cart at a different quantity than requested. MILO likely rejected the quantities as invalid splits (check SPLIT_CASE_RULES_BY_SIZE_ML for the bottle size).",
            {
              requestedCount: normalizedItems.length,
              clampedItems,
              activeCartContents: cartContents.active,
              currentUrl: page.url(),
            },
            screenshotPath,
          );
        }
        if (oosItems.length === normalizedItems.length) {
          const screenshotPath = await captureFailure(
            page,
            outputDir,
            stage3Artifacts,
            "error-all-items-oos",
          );
          throw createStage3Error(
            "MILO_STAGE3_ITEMS_OUT_OF_STOCK",
            "Every requested item was accepted by MILO but moved to the Out of Stock section; nothing in active cart.",
            {
              requestedCount: normalizedItems.length,
              oosItems,
              currentUrl: page.url(),
            },
            screenshotPath,
          );
        }
        // Otherwise: completely missing — the add UI lied.
        const screenshotPath = await captureFailure(
          page,
          outputDir,
          stage3Artifacts,
          "error-cart-verification-empty",
        );
        throw createStage3Error(
          "MILO_STAGE3_CART_VERIFICATION_EMPTY",
          "Stage 3 reported items added but /milo/cart contains zero matching rows (active or OOS). The add-page UI signals (form-clear/cart-badge/toast) fire on false positives.",
          {
            requestedCount: normalizedItems.length,
            reportedAddedCount: itemsAdded.length,
            activeCartContents: cartContents.active,
            oosContents: cartContents.oos,
            currentUrl: page.url(),
            notTrusted: ["formCleared", "cartBadgeUpdated", "toastVisible"],
          },
          screenshotPath,
        );
      }

      const stage3CompletedAtDate = new Date();
      return {
        ...session,
        currentPage: "cart",
        currentUrl: page.url(),
        itemsAdded: finalItemsAdded,
        itemsRejected: finalItemsRejected,
        cartVerification: {
          reportedAddedCount: itemsAdded.length,
          confirmedInCartCount: finalItemsAdded.length,
          demotedCount: verificationRejected.length,
          activeCart: cartContents.active,
          oosSection: cartContents.oos,
          oosHeadingFound: cartContents.oosHeadingFound,
          clampedItems,
          oosItems,
          missingItems,
        },
        cartClearResult,
        stage3StartedAt,
        stage3CompletedAt: stage3CompletedAtDate.toISOString(),
        stage3DurationMs: stage3CompletedAtDate.getTime() - stage3StartedAtDate.getTime(),
        stage3Artifacts,
      };
    } catch (error) {
      if (error?.code) throw error;
      const screenshotPath = await captureFailure(session.page, outputDir, stage3Artifacts, "error-unhandled-stage3");
      throw createStage3Error(
        "MILO_STAGE3_ADD_BY_CODE_NAV_FAILED",
        "Unexpected Stage 3 failure",
        { currentUrl: session.page?.url?.() || null, reason: String(error?.message || error) },
        screenshotPath,
      );
    }
  };

  return withOverallTimeout(run(), timeoutMs).catch(async (error) => {
    if (error?.code === "MILO_STAGE3_TIMEOUT") {
      const screenshotPath = await captureFailure(session.page, outputDir, stage3Artifacts, "error-stage3-timeout");
      error.screenshotPath = error.screenshotPath || screenshotPath;
      error.details = { ...(error.details || {}), currentUrl: session.page?.url?.() || null };
    }
    throw error;
  });
}
