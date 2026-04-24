import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BLOCKLIST_RE, clickSafely, waitForAngularStable, waitForSpaNavigation } from "../milo-discovery.js";
import { validateCart } from "../../mlcc/milo-ordering-rules.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PER_ITEM_TIMEOUT_MS = 8_000;
const CART_NAV_TIMEOUT_MS = 15_000;
const ADD_BY_CODE_NAV_TIMEOUT_MS = 20_000;

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
 * - MILO_STAGE3_TIMEOUT
 */
function createStage3Error(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
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

  const normalized = items.map((item) => ({
    code: String(item.code).trim(),
    quantity: Number(item.quantity),
    bottle_size_ml: Number(item.bottle_size_ml),
    ada_number:
      typeof item.ada_number === "string" && item.ada_number.trim() !== "" ? item.ada_number.trim() : undefined,
    expected_name: item.expected_name ? String(item.expected_name).trim() : "",
  }));

  if (!skipPreValidation) {
    const missingAdaItems = normalized.filter((item) => !item.ada_number);
    if (missingAdaItems.length > 0) {
      if (typeof mlccLookup !== "function") {
        throw createStage3Error(
          "MILO_STAGE3_MLCC_LOOKUP_MISSING",
          "mlccLookup function required for pre-validation. Pass options.mlccLookup or set skipPreValidation=true.",
          { missingAdaCodes: missingAdaItems.map((x) => x.code) },
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

async function captureArtifact(page, outputDir, artifacts, baseName) {
  if (!outputDir) return;
  const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
  const htmlPath = path.join(outputDir, `${baseName}.html`);
  const pngPath = path.join(outputDir, `${baseName}.png`);
  const urlPath = path.join(outputDir, `${baseName}.url.txt`);
  await writeFile(htmlPath, html, "utf8");
  await page.screenshot({ path: pngPath, fullPage: true });
  await writeFile(urlPath, `${page.url()}\n`, "utf8");
  artifacts.push(htmlPath, pngPath, urlPath);
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

  const run = async () => {
    const page = session.page;
    if (outputDir) await mkdir(outputDir, { recursive: true });

    try {
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

      for (let idx = 0; idx < normalizedItems.length; idx += 1) {
        const item = normalizedItems[idx];
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
            { code: item.code, typedValue: codeValue, codeSelector },
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
        });
      }

      await captureArtifact(page, outputDir, stage3Artifacts, "02-items-typed");

      if (itemsAdded.length === 0) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-all-items-rejected");
        throw createStage3Error(
          "MILO_STAGE3_ITEM_NOT_ACCEPTED",
          "None of the requested items were accepted on Add By Code page",
          { itemsRejected, requestedCount: normalizedItems.length },
          screenshotPath,
        );
      }

      const addAllBtn = page.getByRole("button", { name: /add all to cart/i }).first();
      if ((await addAllBtn.count()) === 0) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-add-all-missing");
        throw createStage3Error(
          "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
          "Add all to Cart button was not found",
          { currentUrl: page.url(), qtySelector, codeSelector },
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
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-add-all-disabled");
        throw createStage3Error(
          "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
          "Add all to Cart button remained disabled after typing items",
          { currentUrl: page.url(), addAllState, itemsAddedCount: itemsAdded.length, itemsRejectedCount: itemsRejected.length },
          screenshotPath,
        );
      }
      if (BLOCKLIST_RE.test(addAllState.text) && !/add all to cart/i.test(addAllState.text)) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-add-all-blocked");
        throw createStage3Error(
          "MILO_STAGE3_ADD_ALL_BUTTON_DISABLED",
          "SAFE MODE blocked unexpected action text on Add all to Cart button",
          { currentUrl: page.url(), buttonText: addAllState.text },
          screenshotPath,
        );
      }

      await clickSafely(page, addAllBtn, {
        step: "3b-add-all-to-cart",
        selectorNote: "Add all to Cart on quick add page",
      });

      const addAllConfirmation = await waitForAddAllConfirmation(page, codeInput, qtyInput, 10_000);
      if (!addAllConfirmation.ok) {
        const screenshotPath = await captureFailure(page, outputDir, stage3Artifacts, "error-add-all-no-confirmation");
        throw createStage3Error(
          "MILO_STAGE3_ADD_ALL_FAILED",
          "Add all to Cart click did not appear to move items to cart (form did not clear, no cart badge update, no confirmation toast within 10s)",
          {
            currentUrl: page.url(),
            waitedMs: addAllConfirmation.waitedMs,
            formValues: {
              code: addAllConfirmation.state?.codeValue ?? "",
              quantity: addAllConfirmation.state?.qtyValue ?? "",
            },
            cartBadgeText: addAllConfirmation.state?.cartBadgeText ?? "",
            visibleAlerts: addAllConfirmation.state?.visibleAlerts ?? [],
          },
          screenshotPath,
        );
      }
      console.log("[stage3] Add all to Cart confirmed (form cleared/cart badge/toast).");

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

      const stage3CompletedAtDate = new Date();
      return {
        ...session,
        currentPage: "cart",
        currentUrl: page.url(),
        itemsAdded,
        itemsRejected,
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
