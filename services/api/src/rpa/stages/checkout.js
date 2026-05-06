import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;

function createStage5Error(code, message, details = {}, screenshotPath = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  err.screenshotPath = screenshotPath;
  return err;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createStage5Error("MILO_STAGE5_TIMEOUT", `Stage 5 exceeded timeout budget of ${timeoutMs}ms`, { timeoutMs }));
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

function inferAdaNumberFromName(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("imperial beverage")) return "141";
  if (n.includes("general wine")) return "221";
  if (n.includes("nws michigan")) return "321";
  return null;
}

function validateStage5Session(session) {
  const requiredFields = ["browser", "context", "page", "currentUrl", "validated", "canCheckout", "adaOrders", "orderSummary", "outputDir"];
  if (!session || typeof session !== "object") {
    throw createStage5Error("MILO_STAGE5_INVALID_SESSION", "Stage 5 requires a valid Stage 4 session object", {
      requiredFields,
      receivedType: typeof session,
    });
  }
  const missingFields = requiredFields.filter((field) => !(field in session));
  if (missingFields.length > 0) {
    throw createStage5Error("MILO_STAGE5_INVALID_SESSION", "Session missing required Stage 4 fields", {
      requiredFields,
      missingFields,
      presentFields: Object.keys(session),
    });
  }
  const pageLike =
    session.page &&
    typeof session.page.url === "function" &&
    typeof session.page.locator === "function" &&
    typeof session.page.screenshot === "function" &&
    typeof session.page.evaluate === "function";
  if (!pageLike || !session.browser || !session.context) {
    throw createStage5Error("MILO_STAGE5_INVALID_SESSION", "Session missing required Playwright handles", {
      hasBrowser: Boolean(session.browser),
      hasContext: Boolean(session.context),
      hasPage: Boolean(session.page),
    });
  }
  if (typeof session.currentUrl !== "string") {
    throw createStage5Error("MILO_STAGE5_INVALID_SESSION", "Session currentUrl must be a string", {
      currentUrlType: typeof session.currentUrl,
    });
  }
  if (typeof session.outputDir !== "string" || session.outputDir.trim() === "") {
    throw createStage5Error("MILO_STAGE5_INVALID_SESSION", "Session outputDir must be a non-empty string", {
      outputDirType: typeof session.outputDir,
      outputDir: session.outputDir,
    });
  }
}

function countCartItems(adaOrders) {
  return (adaOrders || []).reduce((sum, ada) => sum + ((ada?.items || []).length || 0), 0);
}

async function locateCheckoutButton(page) {
  const candidates = page.locator("app-cart-confirm button.btn-primary[type='button']");
  const count = await candidates.count();
  const matched = [];
  const observed = [];

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const textRaw = ((await candidate.textContent().catch(() => "")) || "").replace(/\s+/g, " ");
    const text = textRaw.trim();
    const visible = await candidate.isVisible().catch(() => false);
    const enabled = await candidate.isEnabled().catch(() => false);
    const className = (await candidate.getAttribute("class").catch(() => "")) || "";
    observed.push({ index: i, text, visible, enabled, className });

    if (text === "Checkout" && visible) {
      if (!enabled) {
        throw createStage5Error("MILO_STAGE5_CHECKOUT_BUTTON_DISABLED", "Checkout button is visible but disabled", {
          index: i,
          text,
          className,
        });
      }
      matched.push(candidate);
    }
  }

  if (matched.length === 0) {
    throw createStage5Error("MILO_STAGE5_CHECKOUT_BUTTON_NOT_FOUND", "Could not find exactly one enabled Checkout button in app-cart-confirm", {
      selector: "app-cart-confirm button.btn-primary[type='button']",
      observed,
    });
  }
  if (matched.length > 1) {
    throw createStage5Error("MILO_STAGE5_CHECKOUT_BUTTON_AMBIGUOUS", "Found multiple enabled Checkout button candidates", {
      selector: "app-cart-confirm button.btn-primary[type='button']",
      matchedCount: matched.length,
      observed,
    });
  }

  return matched[0];
}

function buildDryRunReason(mode, allowOrderSubmission, envAllowSubmission) {
  const failed = [];
  if (mode !== "submit") failed.push("mode must be 'submit'");
  if (allowOrderSubmission !== true) failed.push("allowOrderSubmission must be true");
  if (envAllowSubmission !== "yes") failed.push("LK_ALLOW_ORDER_SUBMISSION must equal 'yes'");
  return failed.join("; ");
}

async function clickCheckoutButtonSafely(page, button, outputDir, artifacts, session) {
  const currentUrl = page.url();
  if (!currentUrl.includes("/milo/cart")) {
    throw createStage5Error("MILO_STAGE5_SAFETY_GATE_VIOLATION", "Refusing Checkout click outside /milo/cart", { currentUrl });
  }
  if (session?.canCheckout !== true) {
    throw createStage5Error("MILO_STAGE5_SAFETY_GATE_VIOLATION", "Refusing Checkout click because session.canCheckout is not true", {
      currentUrl,
      canCheckout: session?.canCheckout,
    });
  }

  const buttonText = ((await button.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (buttonText !== "Checkout") {
    throw createStage5Error("MILO_STAGE5_SAFETY_GATE_VIOLATION", "Refusing Checkout click due to text mismatch", {
      currentUrl,
      buttonText,
    });
  }

  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  if (!visible) {
    throw createStage5Error("MILO_STAGE5_SAFETY_GATE_VIOLATION", "Refusing Checkout click because button is not visible", {
      currentUrl,
      buttonText,
    });
  }
  if (!enabled) {
    throw createStage5Error("MILO_STAGE5_CHECKOUT_BUTTON_DISABLED", "Refusing Checkout click because button is disabled", {
      currentUrl,
      buttonText,
    });
  }

  await captureArtifact(page, outputDir, artifacts, "01b-checkout-preclick-forensic");
  await button.click({ force: false });
  await captureArtifact(page, outputDir, artifacts, "01c-checkout-postclick-forensic");
}

async function waitForCheckoutConfirmation(page, timeoutMs = DEFAULT_TIMEOUT_MS, outputDir = null, artifacts = []) {
  const startedAt = Date.now();
  let lastState = { currentUrl: page.url(), bodyTail: "" };

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const successToastMessages = [...document.querySelectorAll(".toast-message, .toast-title")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((msg) => msg && !/(error|failed|unable|invalid|denied)/i.test(msg));
        const errorToastMessages = [...document.querySelectorAll(".toast-message, .toast-title, .toast-error, .alert-danger, .text-danger")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((msg) => msg && /(error|failed|unable|invalid|denied)/i.test(msg));
        const confirmationCandidates = [...new Set((bodyText.match(/\b\d{4,}\b/g) || []).filter((n) => n.length >= 6))];
        return {
          bodyText,
          successToastMessages,
          errorToastMessages,
          confirmationCandidates,
          currentUrl: window.location.href,
        };
      });

      lastState = {
        currentUrl: state.currentUrl || page.url(),
        bodyTail: String(state.bodyText || "").slice(-12_000),
      };
      const urlLooksSubmitted = /\/milo\/orders|\/milo\/account\/orders/i.test(lastState.currentUrl);
      if (state.confirmationCandidates.length > 0 || state.successToastMessages.length > 0 || urlLooksSubmitted) {
        await captureArtifact(page, outputDir, artifacts, "02-after-checkout-click");
        return {
          confirmed: true,
          currentUrl: lastState.currentUrl,
          successToastMessages: state.successToastMessages,
          errorToastMessages: state.errorToastMessages,
          confirmationCandidates: state.confirmationCandidates,
          waitedMs: Date.now() - startedAt,
        };
      }
      await page.waitForTimeout(500);
    } catch (error) {
      throw createStage5Error("MILO_STAGE5_NETWORK_ERROR", "Error while waiting for checkout confirmation", {
        currentUrl: page.url(),
        reason: String(error?.message || error),
      });
    }
  }

  await captureArtifact(page, outputDir, artifacts, "02-after-checkout-click").catch(() => {});
  throw createStage5Error("MILO_STAGE5_CONFIRMATION_TIMEOUT", "Timed out waiting for checkout confirmation signals", {
    timeoutMs,
    currentUrl: page.url(),
    bodyTail: lastState.bodyTail,
  });
}

function parseTimestampTextToIso(timestampText) {
  if (!timestampText) return null;
  const maybeIso = new Date(timestampText);
  if (!Number.isNaN(maybeIso.getTime())) return maybeIso.toISOString();
  const mdy = String(timestampText).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i);
  if (!mdy) return null;
  const month = Number(mdy[1]) - 1;
  const day = Number(mdy[2]);
  const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
  let hour = mdy[4] ? Number(mdy[4]) : 0;
  const minute = mdy[5] ? Number(mdy[5]) : 0;
  const ampm = (mdy[6] || "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const date = new Date(year, month, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function parseConfirmationState(page, session) {
  const parsed = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const successToastMessages = [...document.querySelectorAll(".toast-message, .toast-title")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((msg) => msg && !/(error|failed|unable|invalid|denied)/i.test(msg));
    const errorToastMessages = [...document.querySelectorAll(".toast-message, .toast-title, .toast-error, .alert-danger, .text-danger")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((msg) => msg && /(error|failed|unable|invalid|denied)/i.test(msg));

    const globalConfirmationNumbers = [...new Set((bodyText.match(/\b\d{6,}\b/g) || []).map((n) => n.trim()))];
    const confirmationsByAda = [];

    const adaNameSpans = [...document.querySelectorAll("span.ada-name")];
    adaNameSpans.forEach((nameSpan) => {
      const adaName = (nameSpan.textContent || "").replace(/\s+/g, " ").trim();
      let container = nameSpan.closest(".row")?.parentElement || nameSpan.closest(".d-block") || nameSpan.parentElement || document.body;
      const nearbyText = (container?.textContent || "").replace(/\s+/g, " ").trim();
      const match = nearbyText.match(/confirmation\s*#?\s*:?\s*(\d{4,})/i);
      confirmationsByAda.push({
        adaName,
        confirmationNumber: match ? match[1] : null,
      });
    });

    const emailFromInput =
      document.querySelector("app-cart-confirm input[type='email']")?.getAttribute("value") ||
      document.querySelector("input[type='email']")?.getAttribute("value") ||
      null;
    const emailFromTextMatch = bodyText.match(
      /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/,
    );
    const confirmationEmail = emailFromInput || (emailFromTextMatch ? emailFromTextMatch[1] : null);

    const timestampMatch =
      bodyText.match(/submitted\s*(on|at)?\s*:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}(?:\s+[0-9]{1,2}:[0-9]{2}(?:\s*(?:AM|PM))?)?)/i) ||
      bodyText.match(/order\s*date\s*:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}(?:\s+[0-9]{1,2}:[0-9]{2}(?:\s*(?:AM|PM))?)?)/i) ||
      bodyText.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-Z]{4,})/);
    const submittedTimestampRaw = timestampMatch ? (timestampMatch[2] || timestampMatch[1] || null) : null;

    return {
      bodyText,
      currentUrl: window.location.href,
      successToastMessages: [...new Set(successToastMessages)],
      errorToastMessages: [...new Set(errorToastMessages)],
      globalConfirmationNumbers,
      confirmationsByAda,
      confirmationEmail,
      submittedTimestampRaw,
    };
  });

  const confirmationNumbers = {};
  for (const ada of session.adaOrders || []) {
    const adaNumber = String(ada?.adaNumber || "").trim();
    const adaName = String(ada?.adaName || "").trim();
    let matched = null;

    const byName = (parsed.confirmationsByAda || []).find((entry) =>
      entry.adaName &&
      adaName &&
      entry.adaName.toLowerCase().includes(adaName.toLowerCase().slice(0, Math.min(adaName.length, 12))),
    );
    if (byName?.confirmationNumber) {
      matched = byName.confirmationNumber;
    }

    if (!matched) {
      const byNumberGuess = (parsed.confirmationsByAda || []).find((entry) => inferAdaNumberFromName(entry.adaName) === adaNumber);
      if (byNumberGuess?.confirmationNumber) {
        matched = byNumberGuess.confirmationNumber;
      }
    }

    confirmationNumbers[adaNumber || adaName || `ada_${Object.keys(confirmationNumbers).length + 1}`] = matched || null;
  }

  if (Object.keys(confirmationNumbers).length === 0 && (session.adaOrders || []).length === 0) {
    confirmationNumbers.default = parsed.globalConfirmationNumbers[0] || null;
  }

  const hasParsedConfirmation = Object.values(confirmationNumbers).some((value) => Boolean(value));
  const urlChangedToOrders = /\/milo\/orders|\/milo\/account\/orders/i.test(parsed.currentUrl || "");
  const hasSuccessToast = (parsed.successToastMessages || []).length > 0;

  if (!hasParsedConfirmation && !urlChangedToOrders && !hasSuccessToast) {
    throw createStage5Error("MILO_STAGE5_CONFIRMATION_PARSE_FAILED", "Could not parse post-checkout confirmation state", {
      currentUrl: parsed.currentUrl,
      confirmationNumbers,
      successToastMessages: parsed.successToastMessages,
      errorToastMessages: parsed.errorToastMessages,
      bodyTail: String(parsed.bodyText || "").slice(-12_000),
    });
  }

  return {
    confirmationNumbers,
    submittedTimestamp: parseTimestampTextToIso(parsed.submittedTimestampRaw) || new Date().toISOString(),
    confirmationEmail: parsed.confirmationEmail || null,
    successToastMessages: parsed.successToastMessages || [],
    errorToastMessages: parsed.errorToastMessages || [],
    currentUrl: parsed.currentUrl || page.url(),
  };
}

export async function checkoutOnMilo(session, options = {}) {
  validateStage5Session(session);

  const page = session.page;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const stage5StartedAtDate = new Date();
  const stage5Artifacts = [];
  const outputDir = session.outputDir ? path.join(session.outputDir, "stage5") : null;

  const run = async () => {
    if (outputDir) await mkdir(outputDir, { recursive: true });

    const currentUrl = page.url();
    if (!session.currentUrl.includes("/milo/cart") || !currentUrl.includes("/milo/cart")) {
      throw createStage5Error("MILO_STAGE5_WRONG_URL", "Stage 5 requires /milo/cart in both session and live page URL", {
        sessionCurrentUrl: session.currentUrl,
        currentUrl,
      });
    }
    if (session.validated !== true) {
      throw createStage5Error("MILO_STAGE5_NOT_VALIDATED", "Stage 5 requires a cart validated by Stage 4", {
        validated: session.validated,
      });
    }
    if (session.canCheckout !== true) {
      throw createStage5Error("MILO_STAGE5_CART_NOT_CHECKOUTABLE", "Stage 5 requires canCheckout=true from Stage 4", {
        canCheckout: session.canCheckout,
      });
    }
    if (!Array.isArray(session.adaOrders) || session.adaOrders.length === 0 || countCartItems(session.adaOrders) === 0) {
      throw createStage5Error("MILO_STAGE5_EMPTY_CART", "Stage 5 requires a non-empty validated cart", {
        adaOrdersCount: Array.isArray(session.adaOrders) ? session.adaOrders.length : 0,
        itemsCount: Array.isArray(session.adaOrders) ? countCartItems(session.adaOrders) : 0,
      });
    }

    await captureArtifact(page, outputDir, stage5Artifacts, "00-stage5-entry");
    await appendAction(outputDir, {
      stage: "stage5",
      action: "entry",
      ts: new Date().toISOString(),
      currentUrl,
      ada_count: session.adaOrders.length,
      items_count: countCartItems(session.adaOrders),
    });

    const checkoutButton = await locateCheckoutButton(page);
    await captureArtifact(page, outputDir, stage5Artifacts, "01-checkout-ready");
    await appendAction(outputDir, {
      stage: "stage5",
      action: "checkout_button_located",
      ts: new Date().toISOString(),
      ada_count: session.adaOrders.length,
      items_count: countCartItems(session.adaOrders),
      gross_total: session.orderSummary?.grossTotal ?? null,
      net_total: session.orderSummary?.netTotal ?? null,
    });

    const requestedMode = options.mode === "submit" ? "submit" : "dry_run";
    const envGateValue = process.env.LK_ALLOW_ORDER_SUBMISSION;
    const liveSubmissionAllowed =
      requestedMode === "submit" &&
      options.allowOrderSubmission === true &&
      envGateValue === "yes";

    if (!liveSubmissionAllowed) {
      const dryRunReason = buildDryRunReason(requestedMode, options.allowOrderSubmission, envGateValue);
      await appendAction(outputDir, {
        stage: "stage5",
        mode: "dry_run",
        action: "submission_blocked",
        ts: new Date().toISOString(),
        reason: dryRunReason,
      });
      const completedAtDate = new Date();
      return {
        ...session,
        stage5DurationMs: completedAtDate.getTime() - stage5StartedAtDate.getTime(),
        submitted: false,
        mode: "dry_run",
        confirmationNumbers: null,
        submittedTimestamp: null,
        successToastMessages: [],
        errorToastMessages: [],
        confirmationEmail: session.confirmationEmail || null,
        currentUrl: page.url(),
        outputDir,
        dryRunReason,
        stage5Artifacts,
      };
    }

    await clickCheckoutButtonSafely(page, checkoutButton, outputDir, stage5Artifacts, session);
    await waitForCheckoutConfirmation(page, timeoutMs, outputDir, stage5Artifacts);
    const parsed = await parseConfirmationState(page, session);
    await captureArtifact(page, outputDir, stage5Artifacts, "03-stage5-final");

    await appendAction(outputDir, {
      stage: "stage5",
      action: "checkout_submitted",
      mode: "submit",
      ts: new Date().toISOString(),
      confirmationNumbers: parsed.confirmationNumbers,
      submittedTimestamp: parsed.submittedTimestamp,
    });

    const completedAtDate = new Date();
    return {
      ...session,
      stage5DurationMs: completedAtDate.getTime() - stage5StartedAtDate.getTime(),
      submitted: true,
      mode: "submit",
      confirmationNumbers: parsed.confirmationNumbers,
      submittedTimestamp: parsed.submittedTimestamp,
      successToastMessages: parsed.successToastMessages,
      errorToastMessages: parsed.errorToastMessages,
      confirmationEmail: parsed.confirmationEmail,
      currentUrl: parsed.currentUrl,
      outputDir,
      stage5Artifacts,
    };
  };

  return withTimeout(run(), timeoutMs).catch(async (error) => {
    if (error?.code === "MILO_STAGE5_TIMEOUT") {
      const screenshotPath = await captureFailure(page, outputDir, stage5Artifacts, "error-stage5-timeout");
      error.screenshotPath = error.screenshotPath || screenshotPath;
      error.details = { ...(error.details || {}), currentUrl: page.url() };
    } else if (!error?.code) {
      const screenshotPath = await captureFailure(page, outputDir, stage5Artifacts, "error-stage5-unhandled");
      throw createStage5Error(
        "MILO_STAGE5_NETWORK_ERROR",
        "Unexpected Stage 5 failure during checkout submission",
        { currentUrl: page.url(), reason: String(error?.message || error) },
        screenshotPath,
      );
    }
    throw error;
  });
}
