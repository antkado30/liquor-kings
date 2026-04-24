import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { waitForAngularStable } from "../milo-discovery.js";
import { KNOWN_ADAS } from "../../mlcc/milo-ordering-rules.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_VALIDATE_CLICK_TIMEOUT_MS = 30_000;

function createStage4Error(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createStage4Error("MILO_STAGE4_TIMEOUT", `Stage 4 exceeded timeout budget of ${timeoutMs}ms`, { timeoutMs }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
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
  const htmlPath = path.join(outputDir, `${baseName}.html`);
  const pngPath = path.join(outputDir, `${baseName}.png`);
  const urlPath = path.join(outputDir, `${baseName}.url.txt`);
  const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
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

async function appendAction(outputDir, payload) {
  if (!outputDir) return;
  await appendFile(path.join(outputDir, "actions.jsonl"), `${JSON.stringify(payload)}\n`, "utf8").catch(() => {});
}

async function snapshotSignals(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    const summaryBlock = [...document.querySelectorAll("*")]
      .find((el) => /gross total|net total|liquor tax|discount/i.test((el.textContent || "").toLowerCase()));
    const summaryText = (summaryBlock?.textContent || "").replace(/\s+/g, " ").trim();
    const outOfStockRows = [...document.querySelectorAll("*")]
      .filter((el) => /out of stock items/i.test((el.textContent || "").trim()))
      .length;
    return {
      summaryText,
      outOfStockRows,
      hasValidatedToast: /cart validated|validated/i.test(text),
      hasRedError: /must order at least nine liters|out of stock|minimum/i.test(text),
    };
  });
}

async function waitForCartFinalized(page, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastState = {
    finalizeStillPresent: false,
    deliveryDatesStillPresent: false,
    validateButtonPresent: false,
    waitedMs: 0,
    currentUrl: page.url(),
  };

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ");
      const finalizeStillPresent = /please wait while we finalize your cart/i.test(text);
      const deliveryDatesStillPresent = /we'?re loading your delivery dates/i.test(text);
      const validateButtonPresent = [...document.querySelectorAll("button")]
        .some((btn) => (btn.textContent || "").replace(/\s+/g, " ").trim() === "Validate");
      return { finalizeStillPresent, deliveryDatesStillPresent, validateButtonPresent };
    });
    const validateVisible = await page.getByRole("button", { name: /^Validate$/ }).first().isVisible().catch(() => false);
    lastState = {
      ...state,
      validateButtonPresent: state.validateButtonPresent && validateVisible,
      waitedMs: Date.now() - startedAt,
      currentUrl: page.url(),
    };
    if (!lastState.finalizeStillPresent && !lastState.deliveryDatesStillPresent && lastState.validateButtonPresent) {
      return true;
    }
    await page.waitForTimeout(500);
  }

  throw createStage4Error(
    "MILO_STAGE4_CART_FINALIZATION_TIMEOUT",
    "Cart did not finish finalizing before Validate became available",
    lastState,
  );
}

async function waitForPostValidateStabilized(page, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const toastOrMessage = await page
      .evaluate(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ");
        return /cart validated|validated|added to cart|out of stock|must order at least nine liters/i.test(text);
      })
      .catch(() => false);
    const validateEnabledAgain = await page
      .getByRole("button", { name: /^Validate$/ })
      .first()
      .evaluate((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true" && el.disabled !== true)
      .catch(() => false);
    if (toastOrMessage || validateEnabledAgain) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function clickValidateButtonSafely(page, button, outputDir) {
  const currentUrl = page.url();
  if (!currentUrl.includes("/milo/cart")) {
    throw createStage4Error("MILO_STAGE4_INVALID_SESSION", "Refusing Validate click outside /milo/cart", { currentUrl });
  }
  const buttonText = ((await button.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (buttonText !== "Validate") {
    throw createStage4Error("MILO_STAGE4_VALIDATE_BUTTON_NOT_FOUND", "Validate button text mismatch", {
      currentUrl,
      buttonText,
    });
  }
  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  if (!visible) {
    throw createStage4Error("MILO_STAGE4_VALIDATE_BUTTON_NOT_FOUND", "Validate button is not visible", { currentUrl, buttonText });
  }
  if (!enabled) {
    throw createStage4Error("MILO_STAGE4_VALIDATE_BUTTON_DISABLED", "Validate button is disabled", { currentUrl, buttonText });
  }
  await appendAction(outputDir, { step: "4a-validate-click", url: currentUrl, buttonText, ts: new Date().toISOString() });
  await button.click({ timeout: 15_000 });
}

async function parseCartState(page) {
  return page.evaluate(() => {
    const result = {
      adaOrders: [],
      outOfStockItems: [],
      orderSummary: { grossTotal: null, liquorTax: null, discount: null, netTotal: null },
      deliveryDates: { "141": null, "221": null, "321": null },
      validationMessages: [],
      confirmationEmail: null,
    };

    const parseDollar = (text) => {
      if (!text) return null;
      const m = String(text).match(/\$?\s*\(?\s*([\d,]+\.\d{2})\s*\)?/);
      return m ? parseFloat(m[1].replace(/,/g, "")) : null;
    };

    const parseMDYtoISO = (text) => {
      if (!text) return null;
      const m = String(text).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return null;
      return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
    };

    const adaNumberFromName = (name) => {
      const n = (name || "").toLowerCase();
      if (n.includes("general wine")) return "221";
      if (n.includes("nws michigan")) return "321";
      if (n.includes("imperial beverage")) return "141";
      return null;
    };

    // === Parse ADA sections ===
    // Each ada-name span is the anchor. Walk forward to find the associated table.
    const adaNames = document.querySelectorAll("span.ada-name");
    adaNames.forEach((nameSpan) => {
      const adaName = (nameSpan.textContent || "").trim().replace(/\s+/g, " ");
      const adaNumber = adaNumberFromName(adaName);

      // Find the containing block — walk up to find a row container that includes the table
      let block = nameSpan.closest(".row")?.parentElement;
      if (!block) block = nameSpan.closest(".d-block") || nameSpan.parentElement;

      // Find the next sibling(s) of the name's row to get the delivery/confirmation line and the table
      let deliveryDate = null;
      let confirmationNumber = null;
      let table = null;

      if (block) {
        // Scan downward siblings for text with "Delivery Date" and for a cart table
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;
        while (node) {
          // Look for the delivery/confirmation text block
          const txt = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (!deliveryDate && /Delivery Date:/i.test(txt)) {
            deliveryDate = parseMDYtoISO(txt);
            const confMatch = txt.match(/Confirmation\s*#\s*:?\s*(\d{4,})/i);
            if (confMatch) confirmationNumber = confMatch[1];
          }
          // Find the PRODUCT TABLE — must have class "table-bordered" and be a <table>
          if (!table && node.tagName === "TABLE" && node.classList.contains("table-bordered")) {
            table = node;
            break;
          }
          node = walker.nextNode();
        }
      }

      // If we didn't find it walking inside block, fall back: find next sibling rows until we hit another ada-name or a table
      if (!table) {
        let sibling = (nameSpan.closest(".row") || nameSpan).nextElementSibling;
        while (sibling) {
          const found = sibling.querySelector && sibling.querySelector("table.table-bordered");
          if (found) {
            table = found;
            break;
          }
          if (sibling.querySelector && sibling.querySelector("span.ada-name")) break;
          sibling = sibling.nextElementSibling;
        }
      }

      // Parse rows
      const items = [];
      let subtotalLiters = 0;
      let subtotalDollars = 0;
      const errors = [];

      if (table) {
        const bodyRows = [...table.querySelectorAll("tbody > tr")].filter((r) => r.querySelectorAll("td").length >= 5);
        bodyRows.forEach((row) => {
          const cells = [...row.querySelectorAll("td")];
          const productCell = cells[0];
          if (!productCell) return;

          // Extract name and code from the two spans
          const nameEl = productCell.querySelector("span.font-weight-bold:not(.text-muted)");
          const codeEl = productCell.querySelector("span.text-muted");
          const rawName = nameEl ? nameEl.textContent.trim() : productCell.textContent.trim();
          const code = codeEl ? codeEl.textContent.trim() : null;

          const sizeMatch = rawName.match(/\((\d+)\s*ml\)/i);
          const bottleSizeMl = sizeMatch ? parseInt(sizeMatch[1], 10) : null;
          const name = rawName.replace(/\s*\(\d+\s*ml\)\s*$/i, "").trim();

          // Quantity
          const qtyInput = cells[1]?.querySelector("input");
          let quantity = null;
          if (qtyInput && qtyInput.value) {
            quantity = parseInt(qtyInput.value, 10);
          } else if (cells[1]) {
            const qtyText = cells[1].textContent.trim();
            const qtyMatch = qtyText.match(/(\d+)/);
            if (qtyMatch) quantity = parseInt(qtyMatch[1], 10);
          }

          // "Quantity ordered: N" subtext
          const qtyOrderedMatch = (cells[1]?.textContent || "").match(/quantity\s*ordered\s*:?\s*(\d+)/i);
          const quantityOrdered = qtyOrderedMatch ? parseInt(qtyOrderedMatch[1], 10) : null;

          const unitPrice = parseDollar(cells[2]?.textContent);
          const litersText = (cells[3]?.textContent || "").trim();
          const liters = parseFloat(litersText.replace(/[^\d.]/g, "")) || 0;
          const lineTotal = parseDollar(cells[4]?.textContent);

          if (code) {
            items.push({
              code,
              name,
              bottleSizeMl,
              quantity: Number.isFinite(quantity) ? quantity : null,
              unitPrice,
              liters,
              lineTotal,
              quantityOrdered,
              outOfStock: false,
            });
            if (liters) subtotalLiters += liters;
            if (lineTotal) subtotalDollars += lineTotal;
          }
        });

        // Also check for 9L minimum error near the ada-name
        if (block) {
          const errTexts = [...block.querySelectorAll(".alert, .alert-danger, [class*='error' i]")]
            .map((e) => e.textContent.trim())
            .filter(Boolean);
          errors.push(...errTexts);
          // Also scan for red warning text
          const allText = block.textContent || "";
          if (/must order at least (\d+\s*)?nine liter/i.test(allText)) {
            errors.push("You must order at least nine liters from this distributor");
          }
        }
      }

      result.adaOrders.push({
        adaNumber,
        adaName,
        deliveryDate,
        confirmationNumber,
        meetsMinimum: subtotalLiters >= 9,
        subtotalLiters: Math.round(subtotalLiters * 100) / 100,
        subtotalDollars: Math.round(subtotalDollars * 100) / 100,
        items,
        errors: [...new Set(errors)],
      });
    });

    // === Filter out empty ADA sections that MILO renders even for distributors with no items ===
    result.adaOrders = result.adaOrders.filter((a) => a.items.length > 0);
    result.adaOrders.forEach((order) => {
      if (!order?.adaNumber || !order?.deliveryDate) return;
      if (Object.prototype.hasOwnProperty.call(result.deliveryDates, order.adaNumber)) {
        result.deliveryDates[order.adaNumber] = order.deliveryDate;
      }
    });

    // === Parse "Out of stock items" section — skip unless there's a dedicated OOS table ===
    // OOS section has its own heading and its own table outside ada-name sections
    const oosHeadings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, .page-header, strong")].filter((h) =>
      /^\s*out\s*of\s*stock/i.test((h.textContent || "").trim()),
    );
    oosHeadings.forEach((h) => {
      // Find the nearest following table that isn't inside an ada-name block
      let el = h.parentElement;
      let oosTable = null;
      while (el && el !== document.body && !oosTable) {
        const candidate = el.querySelector("table.table-bordered, table.table");
        if (candidate && !candidate.closest("span.ada-name")) {
          // Verify this table is AFTER the heading, not the same one we already parsed
          const alreadyParsed = result.adaOrders.some((a) => {
            // rough check — if this table has any code matching an already-parsed item, skip
            const text = candidate.textContent || "";
            return a.items.some((it) => it.code && text.includes(it.code));
          });
          if (!alreadyParsed) oosTable = candidate;
        }
        el = el.nextElementSibling || el.parentElement;
      }
      if (oosTable) {
        const rows = [...oosTable.querySelectorAll("tbody > tr")].filter((r) => r.querySelectorAll("td").length >= 4);
        rows.forEach((row) => {
          const cells = [...row.querySelectorAll("td")];
          const productCell = cells[0];
          const nameEl = productCell?.querySelector("span.font-weight-bold:not(.text-muted)");
          const codeEl = productCell?.querySelector("span.text-muted");
          if (!nameEl || !codeEl) return;
          const rawName = nameEl.textContent.trim();
          const sizeMatch = rawName.match(/\((\d+)\s*ml\)/i);
          result.outOfStockItems.push({
            code: codeEl.textContent.trim(),
            name: rawName.replace(/\s*\(\d+\s*ml\)\s*$/i, "").trim(),
            bottleSizeMl: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
            quantity: parseInt(cells[1]?.textContent || "0", 10) || null,
            adaName: "",
          });
        });
      }
    });

    // === Parse Order Summary ===
    const bodyText = document.body.innerText || "";
    const findAmountNear = (labelRe) => {
      const match = bodyText.match(new RegExp(`${labelRe.source}\\s*\\$?\\s*\\(?\\s*([\\d,]+\\.\\d{2})\\s*\\)?`, labelRe.flags));
      if (!match) return null;
      const num = parseFloat(match[1].replace(/,/g, ""));
      return num;
    };

    result.orderSummary.grossTotal = findAmountNear(/Gross\s*Total/i);
    result.orderSummary.liquorTax = findAmountNear(/Liquor\s*Tax/i);
    // Discount is negative — look for parenthesis
    const discMatch = bodyText.match(/Discount\s*\(\$?([\d,]+\.\d{2})\)/i);
    if (discMatch) {
      result.orderSummary.discount = -parseFloat(discMatch[1].replace(/,/g, ""));
    } else {
      const discFlat = findAmountNear(/Discount/i);
      result.orderSummary.discount = discFlat !== null ? -Math.abs(discFlat) : null;
    }
    result.orderSummary.netTotal = findAmountNear(/Net\s*Total/i);

    // Confirmation email
    const emailMatch = bodyText.match(
      /confirmation\s*email[^:]*:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i,
    );
    result.confirmationEmail = emailMatch ? emailMatch[1] : null;

    // Toast messages
    const toastMessages = [...document.querySelectorAll(".toast-message, .toast-title")]
      .map((t) => t.textContent.trim())
      .filter(Boolean);
    result.validationMessages = [...new Set(toastMessages)];

    return result;
  });
}

function resolveAdaNumber(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("general wine")) return "221";
  if (normalized.includes("nws michigan")) return "321";
  if (normalized.includes("imperial beverage")) return "141";
  const exact = Object.entries(KNOWN_ADAS).find(([, adaName]) => normalized.includes(String(adaName).toLowerCase()));
  return exact ? exact[0] : null;
}

export async function validateCartOnMilo(session, options = {}) {
  if (!session?.page || !session?.browser || !session?.context) {
    throw createStage4Error("MILO_STAGE4_INVALID_SESSION", "Session missing required browser/page/context handles");
  }

  const page = session.page;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const validateClickTimeoutMs = Number.isFinite(options.validateClickTimeoutMs)
    ? Number(options.validateClickTimeoutMs)
    : DEFAULT_VALIDATE_CLICK_TIMEOUT_MS;
  const skipValidateClick = options.skipValidateClick === true;
  const captureArtifactsEnabled = options.captureArtifacts ?? true;
  const stage4StartedAtDate = new Date();
  const stage4StartedAt = stage4StartedAtDate.toISOString();
  const stage4Artifacts = [];
  const outputDir =
    captureArtifactsEnabled === true
      ? options.outputDir
        ? path.isAbsolute(options.outputDir)
          ? options.outputDir
          : path.resolve(process.cwd(), options.outputDir)
        : session.outputDir
          ? path.join(session.outputDir, "stage4")
          : null
      : null;

  const run = async () => {
    if (outputDir) await mkdir(outputDir, { recursive: true });

    const currentUrl = page.url();
    if (!currentUrl.includes("/milo/cart")) {
      throw createStage4Error("MILO_STAGE4_INVALID_SESSION", "Stage 4 requires /milo/cart", { currentUrl });
    }
    await waitForCartFinalized(page, 30_000);

    const hasCartRows = await page
      .evaluate(() => {
        const bodyText = document.body?.innerText || "";
        if (/cart is empty/i.test(bodyText)) return false;
        const rowCandidates = [...document.querySelectorAll("tr, li, .row, .card, div")].filter((el) => /#\s*\d{3,}/.test(el.textContent || ""));
        return rowCandidates.length > 0;
      })
      .catch(() => false);
    if (!hasCartRows) {
      const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-empty-cart");
      throw createStage4Error("MILO_STAGE4_EMPTY_CART", "Cart appears to be empty on arrival", { currentUrl }, screenshotPath);
    }

    await captureArtifact(page, outputDir, stage4Artifacts, "01-cart-before-validate");

    if (!skipValidateClick) {
      const validateButton = page.getByRole("button", { name: /^Validate$/ }).first();
      if ((await validateButton.count()) === 0 || !(await validateButton.isVisible().catch(() => false))) {
        const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-validate-button-missing");
        throw createStage4Error("MILO_STAGE4_VALIDATE_BUTTON_NOT_FOUND", "Validate button not present or visible", { currentUrl }, screenshotPath);
      }
      const isEnabled = await validateButton.isEnabled().catch(() => false);
      if (!isEnabled) {
        const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-validate-button-disabled");
        throw createStage4Error("MILO_STAGE4_VALIDATE_BUTTON_DISABLED", "Validate button is disabled", { currentUrl }, screenshotPath);
      }

      const beforeSignals = await snapshotSignals(page);
      await clickValidateButtonSafely(page, validateButton, outputDir);

      const startWait = Date.now();
      let responded = false;
      while (Date.now() - startWait < validateClickTimeoutMs) {
        const afterSignals = await snapshotSignals(page);
        const summaryChanged = afterSignals.summaryText !== beforeSignals.summaryText;
        const outOfStockChanged = afterSignals.outOfStockRows > beforeSignals.outOfStockRows;
        if (afterSignals.hasValidatedToast || summaryChanged || outOfStockChanged || afterSignals.hasRedError) {
          responded = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      if (!responded) {
        const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-validate-timeout");
        throw createStage4Error(
          "MILO_STAGE4_VALIDATE_TIMEOUT",
          "Validate click did not produce a response within timeout",
          { currentUrl: page.url(), validateClickTimeoutMs, beforeSignals },
          screenshotPath,
        );
      }

      const stabilizedAfterValidate = await waitForPostValidateStabilized(page, 30_000);
      if (!stabilizedAfterValidate) {
        const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-post-validate-finalization-timeout");
        throw createStage4Error(
          "MILO_STAGE4_VALIDATE_TIMEOUT",
          "Post-validate cart stabilization timed out",
          { currentUrl: page.url(), waitedMs: 30_000 },
          screenshotPath,
        );
      }
    }

    await waitForAngularStable(page, 10_000).catch(async () => {
      await page.waitForTimeout(1_000);
    });

    const parsed = await parseCartState(page);
    if (!parsed || !Array.isArray(parsed.adaOrders) || !Array.isArray(parsed.outOfStockItems)) {
      const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-parse-failed");
      throw createStage4Error(
        "MILO_STAGE4_PARSE_FAILED",
        "Could not parse cart state from cart page",
        { currentUrl: page.url() },
        screenshotPath,
      );
    }

    const adaOrders = parsed.adaOrders.map((order) => ({
      adaNumber: order.adaNumber || resolveAdaNumber(order.adaName),
      adaName: order.adaName || "",
      deliveryDate: order.deliveryDate || null,
      confirmationNumber: order.confirmationNumber || null,
      meetsMinimum: Boolean(order.meetsMinimum),
      subtotalLiters: Number.isFinite(Number(order.subtotalLiters)) ? Number(order.subtotalLiters) : 0,
      subtotalDollars: Number.isFinite(Number(order.subtotalDollars)) ? Number(order.subtotalDollars) : 0,
      items: (order.items || []).map((item) => ({
        code: item.code || null,
        name: item.name || "",
        bottleSizeMl: Number.isFinite(Number(item.bottleSizeMl)) ? Number(item.bottleSizeMl) : null,
        quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
        unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : null,
        liters: Number.isFinite(Number(item.liters)) ? Number(item.liters) : 0,
        lineTotal: Number.isFinite(Number(item.lineTotal)) ? Number(item.lineTotal) : null,
        quantityOrdered: Number.isFinite(Number(item.quantityOrdered)) ? Number(item.quantityOrdered) : null,
        outOfStock: Boolean(item.outOfStock),
      })),
      errors: Array.isArray(order.errors) ? order.errors : [],
    }));

    const outOfStockItems = parsed.outOfStockItems.map((item) => ({
      code: item.code || null,
      name: item.name || "",
      bottleSizeMl: Number.isFinite(Number(item.bottleSizeMl)) ? Number(item.bottleSizeMl) : null,
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
      adaName: item.adaName || "",
    }));

    const orderSummary = {
      grossTotal: Number.isFinite(Number(parsed.orderSummary?.grossTotal)) ? Number(parsed.orderSummary.grossTotal) : null,
      liquorTax: Number.isFinite(Number(parsed.orderSummary?.liquorTax)) ? Number(parsed.orderSummary.liquorTax) : null,
      discount: Number.isFinite(Number(parsed.orderSummary?.discount)) ? Number(parsed.orderSummary.discount) : null,
      netTotal: Number.isFinite(Number(parsed.orderSummary?.netTotal)) ? Number(parsed.orderSummary.netTotal) : null,
    };
    const existingDeliveryDates = {
      "141": session.deliveryDates?.["141"] ?? null,
      "221": session.deliveryDates?.["221"] ?? null,
      "321": session.deliveryDates?.["321"] ?? null,
    };
    const cartDeliveryDates = {
      "141": parsed.deliveryDates?.["141"] ?? null,
      "221": parsed.deliveryDates?.["221"] ?? null,
      "321": parsed.deliveryDates?.["321"] ?? null,
    };
    const mergedDeliveryDates = {
      "141": cartDeliveryDates["141"] ?? existingDeliveryDates["141"],
      "221": cartDeliveryDates["221"] ?? existingDeliveryDates["221"],
      "321": cartDeliveryDates["321"] ?? existingDeliveryDates["321"],
    };

    const hasAnyOrderSummaryValue = Object.values(orderSummary).some((value) => value !== null);
    if (adaOrders.length === 0 && outOfStockItems.length === 0 && !hasAnyOrderSummaryValue) {
      const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-parse-totals-failed");
      throw createStage4Error(
        "MILO_STAGE4_PARSE_FAILED",
        "Could not parse validated cart structure and totals",
        { currentUrl: page.url(), orderSummary, adaCount: adaOrders.length, outOfStockCount: outOfStockItems.length },
        screenshotPath,
      );
    }

    const canCheckout =
      adaOrders.length > 0 &&
      adaOrders.every((order) => order.meetsMinimum && order.errors.length === 0) &&
      outOfStockItems.length === 0;

    await captureArtifact(page, outputDir, stage4Artifacts, "02-cart-after-validate");

    const stage4CompletedAtDate = new Date();
    return {
      ...session,
      currentPage: "cart-validated",
      currentUrl: page.url(),
      validated: parsed.validationMessages.some((m) => /validated/i.test(m)),
      validationMessages: parsed.validationMessages,
      adaOrders,
      outOfStockItems,
      orderSummary,
      deliveryDates: mergedDeliveryDates,
      confirmationEmail: parsed.confirmationEmail,
      canCheckout,
      stage4StartedAt,
      stage4CompletedAt: stage4CompletedAtDate.toISOString(),
      stage4DurationMs: stage4CompletedAtDate.getTime() - stage4StartedAtDate.getTime(),
      stage4Artifacts,
    };
  };

  return withTimeout(run(), timeoutMs).catch(async (error) => {
    if (error?.code === "MILO_STAGE4_TIMEOUT") {
      const screenshotPath = await captureFailure(page, outputDir, stage4Artifacts, "error-stage4-timeout");
      error.screenshotPath = error.screenshotPath || screenshotPath;
      error.details = { ...(error.details || {}), currentUrl: page.url() };
    }
    throw error;
  });
}
