import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BLOCKLIST_RE, clickSafely, waitForAngularStable, waitForElementEnabled, waitForSpaNavigation } from "../milo-discovery.js";
import { KNOWN_ADAS } from "../../mlcc/milo-ordering-rules.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const PRODUCTS_LOAD_TIMEOUT_MS = 20_000;
const HOME_TO_LOCATION_TIMEOUT_MS = 10_000;
const INACTIVE_RE = /inactive|suspended|expired|pending activation|provisioning/i;

/**
 * Stage 2 typed errors:
 * - MILO_STAGE2_INVALID_SESSION
 * - MILO_STAGE2_INVALID_LICENSE_NUMBER
 * - MILO_STAGE2_SECURITY_VIOLATION
 * - MILO_STAGE2_SELECT_LICENSE_LINK_NOT_VISIBLE
 * - MILO_STAGE2_LICENSE_NOT_FOUND
 * - MILO_STAGE2_LICENSE_NOT_READY
 * - MILO_STAGE2_LICENSE_NOT_ACTIVE
 * - MILO_STAGE2_PRODUCTS_LOAD_TIMEOUT
 * - MILO_STAGE2_UNEXPECTED_URL
 * - MILO_STAGE2_TIMEOUT
 */
function createStage2Error(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
}

function ensureStage2Session(session) {
  if (!session || !session.browser || !session.context || !session.page) {
    throw createStage2Error("MILO_STAGE2_INVALID_SESSION", "Session is missing required Playwright handles", {
      requiredFields: ["browser", "context", "page"],
      presentFields: session ? Object.keys(session) : [],
    });
  }
}

function ensureLicenseNumber(licenseNumber) {
  if (typeof licenseNumber !== "string" || licenseNumber.trim() === "" || !/^\d+$/.test(licenseNumber.trim())) {
    throw createStage2Error("MILO_STAGE2_INVALID_LICENSE_NUMBER", "licenseNumber must be a non-empty numeric string", {
      provided: licenseNumber,
    });
  }
  return licenseNumber.trim();
}

function assertMichiganGov(urlValue, code = "MILO_STAGE2_SECURITY_VIOLATION") {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw createStage2Error(code, "Invalid URL encountered during Stage 2", { currentUrl: urlValue });
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "michigan.gov" && !host.endsWith(".michigan.gov")) {
    throw createStage2Error(code, "Stage 2 refused non-michigan.gov host", { currentUrl: urlValue, hostname: host });
  }
  return parsed;
}

function toIsoDate(mdyyyy) {
  const match = String(mdyyyy || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function captureArtifact(page, outputDir, artifacts, baseName) {
  if (!outputDir) return;
  const html = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('input[type="password"]').forEach((el) => {
      el.value = "";
      el.setAttribute("value", "");
    });
    return `<!DOCTYPE html>\n${clone.outerHTML}`;
  });
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

function withOverallTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        createStage2Error("MILO_STAGE2_TIMEOUT", `Stage 2 exceeded timeout budget of ${timeoutMs}ms`, {
          timeoutMs,
        }),
      );
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

async function findLicenseCard(page, licenseNumber) {
  const titles = page.locator("div.location-card-title");
  const titleCount = await titles.count();
  const availableLicenses = [];
  for (let i = 0; i < titleCount; i += 1) {
    const text = ((await titles.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (text) availableLicenses.push(text);
    if (text !== licenseNumber) continue;

    const titleLocator = titles.nth(i);
    const cardLocator = titleLocator.locator("xpath=ancestor::div[.//button[normalize-space()='Place Order']][1]").first();
    if ((await cardLocator.count()) === 0) continue;
    const placeOrderButton = cardLocator.locator("button:has-text('Place Order')").first();
    const buttonText = ((await placeOrderButton.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    const indicatorText = ((await cardLocator.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    const friendlyName = await cardLocator
      .evaluate((card, target) => {
        const candidates = [...card.querySelectorAll(":scope > div")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        return candidates.find((txt) => txt !== target && !/^\d+$/.test(txt) && !/place\s*order/i.test(txt)) || "";
      }, licenseNumber)
      .catch(() => "");
    return {
      found: true,
      availableLicenses,
      cardLocator,
      placeOrderButton,
      friendlyName,
      indicatorText,
      buttonText,
    };
  }
  return { found: false, availableLicenses };
}

async function parseDeliveryDates(page) {
  const aliasMap = {
    "141": KNOWN_ADAS["141"] || "Imperial Beverage Company",
    "221": KNOWN_ADAS["221"] || "General Wine & Liquor",
    "321": KNOWN_ADAS["321"] || "NWS Michigan",
  };
  const result = await page.evaluate((aliases) => {
    const bodyText = (document.body?.innerText || "").replace(/\r/g, "");
    const cleanLines = bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const canonical = {
      "141": /imperial\s+beverage/i,
      "221": /general\s+wine/i,
      "321": /nws\s+michigan/i,
    };
    const dates = {};
    const dateRe = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;

    const firstIndexFor = (regex) => cleanLines.findIndex((line) => regex.test(line));
    for (const [ada, regex] of Object.entries(canonical)) {
      const idx = firstIndexFor(regex);
      if (idx < 0) continue;
      const searchWindow = cleanLines.slice(idx, idx + 8).join(" ");
      const match = searchWindow.match(dateRe);
      if (match) dates[ada] = match[0];
    }

    return {
      rawBannerText: cleanLines.slice(0, 250).join(" | "),
      parsed: dates,
      aliases,
    };
  }, aliasMap);

  const iso = {};
  for (const ada of ["141", "221", "321"]) {
    iso[ada] = toIsoDate(result.parsed[ada]);
  }
  return { rawBannerText: result.rawBannerText, iso };
}

async function waitForDeliveryDatesLoaded(page, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { loadingPresent, datesPresent } = await page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      return {
        loadingPresent: /loading your delivery dates/i.test(text),
        datesPresent: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(text),
      };
    });
    if (!loadingPresent && datesPresent) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

export async function navigateToProducts(session, options = {}) {
  ensureStage2Session(session);
  const licenseNumber = ensureLicenseNumber(options.licenseNumber);
  const stage2StartedAtDate = new Date();
  const stage2StartedAt = stage2StartedAtDate.toISOString();
  const captureArtifacts = options.captureArtifacts ?? true;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const placeOrderReadyTimeoutMs = Number.isFinite(options.placeOrderReadyTimeoutMs)
    ? Number(options.placeOrderReadyTimeoutMs)
    : DEFAULT_READY_TIMEOUT_MS;
  const stage2Artifacts = [];
  const outputDir =
    captureArtifacts === true
      ? options.outputDir
        ? path.isAbsolute(options.outputDir)
          ? options.outputDir
          : path.resolve(process.cwd(), options.outputDir)
        : session.outputDir
          ? path.join(session.outputDir, "stage2")
          : null
      : null;

  const run = async () => {
    const page = session.page;
    if (outputDir) await mkdir(outputDir, { recursive: true });

    try {
      const initialUrl = page.url();
      assertMichiganGov(initialUrl);

      if (initialUrl.includes("/milo/home")) {
        const selectors = [
          "a[aria-label*='select a license' i]",
          ".navbar__help-text a[href*='/milo/location']",
          "a[href*='/milo/location']:not(.dropdown-item)",
        ];
        let licenseLink = null;
        let selectedSelector = null;
        for (const selector of selectors) {
          const candidates = page.locator(selector);
          const count = await candidates.count();
          for (let i = 0; i < count; i += 1) {
            const candidate = candidates.nth(i);
            const visible = await candidate.isVisible().catch(() => false);
            if (!visible) continue;
            const className = (await candidate.getAttribute("class").catch(() => "")) || "";
            if (/\bdropdown-item\b/.test(className)) continue;
            licenseLink = candidate;
            selectedSelector = selector;
            break;
          }
          if (licenseLink) break;
        }

        if (!licenseLink) {
          const linksFound = await page.evaluate(() => {
            return [...document.querySelectorAll("a[href*='/milo/location']")].map((a) => {
              const rect = a.getBoundingClientRect();
              const style = window.getComputedStyle(a);
              const visible =
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                parseFloat(style.opacity || "1") > 0 &&
                rect.width > 0 &&
                rect.height > 0;
              return {
                href: a.getAttribute("href") || "",
                className: a.className || "",
                ariaLabel: a.getAttribute("aria-label") || "",
                text: (a.textContent || "").replace(/\s+/g, " ").trim(),
                visible,
                bounds: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              };
            });
          });
          const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-home-link-not-visible");
          throw createStage2Error(
            "MILO_STAGE2_SELECT_LICENSE_LINK_NOT_VISIBLE",
            "Could not find a visible 'select a license' link on /milo/home",
            { currentUrl: page.url(), selectorsTried: selectors, linksFound },
            screenshotPath,
          );
        }

        await clickSafely(page, licenseLink, {
          step: "2a-home-to-location",
          selectorNote: `select a license from home page (${selectedSelector})`,
        });
        await waitForSpaNavigation(
          page,
          "/milo/location",
          ["div.location-card-title", "text=/Your Licenses/i"],
          HOME_TO_LOCATION_TIMEOUT_MS,
          "stage2-home-to-location",
        );
      } else if (initialUrl.includes("/milo/location")) {
        await waitForAngularStable(page, 10_000);
      } else {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-unexpected-entry-url");
        throw createStage2Error(
          "MILO_STAGE2_UNEXPECTED_URL",
          "Stage 2 expected to start on /milo/home or /milo/location",
          { currentUrl: initialUrl },
          screenshotPath,
        );
      }

      assertMichiganGov(page.url());
      await captureArtifact(page, outputDir, stage2Artifacts, "01-license-page");

      const cardMeta = await findLicenseCard(page, licenseNumber);
      if (!cardMeta.found) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-license-not-found");
        throw createStage2Error(
          "MILO_STAGE2_LICENSE_NOT_FOUND",
          `License ${licenseNumber} was not found on /milo/location`,
          { currentUrl: page.url(), licenseNumber, availableLicenses: cardMeta.availableLicenses || [] },
          screenshotPath,
        );
      }

      if (INACTIVE_RE.test(cardMeta.indicatorText || "")) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-license-inactive");
        throw createStage2Error(
          "MILO_STAGE2_LICENSE_NOT_ACTIVE",
          `License ${licenseNumber} appears inactive`,
          { currentUrl: page.url(), licenseNumber, indicatorText: (cardMeta.indicatorText || "").slice(0, 500) },
          screenshotPath,
        );
      }

      const cardScope = cardMeta.cardLocator;
      const placeOrderButton = cardMeta.placeOrderButton || cardScope.locator("button:has-text('Place Order')").first();
      if ((await placeOrderButton.count()) === 0) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-place-order-missing");
        throw createStage2Error(
          "MILO_STAGE2_LICENSE_NOT_READY",
          "Matched license card did not contain a Place Order button",
          { currentUrl: page.url(), licenseNumber, cardSelector: "ancestor::div[.//button[normalize-space()='Place Order']][1]" },
          screenshotPath,
        );
      }

      let readyInfo;
      try {
        readyInfo = await waitForElementEnabled(page, placeOrderButton, placeOrderReadyTimeoutMs);
      } catch (error) {
        const buttonState = await placeOrderButton
          .evaluate((el) => ({
            disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
            hasSpinner: Boolean(el.querySelector(".spinner-border")),
            text: (el.textContent || "").replace(/\s+/g, " ").trim(),
            outerHtmlSnippet: (el.outerHTML || "").slice(0, 500),
          }))
          .catch(() => null);
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-license-not-ready");
        throw createStage2Error(
          "MILO_STAGE2_LICENSE_NOT_READY",
          "Place Order button did not become enabled before timeout",
          {
            currentUrl: page.url(),
            licenseNumber,
            placeOrderReadyTimeoutMs,
            buttonState,
            buttonStateDisabledAttr: buttonState?.disabled ?? null,
            buttonHasSpinner: buttonState?.hasSpinner ?? null,
            waitedMs: placeOrderReadyTimeoutMs,
            reason: String(error?.message || error),
          },
          screenshotPath,
        );
      }

      const placeOrderText = ((await placeOrderButton.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      const blockedCoreAction = /checkout|validate|submit|confirm order/i.test(placeOrderText);
      if (blockedCoreAction) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-blocked-click");
        throw createStage2Error(
          "MILO_STAGE2_SECURITY_VIOLATION",
          "Blocked click due to unsafe action text",
          { currentUrl: page.url(), buttonText: placeOrderText },
          screenshotPath,
        );
      }
      if (!/place\s*order/i.test(placeOrderText) && BLOCKLIST_RE.test(placeOrderText)) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-blocklist-mismatch");
        throw createStage2Error(
          "MILO_STAGE2_SECURITY_VIOLATION",
          "Blocked click due to BLOCKLIST_RE safety check",
          { currentUrl: page.url(), buttonText: placeOrderText },
          screenshotPath,
        );
      }

      await clickSafely(page, placeOrderButton, {
        step: "2b-location-place-order",
        selectorNote: `license ${licenseNumber} place order`,
        allowPlaceOrderLicenseNav: true,
        msWaitedForReady: readyInfo?.msWaited || 0,
      });

      await captureArtifact(page, outputDir, stage2Artifacts, "02-place-order-clicked");

      try {
        await waitForSpaNavigation(
          page,
          "/milo/products",
          "input[placeholder*='Search for products' i]",
          PRODUCTS_LOAD_TIMEOUT_MS,
          "stage2-location-to-products",
        );
      } catch (error) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-products-timeout");
        throw createStage2Error(
          "MILO_STAGE2_PRODUCTS_LOAD_TIMEOUT",
          "Timed out waiting for /milo/products to load",
          { currentUrl: page.url(), timeoutMs: PRODUCTS_LOAD_TIMEOUT_MS, reason: String(error?.message || error) },
          screenshotPath,
        );
      }

      await page
        .locator("text=/license validated/i")
        .first()
        .waitFor({ state: "hidden", timeout: 3_000 })
        .catch(async () => {
          await page.waitForTimeout(2_000);
        });
      await waitForAngularStable(page, 10_000).catch(async () => {
        await page.waitForTimeout(2_000);
      });

      const currentUrl = page.url();
      const parsedUrl = assertMichiganGov(currentUrl, "MILO_STAGE2_UNEXPECTED_URL");
      if (parsedUrl.pathname !== "/milo/products") {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-not-products");
        throw createStage2Error(
          "MILO_STAGE2_UNEXPECTED_URL",
          "Stage 2 did not land on /milo/products",
          { currentUrl },
          screenshotPath,
        );
      }
      const hasSearch = await page.locator("input[placeholder*='Search for products' i]").first().isVisible().catch(() => false);
      if (!hasSearch) {
        const screenshotPath = await captureFailure(page, outputDir, stage2Artifacts, "error-products-search-missing");
        throw createStage2Error(
          "MILO_STAGE2_UNEXPECTED_URL",
          "Products page search input is missing",
          { currentUrl },
          screenshotPath,
        );
      }

      const deliveryLoaded = await waitForDeliveryDatesLoaded(page, 10_000);
      const delivery = await parseDeliveryDates(page);
      const parsedAllDeliveryDates = Boolean(delivery.iso["141"] && delivery.iso["221"] && delivery.iso["321"]);
      const deliveryDatesWarning = !deliveryLoaded || !parsedAllDeliveryDates;
      if (deliveryDatesWarning) {
        console.warn("[stage2] Delivery dates unavailable on /milo/products (best-effort only); continuing to Stage 3.", {
          reason: !deliveryLoaded ? "Delivery dates still loading after 10s" : "Dates loaded but format unrecognized",
          currentUrl,
          deliveryDatesParsed: delivery.iso,
          rawBannerText: delivery.rawBannerText,
        });
      }

      const normalizedDeliveryDates = deliveryDatesWarning
        ? { "141": null, "221": null, "321": null }
        : {
            "141": delivery.iso["141"],
            "221": delivery.iso["221"],
            "321": delivery.iso["321"],
          };

      await captureArtifact(page, outputDir, stage2Artifacts, "03-products-ready");

      const stage2CompletedAtDate = new Date();
      return {
        ...session,
        currentPage: "products",
        currentUrl,
        selectedLicense: {
          number: licenseNumber,
          friendlyName: cardMeta.friendlyName || "",
        },
        deliveryDates: normalizedDeliveryDates,
        deliveryDatesWarning,
        stage2StartedAt,
        stage2CompletedAt: stage2CompletedAtDate.toISOString(),
        stage2DurationMs: stage2CompletedAtDate.getTime() - stage2StartedAtDate.getTime(),
        stage2Artifacts,
      };
    } catch (error) {
      if (error?.code) throw error;
      const screenshotPath = await captureFailure(session.page, outputDir, stage2Artifacts, "error-unhandled-stage2");
      throw createStage2Error(
        "MILO_STAGE2_UNEXPECTED_URL",
        "Unexpected Stage 2 navigation error",
        { currentUrl: session.page?.url?.() || null, reason: String(error?.message || error) },
        screenshotPath,
      );
    }
  };

  return withOverallTimeout(run(), timeoutMs).catch(async (error) => {
    if (error?.code === "MILO_STAGE2_TIMEOUT") {
      const screenshotPath = await captureFailure(session.page, outputDir, stage2Artifacts, "error-stage2-timeout");
      error.screenshotPath = error.screenshotPath || screenshotPath;
      error.details = {
        ...(error.details || {}),
        currentUrl: session.page?.url?.() || null,
      };
    }
    throw error;
  });
}
