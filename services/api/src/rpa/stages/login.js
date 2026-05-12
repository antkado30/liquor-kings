import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { launchChromium } from "../../lib/chromium-launch.js";
import { BLOCKLIST_RE } from "../milo-discovery.js";

const DEFAULT_LOGIN_URL = "https://www.lara.michigan.gov/milo/auth/sign-in";
const DEFAULT_TIMEOUT_MS = 30_000;
const LOGIN_CLICK_TIMEOUT_MS = 15_000;
const GOTO_TIMEOUT_MS = 15_000;
const INVALID_CREDENTIALS_RE = /invalid|incorrect|wrong|not\s*found|does\s*not\s*match/i;
const CAPTCHA_RE = /captcha|recaptcha|hcaptcha/i;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_ROOT = path.resolve(__dirname, "..", "..", "..");

function timestampDirName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(
    d.getSeconds(),
  )}`;
}

function createMiloError(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
}

function ensureNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createMiloError("MILO_LOGIN_SECURITY_VIOLATION", `${fieldName} must be a non-empty string`, { fieldName });
  }
  return value.trim();
}

function assertMichiganGovHttps(urlString, fieldName) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw createMiloError("MILO_LOGIN_SECURITY_VIOLATION", `${fieldName} must be a valid URL`, { fieldName, url: urlString });
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (!host.endsWith(".michigan.gov") && host !== "michigan.gov")) {
    throw createMiloError("MILO_LOGIN_SECURITY_VIOLATION", `${fieldName} must use https://*.michigan.gov`, {
      fieldName,
      url: urlString,
      protocol: parsed.protocol,
      hostname: host,
    });
  }
  return parsed;
}

function isMichiganGovUrl(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    return host === "michigan.gov" || host.endsWith(".michigan.gov");
  } catch {
    return false;
  }
}

function withOverallTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createMiloError("MILO_LOGIN_TIMEOUT", `Login flow exceeded timeout of ${timeoutMs}ms`, { timeoutMs }));
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

async function detectCaptcha(page) {
  const selectors = ["iframe[src*='recaptcha']", "iframe[src*='hcaptcha']", ".g-recaptcha", "[class*='captcha']"];
  for (const selector of selectors) {
    if ((await page.locator(selector).count()) > 0) {
      return { detected: true, selector };
    }
  }
  const text = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 3000);
  if (CAPTCHA_RE.test(text)) {
    return { detected: true, selector: "body-text" };
  }
  return { detected: false, selector: null };
}

async function captureArtifact(page, outputDir, artifacts, baseName) {
  const bodyHtml = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('input[type="password"]').forEach((input) => {
      input.value = "";
      input.setAttribute("value", "");
    });
    return `<!DOCTYPE html>\n${clone.outerHTML}`;
  });
  const htmlPath = path.join(outputDir, `${baseName}.html`);
  const pngPath = path.join(outputDir, `${baseName}.png`);
  const urlPath = path.join(outputDir, `${baseName}.url.txt`);
  await writeFile(htmlPath, bodyHtml, "utf8");
  await page.screenshot({ path: pngPath, fullPage: true });
  await writeFile(urlPath, `${page.url()}\n`, "utf8");
  artifacts.push(htmlPath, pngPath, urlPath);
}

async function captureFailureScreenshot(page, outputDir, artifacts, baseName) {
  if (!page || !outputDir) return null;
  const screenshotPath = path.join(outputDir, `${baseName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  artifacts.push(screenshotPath);
  return screenshotPath;
}

async function findUsernameField(page) {
  const selectorsTried = [
    "input[type='email']",
    "input[name*='email' i]",
    "input[name*='user' i]",
    "label:text-matches(email|username) -> associated input",
  ];
  const direct = [
    page.locator("input[type='email']").first(),
    page.locator("input[name*='email' i]").first(),
    page.locator("input[name*='user' i]").first(),
  ];
  for (const locator of direct) {
    if ((await locator.count()) > 0) return { locator, selectorsTried };
  }

  const labelTexts = [/email/i, /username/i];
  const labels = page.locator("label");
  const labelCount = await labels.count();
  for (let i = 0; i < labelCount; i += 1) {
    const label = labels.nth(i);
    const text = (await label.innerText().catch(() => "")).trim();
    if (!labelTexts.some((re) => re.test(text))) continue;
    const forId = await label.getAttribute("for");
    if (forId) {
      const byFor = page.locator(`#${forId}`).first();
      if ((await byFor.count()) > 0) return { locator: byFor, selectorsTried };
    }
    const nestedInput = label.locator("input").first();
    if ((await nestedInput.count()) > 0) return { locator: nestedInput, selectorsTried };
  }

  return { locator: null, selectorsTried };
}

async function findPasswordField(page) {
  const locator = page.locator("input[type='password']").first();
  return { locator: (await locator.count()) > 0 ? locator : null, selectorsTried: ["input[type='password']"] };
}

async function findTermsCheckbox(page) {
  const selectorsTried = ["input[type='checkbox'] + accessible/label text matches /accept|terms|read/i"];
  const boxes = page.locator("input[type='checkbox']");
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const ariaLabel = (await box.getAttribute("aria-label")) || "";
    const id = await box.getAttribute("id");
    let labelText = "";
    if (id) {
      labelText = (await page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first().innerText().catch(() => "")) || "";
    }
    const wrapperText = (await box.locator("xpath=ancestor::*[self::label or self::div][1]").innerText().catch(() => "")) || "";
    if (/(accept|terms|read)/i.test(`${ariaLabel} ${labelText} ${wrapperText}`)) {
      return { locator: box, selectorsTried };
    }
  }
  return { locator: null, selectorsTried };
}

async function findLoginButton(page) {
  const selectorsTried = [
    "button text /^log\\s*in$|^sign\\s*in$/i",
    "input[type='submit']",
    "button[type='submit']",
  ];
  const byRole = page.getByRole("button", { name: /^(log\s*in|sign\s*in)$/i }).first();
  if ((await byRole.count()) > 0) return { locator: byRole, selectorsTried };
  const inputSubmit = page.locator("input[type='submit']").first();
  if ((await inputSubmit.count()) > 0) return { locator: inputSubmit, selectorsTried };
  const buttonSubmit = page.locator("button[type='submit']").first();
  if ((await buttonSubmit.count()) > 0) return { locator: buttonSubmit, selectorsTried };
  return { locator: null, selectorsTried };
}

function postLoginPath(urlString) {
  try {
    const p = new URL(urlString).pathname;
    if (p.includes("/milo/home")) return "/milo/home";
    if (p.includes("/milo/location")) return "/milo/location";
    return null;
  } catch {
    return null;
  }
}

export async function loginToMilo(credentials, options = {}) {
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const headless = options.headless ?? true;
  const slowMo = Number.isFinite(options.slowMo) ? Number(options.slowMo) : 250;
  const captureArtifacts = options.captureArtifacts ?? true;
  const executionRunId = options.executionRunId ? String(options.executionRunId) : null;
  const artifacts = [];
  const username = ensureNonEmptyString(credentials?.username, "credentials.username");
  const password = ensureNonEmptyString(credentials?.password, "credentials.password");
  const loginUrl = credentials?.loginUrl || DEFAULT_LOGIN_URL;
  assertMichiganGovHttps(loginUrl, "credentials.loginUrl");

  const outputDir =
    captureArtifacts === true
      ? options.outputDir
        ? path.isAbsolute(options.outputDir)
          ? options.outputDir
          : path.resolve(process.cwd(), options.outputDir)
        : path.join(API_ROOT, "rpa-output", `login-${timestampDirName()}`)
      : null;

  let browser;
  let context;
  let page;

  const runFlow = async () => {
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
    }

    try {
      browser = await launchChromium({ headless, slowMo });
      const contextOptions = {};
      if (outputDir) {
        contextOptions.recordVideo = { dir: outputDir };
        contextOptions.recordHar = { path: path.join(outputDir, "network.har"), omitContent: false };
      }
      context = await browser.newContext(contextOptions);
      page = await context.newPage();

      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS }).catch((error) => {
        throw createMiloError("MILO_LOGIN_NETWORK_ERROR", "Unable to reach MILO login page", {
          url: loginUrl,
          executionRunId,
          reason: String(error?.message || error),
        });
      });

      await page.waitForTimeout(1_000);
      if (outputDir) {
        await captureArtifact(page, outputDir, artifacts, "01-login-page");
      }

      const initialCaptcha = await detectCaptcha(page);
      if (initialCaptcha.detected) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-captcha-before-fill");
        throw createMiloError(
          "MILO_LOGIN_CAPTCHA_DETECTED",
          "CAPTCHA detected on MILO login page",
          { url: page.url(), selector: initialCaptcha.selector, executionRunId },
          screenshotPath,
        );
      }

      const usernameField = await findUsernameField(page);
      const passwordField = await findPasswordField(page);
      const termsField = await findTermsCheckbox(page);
      const loginButton = await findLoginButton(page);

      if (!usernameField.locator || !passwordField.locator || !loginButton.locator) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-form-elements-missing");
        throw createMiloError(
          "MILO_LOGIN_FORM_ELEMENTS_MISSING",
          "MILO login form elements are missing",
          {
            url: page.url(),
            selectorsTried: {
              username: usernameField.selectorsTried,
              password: passwordField.selectorsTried,
              loginButton: loginButton.selectorsTried,
            },
            executionRunId,
          },
          screenshotPath,
        );
      }
      if (!termsField.locator) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-terms-missing");
        throw createMiloError(
          "MILO_LOGIN_TERMS_CHECKBOX_MISSING",
          "Terms acceptance checkbox was not found on MILO login page",
          { url: page.url(), selectorsTried: termsField.selectorsTried, executionRunId },
          screenshotPath,
        );
      }

      await usernameField.locator.fill(username);
      await passwordField.locator.fill(password);
      await termsField.locator.check();
      const isChecked = await termsField.locator.isChecked();
      if (!isChecked) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-terms-not-checked");
        throw createMiloError(
          "MILO_LOGIN_TERMS_CHECKBOX_MISSING",
          "Terms checkbox could not be checked",
          { url: page.url(), executionRunId },
          screenshotPath,
        );
      }

      if (outputDir) {
        await captureArtifact(page, outputDir, artifacts, "02-login-filled");
      }

      const buttonText = ((await loginButton.locator.innerText().catch(async () => loginButton.locator.inputValue().catch(() => ""))) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (BLOCKLIST_RE.test(buttonText)) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-blocklist-triggered");
        throw createMiloError(
          "MILO_LOGIN_SECURITY_VIOLATION",
          "SAFE MODE blocked login click due to blocklisted text",
          { url: page.url(), buttonText, executionRunId },
          screenshotPath,
        );
      }

      const urlBeforeClick = page.url();
      await loginButton.locator.click({ timeout: LOGIN_CLICK_TIMEOUT_MS });

      try {
        await Promise.race([
          page.waitForFunction(
            (before) => {
              return window.location.href !== before;
            },
            urlBeforeClick,
            { timeout: LOGIN_CLICK_TIMEOUT_MS },
          ),
          page.waitForFunction(
            (reSource) => {
              const re = new RegExp(reSource, "i");
              const text = (document.body?.innerText || "").slice(0, 6000);
              return re.test(text);
            },
            INVALID_CREDENTIALS_RE.source,
            { timeout: LOGIN_CLICK_TIMEOUT_MS },
          ),
        ]);
      } catch {
        const captchaAfterClick = await detectCaptcha(page);
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-post-click-timeout");
        if (captchaAfterClick.detected) {
          throw createMiloError(
            "MILO_LOGIN_CAPTCHA_DETECTED",
            "CAPTCHA detected after login submit",
            { url: page.url(), selector: captchaAfterClick.selector, executionRunId },
            screenshotPath,
          );
        }
        throw createMiloError(
          "MILO_LOGIN_TIMEOUT",
          "Timed out waiting for MILO post-login route",
          { url: page.url(), timeoutMs: LOGIN_CLICK_TIMEOUT_MS, executionRunId },
          screenshotPath,
        );
      }

      const currentUrl = page.url();
      if (!isMichiganGovUrl(currentUrl)) {
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-unexpected-host");
        throw createMiloError(
          "MILO_LOGIN_SECURITY_VIOLATION",
          "Post-login redirect left michigan.gov",
          { url: currentUrl, executionRunId },
          screenshotPath,
        );
      }

      const postPath = postLoginPath(currentUrl);
      if (!postPath) {
        const stillOnLogin = currentUrl.includes("/auth/sign-in");
        const pageText = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 1500);
        if (stillOnLogin && INVALID_CREDENTIALS_RE.test(pageText)) {
          const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-invalid-credentials");
          throw createMiloError(
            "MILO_LOGIN_INVALID_CREDENTIALS",
            "MILO rejected username/password",
            {
              url: currentUrl,
              executionRunId,
              htmlSnippet: pageText.slice(0, 800),
            },
            screenshotPath,
          );
        }
        const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-unexpected-url");
        throw createMiloError(
          "MILO_LOGIN_UNEXPECTED_URL",
          "MILO routed to an unexpected URL after login",
          { url: currentUrl, executionRunId },
          screenshotPath,
        );
      }

      await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      if (outputDir) {
        await captureArtifact(page, outputDir, artifacts, "03-post-login");
      }

      const completedAtDate = new Date();
      return {
        success: true,
        browser,
        context,
        page,
        postLoginUrl: postPath,
        username,
        startedAt,
        completedAt: completedAtDate.toISOString(),
        durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
        outputDir,
        artifacts,
      };
    } catch (error) {
      if (error?.code) throw error;
      const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-unhandled");
      throw createMiloError(
        "MILO_LOGIN_NETWORK_ERROR",
        "Unexpected error during MILO login flow",
        { url: page?.url?.() || loginUrl, executionRunId, reason: String(error?.message || error) },
        screenshotPath,
      );
    }
  };

  try {
    return await withOverallTimeout(runFlow(), timeoutMs);
  } catch (error) {
    const isTimeout = error?.code === "MILO_LOGIN_TIMEOUT";
    if (isTimeout && page) {
      const screenshotPath = await captureFailureScreenshot(page, outputDir, artifacts, "error-overall-timeout");
      error.screenshotPath = error.screenshotPath || screenshotPath;
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (import.meta.url === pathToFileURL(invokedPath).href && invokedPath === modulePath) {
  // Intentionally no direct runner; use _test_login.js.
}
