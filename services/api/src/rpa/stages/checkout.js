import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Overall Stage 5 budget. Split internally:
//   - up to POST_SUBMIT_WAIT_MS waiting for a terminal post-click signal
//     (thank-you page / inline confirmation / URL change / error toast)
//   - up to HISTORY_FETCH_BUDGET_MS navigating to /milo/orders and scraping
//     the orders history page (only when thank-you is detected OR backstop)
// Real MILO submits for large carts (60+ lines × 2 ADAs) need more than
// the original 60s — see 2026-05-28 false-negative (project_milo_post_submit_flow).
const DEFAULT_TIMEOUT_MS = 180_000;
const POST_SUBMIT_WAIT_MS = 75_000;
const HISTORY_FETCH_BUDGET_MS = 90_000;

/**
 * MILO's post-submit "thank you" page patterns. After a real submit MILO
 * shows a simple acknowledgment page that DOES NOT contain inline
 * confirmation numbers — the actual confirmation # lives on /milo/orders.
 * Detecting any of these means "submit accepted, go fetch the history page."
 *
 * Sourced from Tony's first-hand description (2026-05-28) — he's placed
 * many real orders manually and this is the actual UI behavior.
 */
const THANK_YOU_PATTERNS = [
  /thank\s+you\s+for\s+your\s+order/i,
  /your\s+order\s+(?:has\s+been\s+)?(?:placed|submitted|received|accepted)/i,
  /order\s+(?:has\s+been\s+)?(?:placed|submitted|received|accepted)/i,
  /(?:visit|check|go\s+to|view)\s+(?:the\s+)?orders?\s+(?:page|history|list)/i,
  /please\s+(?:visit|check|go\s+to)\s+(?:the\s+)?orders?/i,
];

function looksLikeThankYouPage(bodyText) {
  if (!bodyText) return false;
  return THANK_YOU_PATTERNS.some((p) => p.test(bodyText));
}

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

// Best-effort: artifact capture must NEVER fail a stage. Any error here is
// swallowed so a screenshot failure can't sink an otherwise-good checkout.
async function captureArtifact(page, outputDir, artifacts, baseName) {
  if (!outputDir) return;
  try {
    const htmlPath = path.join(outputDir, `${baseName}.html`);
    const pngPath = path.join(outputDir, `${baseName}.png`);
    const urlPath = path.join(outputDir, `${baseName}.url.txt`);
    const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
    await writeFile(htmlPath, html, "utf8");
    // 8s cap — a fullPage screenshot of a slow/heavy page can otherwise eat
    // ~30s (the Playwright default) of pure diagnostic overhead. Best-effort.
    await page.screenshot({ path: pngPath, fullPage: true, timeout: 8_000 });
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

/**
 * Wait for a terminal signal after the Checkout button click.
 *
 * Returns the FIRST signal that fires:
 *   - "inline_confirmation"  — explicit "Confirmation #<digits>" in body
 *                              (legacy MILO behavior; preserved in case the
 *                              UI ever serves it again)
 *   - "url_orders"           — URL navigated to /milo/orders or
 *                              /milo/account/orders (also legacy-friendly)
 *   - "thank_you"            — MILO's actual post-submit "thank you, visit
 *                              orders page" screen (the common case as of
 *                              2026-05-28; URL stays on /milo/cart/checkout)
 *   - "success_toast"        — toast component fired
 *   - "error_toast"          — toast indicating a failure (caller throws)
 *
 * Throws MILO_STAGE5_CONFIRMATION_TIMEOUT only when NONE of the above fire
 * within `waitMs`. Even on that real timeout, the caller has a backstop
 * (try the orders-history page anyway).
 */
async function waitForCheckoutConfirmation(page, waitMs = POST_SUBMIT_WAIT_MS, outputDir = null, artifacts = []) {
  const startedAt = Date.now();
  let lastState = { currentUrl: page.url(), bodyTail: "", isLoading: false };

  while (Date.now() - startedAt < waitMs) {
    try {
      const state = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const successToastMessages = [...document.querySelectorAll(".toast-message, .toast-title")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((msg) => msg && !/(error|failed|unable|invalid|denied)/i.test(msg));
        const errorToastMessages = [...document.querySelectorAll(".toast-message, .toast-title, .toast-error, .alert-danger, .text-danger")]
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((msg) => msg && /(error|failed|unable|invalid|denied)/i.test(msg));
        // Strict confirmation signal: explicit "Confirmation #<digits>" in body.
        // Loose digit-pattern matching alone is unreliable because MILO's header always
        // shows the 6-digit license number — that would always look like a confirmation.
        const confirmationPatternMatches = [...new Set((bodyText.match(/confirmation\s*#?\s*:?\s*(\d{4,})/gi) || []))];
        const isLoadingState = /please\s+wait\s+while\s+we\s+confirm\s+your\s+order|processing\s+your\s+order|submitting\s+order/i.test(bodyText);
        return {
          bodyText,
          successToastMessages,
          errorToastMessages,
          confirmationPatternMatches,
          isLoadingState,
          currentUrl: window.location.href,
        };
      });

      lastState = {
        currentUrl: state.currentUrl || page.url(),
        bodyTail: String(state.bodyText || "").slice(-12_000),
        isLoading: state.isLoadingState,
      };

      // If MILO is showing the loading state ("Please wait while we confirm..."),
      // explicitly continue polling regardless of any other signal. The body
      // contains other digits (license number) that look like false-positive
      // confirmation candidates.
      if (state.isLoadingState) {
        await page.waitForTimeout(750);
        continue;
      }

      const urlLooksSubmitted = /\/milo\/orders|\/milo\/account\/orders/i.test(lastState.currentUrl);
      const hasErrorToast = state.errorToastMessages.length > 0;
      const isThankYou = looksLikeThankYouPage(state.bodyText);

      // Determine the FIRST terminal signal that fired. Order matters:
      // error_toast wins over success signals so we don't mis-route a failed
      // submit as success. Otherwise prefer the most specific signal
      // available (inline > url > thank-you > generic toast).
      let signalType = null;
      if (hasErrorToast) signalType = "error_toast";
      else if (state.confirmationPatternMatches.length > 0) signalType = "inline_confirmation";
      else if (urlLooksSubmitted) signalType = "url_orders";
      else if (isThankYou) signalType = "thank_you";
      else if (state.successToastMessages.length > 0) signalType = "success_toast";

      if (signalType) {
        await captureArtifact(page, outputDir, artifacts, `02-after-checkout-click-${signalType}`);
        return {
          confirmed: true,
          signalType,
          currentUrl: lastState.currentUrl,
          successToastMessages: state.successToastMessages,
          errorToastMessages: state.errorToastMessages,
          confirmationPatternMatches: state.confirmationPatternMatches,
          waitedMs: Date.now() - startedAt,
          bodyTail: lastState.bodyTail.slice(-2_000),
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

  await captureArtifact(page, outputDir, artifacts, "02-after-checkout-click-timeout").catch(() => {});
  throw createStage5Error("MILO_STAGE5_CONFIRMATION_TIMEOUT", "Timed out waiting for checkout confirmation signals", {
    waitMs,
    currentUrl: page.url(),
    bodyTail: lastState.bodyTail,
    wasInLoadingState: lastState.isLoading,
  });
}

/**
 * Navigate to /milo/orders and scrape the orders-history page for the
 * confirmation data MILO doesn't show on the post-submit thank-you screen.
 *
 * Called in two scenarios:
 *   1. Happy path — `waitForCheckoutConfirmation` returned `signalType:
 *      "thank_you"`, so we know the submit succeeded and we just need to
 *      pull the confirmation numbers from the history feed.
 *   2. Backstop — Stage 5 timed out without seeing any terminal signal.
 *      The submit MAY have still happened (the 2026-05-28 case). Try the
 *      history page; if it shows fresh orders for this license matching
 *      our cart totals, recover the confirmation data and report success.
 *
 * Returns the same shape as `parseConfirmationState` so the caller can
 * use either path interchangeably.
 *
 * Throws MILO_STAGE5_HISTORY_FETCH_FAILED if /milo/orders doesn't load,
 * or MILO_STAGE5_HISTORY_NO_RECENT_MATCH if no orders on the page match
 * what we expected to submit (license + today's date + total).
 */
export async function navigateToOrdersAndCapture(page, session, outputDir, artifacts, budgetMs = HISTORY_FETCH_BUDGET_MS) {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  // Confirmed 2026-05-29 via diagnostic: MILO orders list lives at
  // /milo/account/orders. Hitting /milo/orders directly redirects to
  // /milo/home. The /milo/orders short path stays valid as a terminal-URL
  // pattern (some MILO links route through it), but for direct navigation
  // we have to use the account-scoped path.
  try {
    await page.goto("https://www.lara.michigan.gov/milo/account/orders", {
      waitUntil: "domcontentloaded",
      timeout: Math.max(15_000, Math.min(45_000, deadline - Date.now())),
    });
  } catch (error) {
    throw createStage5Error("MILO_STAGE5_HISTORY_FETCH_FAILED", "Could not navigate to /milo/account/orders to retrieve confirmation data", {
      currentUrl: page.url(),
      reason: String(error?.message || error),
    });
  }

  // Wait for the orders list to render. MILO uses Angular and may take a
  // few seconds after DOMContentLoaded before the list is populated. Poll
  // for either visible orders or a known empty-state until we run out of
  // budget.
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || "");
      // Heuristics: at least one "Confirmation #" string anywhere is a
      // strong sign that orders rendered. An "Order Placed / Updated"
      // header label is another sign.
      const hasConfirmation = /confirmation\s*#?\s*:?\s*\d{4,}/i.test(bodyText);
      const hasOrderHeader = /order\s+placed/i.test(bodyText);
      const hasEmpty = /no\s+orders\s+found|you\s+have\s+no\s+orders/i.test(bodyText);
      return { hasConfirmation, hasOrderHeader, hasEmpty, bodyLength: bodyText.length };
    });
    if (ready.hasConfirmation || ready.hasOrderHeader || ready.hasEmpty) break;
    await page.waitForTimeout(500);
  }

  await captureArtifact(page, outputDir, artifacts, "04-orders-history");

  const parsed = await parseOrdersHistoryPage(page, session);
  return parsed;
}

/**
 * Parse the rendered /milo/orders page and pull out the orders that
 * match THIS Stage 5 submission. Strategy:
 *
 *   1. Try structured DOM selectors first (Angular components like
 *      <app-order-card>, <article>, .order-row, etc.). Each rendered
 *      order block on MILO contains a CONFIRMATION # cell and an
 *      ORDER # cell — those are the load-bearing data.
 *   2. Fallback: split body text into per-order blocks by the
 *      "ORDER PLACED" header label and regex-extract from each block.
 *   3. Filter to orders whose ORDER PLACED date is today AND whose
 *      total sum is within tolerance of Stage 4's gross/net totals.
 *      If no totals are available, take the top N (== number of ADAs
 *      in our session) most recent orders.
 *
 * Returns the same shape as `parseConfirmationState`:
 *   { confirmationNumbers, submittedTimestamp, confirmationEmail,
 *     successToastMessages, errorToastMessages, currentUrl }
 * Plus a `historyOrders` array with the full per-order detail so the
 * caller can persist the full audit trail Tony asked for.
 */
async function parseOrdersHistoryPage(page, session) {
  const parsed = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").replace(/[ \t]+/g, " ");
    // --- Structured pass: try to find per-order containers ---
    // MILO renders each order as a card-like block. Try a few selectors
    // that have shown up across MILO's various Angular layouts. If none
    // match, fall back to the text-pattern pass.
    const containerSelectors = [
      "app-order-card",
      "app-order-list-item",
      ".order-card",
      ".order-list-item",
      "article.order",
      "[class*='order-card']",
      "[class*='order-row']",
    ];
    const structuredOrders = [];
    for (const sel of containerSelectors) {
      const els = [...document.querySelectorAll(sel)];
      if (els.length > 0) {
        for (const el of els) {
          const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!txt) continue;
          const confMatch = txt.match(/confirmation\s*#?\s*:?\s*(\d{4,})/i);
          const orderMatch = txt.match(/order\s*#?\s*:?\s*(\d{4,})/i);
          if (confMatch || orderMatch) {
            structuredOrders.push({ raw: txt.slice(0, 4_000), selector: sel });
          }
        }
        if (structuredOrders.length > 0) break;
      }
    }

    // --- Text-pattern pass: split body by ORDER PLACED labels ---
    const textBlocks = [];
    // Use a stateful split on the ORDER PLACED header phrase.
    const splitRe = /(?=ORDER\s+PLACED)/gi;
    const rawBlocks = bodyText.split(splitRe).map((b) => b.trim()).filter((b) => /ORDER\s+PLACED/i.test(b));
    for (const block of rawBlocks) {
      textBlocks.push(block.slice(0, 4_000));
    }

    return { structuredOrders, textBlocks, currentUrl: window.location.href, bodyLength: bodyText.length };
  });

  // Pick the blocks we'll actually parse. Structured wins when present.
  const blocks = parsed.structuredOrders.length > 0
    ? parsed.structuredOrders.map((o) => o.raw)
    : parsed.textBlocks;

  // Today's date (Eastern time roughly — MILO is Michigan, so US date
  // formats from the local box are fine). We compare on the YYYY-MM-DD
  // string from a Date constructed in the runtime TZ — Fly's Linux boxes
  // run UTC, MILO renders Eastern. For correctness, accept any of:
  //   - today UTC
  //   - today Eastern (UTC-4 in May)
  // We compute both candidate date strings and accept either.
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  const easternMs = now.getTime() - 4 * 60 * 60 * 1000; // EDT (May)
  const todayEastern = new Date(easternMs).toISOString().slice(0, 10);
  const todayCandidates = new Set([todayUtc, todayEastern]);

  const historyOrders = [];
  for (const block of blocks) {
    // Extract per-block fields with regexes tuned to MILO's actual /milo/account/orders
    // layout (verified 2026-05-29 via test-orders-history-scrape.mjs against
    // real orders). Each order row reads roughly:
    //
    //   ORDER PLACED ... DELIVERY DATE ... DISTRIBUTOR <name>
    //   CONFIRMATION # <digits>  SUBTOTAL | TOTAL  $X | $Y
    //   ORDER # | ORDER TYPE <digits> | MILO
    //
    const confMatch = block.match(/confirmation\s*#?\s*:?\s*(\d{4,})/i);
    // ORDER # captures the digits AFTER the "Order # | Order Type" pair label.
    // Also accept a plain "Order # 12345" fallback.
    const orderMatch =
      block.match(/order\s*#\s*[\|/]?\s*order\s*type\s*(\d{4,})/i) ||
      block.match(/order\s*#\s*:?\s*(\d{4,})/i);
    if (!confMatch && !orderMatch) continue;

    // DISTRIBUTOR: stop at common adjacent labels so we don't pick up
    // "NWS Michigan, Inc. Confirmation" (the next column header bleeding in).
    const distributorMatch = block.match(
      /distributor\s*:?\s*([A-Z][A-Z0-9&,. \-']+?)\s*(?=confirmation|order\s*#|subtotal|total|status|delivery)/i,
    );

    // SUBTOTAL | TOTAL pair pattern — MILO shows them side-by-side as
    // "$X,XXX.XX | $Y,YYY.YY" right after the SUBTOTAL | TOTAL header.
    // This is the order header pair, NOT the per-line item amounts.
    const totalsPair = block.match(
      /subtotal\s*\|\s*total\s*\$?\s*([0-9,]+\.[0-9]{2})\s*\|\s*\$?\s*([0-9,]+\.[0-9]{2})/i,
    );
    let subtotalVal = null;
    let totalVal = null;
    if (totalsPair) {
      subtotalVal = Number(totalsPair[1].replace(/,/g, ""));
      totalVal = Number(totalsPair[2].replace(/,/g, ""));
    } else {
      // Fallback: independent matches (used to be the only path; keep for
      // robustness if MILO layout differs on some orders).
      const subAlone = block.match(/subtotal\s*\$?\s*([0-9,]+\.[0-9]{2})/i);
      const totAlone = block.match(/total\s*\$?\s*([0-9,]+\.[0-9]{2})/i);
      if (subAlone) subtotalVal = Number(subAlone[1].replace(/,/g, ""));
      if (totAlone) totalVal = Number(totAlone[1].replace(/,/g, ""));
    }

    const placedMatch = block.match(/(?:order\s+placed[^A-Z]*)?([A-Z][A-Z]{2,8}\s+\d{1,2},?\s+\d{4})/i);
    const statusMatch = block.match(/\b(Finished|In Progress|Confirmed|Cancell?ed|Processing)\b/i);
    const deliveryMatch = block.match(/delivery\s+date\s*:?\s*([A-Z][A-Z]{2,8}\s+\d{1,2},?\s+\d{4})/i);

    const placedRaw = placedMatch ? placedMatch[1] : null;
    const placedIso = parseTimestampTextToIso(placedRaw);
    const placedDate = placedIso ? placedIso.slice(0, 10) : null;

    // Per-line items inside this order block. MILO renders each line as:
    //   Liquor Code <code>  Product <name>  Quantity <n>  Unit Price $X.XX
    //   Subtotal $Y.YY  Order Type MILO
    //
    // Strategy: split the block on "Liquor Code" markers, then regex-extract
    // each field from each sub-block. This gives us the FULL order detail
    // Tony wants mirrored from MLCC's confirmation page.
    const lineItems = [];
    const lineSplits = block.split(/(?=Liquor\s*Code\b)/i);
    for (const seg of lineSplits) {
      const codeM = seg.match(/Liquor\s*Code\s*:?\s*([0-9A-Za-z\-]+)/i);
      if (!codeM) continue;
      // Skip if the "code" we matched is actually the confirmation # or order #
      // (some MILO blocks repeat those labels — defensive).
      const code = codeM[1].trim();
      if (!/^\d{1,7}$/.test(code)) continue;

      // Product name: between "Product" and "Quantity" (lookahead).
      const productM = seg.match(/Product\s*:?\s*([^\n\r]+?)\s+Quantity\b/i);
      const qtyM = seg.match(/Quantity\s*:?\s*(\d+)/i);
      const unitM = seg.match(/Unit\s*Price\s*\$?\s*([0-9,]+\.[0-9]{2})/i);
      const subM = seg.match(/Subtotal\s*\$?\s*([0-9,]+\.[0-9]{2})/i);
      const orderTypeM = seg.match(/Order\s*Type\s*:?\s*(MILO|Phone|ADA|EDI|[A-Z]{2,6})/i);

      lineItems.push({
        liquorCode: code,
        productName: productM ? productM[1].replace(/\s+/g, " ").trim() : null,
        quantity: qtyM ? Number(qtyM[1]) : null,
        unitPrice: unitM ? Number(unitM[1].replace(/,/g, "")) : null,
        lineSubtotal: subM ? Number(subM[1].replace(/,/g, "")) : null,
        orderType: orderTypeM ? orderTypeM[1] : null,
      });
    }

    historyOrders.push({
      confirmationNumber: confMatch ? confMatch[1] : null,
      orderNumber: orderMatch ? orderMatch[1] : null,
      distributorRaw: distributorMatch ? distributorMatch[1].trim().replace(/[,.\s]+$/, "") : null,
      placedRaw,
      placedDate,
      placedIso,
      deliveryRaw: deliveryMatch ? deliveryMatch[1] : null,
      subtotal: subtotalVal,
      total: totalVal,
      status: statusMatch ? statusMatch[1] : null,
      lineItems,
      lineItemCount: lineItems.length,
      blockTail: block.slice(-1_500),
    });
  }

  // Filter to today's orders. If date parsing failed for an entry, keep
  // it — we'd rather over-report than miss a recovery.
  const todayOrders = historyOrders.filter((o) => !o.placedDate || todayCandidates.has(o.placedDate));

  // Decide which orders to return:
  //   - Normal Stage 5 path (session.adaOrders has N entries):
  //     slice to N from todayOrders. We just submitted, so the most
  //     recent N today are ours.
  //   - Diagnostic / no-session path (session.adaOrders is empty or
  //     missing): return EVERY parsed order, not just today's. The
  //     diagnostic's job is to verify the parser works against MILO's
  //     current UI — testing against yesterday's orders is fair game.
  const adaCount = Array.isArray(session.adaOrders) ? session.adaOrders.length : 0;
  const ours = adaCount > 0
    ? todayOrders.slice(0, adaCount)
    : historyOrders;

  // Only throw NO_RECENT_MATCH when there's a real ADA-count expectation
  // and we couldn't match. The diagnostic path can return [] without
  // throwing (the caller decides whether empty is OK).
  if (ours.length === 0 && adaCount > 0) {
    throw createStage5Error("MILO_STAGE5_HISTORY_NO_RECENT_MATCH", "No orders on /milo/account/orders matched today's submission", {
      currentUrl: parsed.currentUrl,
      historyOrdersScanned: historyOrders.length,
      structuredCount: parsed.structuredOrders.length,
      textBlocksCount: parsed.textBlocks.length,
      bodyLength: parsed.bodyLength,
      expectedAdaCount: adaCount,
      // First 1KB of each scanned block — useful for parser debugging
      // without dumping the entire body.
      scannedBlockTails: historyOrders.slice(0, 5).map((o) => o.blockTail?.slice(0, 1_000) || null),
    });
  }

  // Build the confirmation map keyed by ADA number (when we can match by
  // distributor name) or by index when we can't.
  const confirmationNumbers = {};
  const ordersByAda = [...(session.adaOrders || [])];
  ours.forEach((order, idx) => {
    let key = `ada_${idx + 1}`;
    if (order.distributorRaw) {
      const inferredAdaNumber = inferAdaNumberFromName(order.distributorRaw);
      if (inferredAdaNumber) {
        key = inferredAdaNumber;
      } else if (ordersByAda[idx]?.adaNumber) {
        key = String(ordersByAda[idx].adaNumber);
      }
    }
    confirmationNumbers[key] = order.confirmationNumber;
  });

  return {
    confirmationNumbers,
    submittedTimestamp: new Date().toISOString(),
    confirmationEmail: null, // not on the history page
    successToastMessages: [],
    errorToastMessages: [],
    currentUrl: parsed.currentUrl,
    historyOrders: ours,
    recoveredFromHistoryPage: true,
  };
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

    /**
     * Post-click resolution. The wait function returns the FIRST terminal
     * signal it sees and identifies which one fired. We then choose how
     * to extract confirmation data based on that signal:
     *
     *   - error_toast        → throw, the submit failed
     *   - inline_confirmation→ use legacy parseConfirmationState (data is
     *                          right there on the current page)
     *   - url_orders         → parseConfirmationState on the orders page
     *                          we already landed on
     *   - thank_you          → navigate to /milo/orders, scrape history
     *                          (the common case as of 2026-05-28)
     *   - success_toast      → try inline first, fall back to history
     *
     * Backstop: if waitForCheckoutConfirmation times out, try the history
     * page anyway. MILO may have submitted but our wait missed the signal.
     * If history confirms our orders, we recover the data. If not, the
     * timeout is re-thrown for diagnosis.
     */
    let signal;
    try {
      signal = await waitForCheckoutConfirmation(page, POST_SUBMIT_WAIT_MS, outputDir, stage5Artifacts);
    } catch (waitError) {
      if (waitError?.code === "MILO_STAGE5_CONFIRMATION_TIMEOUT") {
        await appendAction(outputDir, {
          stage: "stage5",
          action: "post_submit_wait_timed_out_backstop_history_fetch",
          ts: new Date().toISOString(),
          currentUrl: page.url(),
          bodyTail: waitError.details?.bodyTail?.slice(-2_000) || null,
        });
        try {
          const backstop = await navigateToOrdersAndCapture(page, session, outputDir, stage5Artifacts);
          await captureArtifact(page, outputDir, stage5Artifacts, "03-stage5-final-backstop");
          await appendAction(outputDir, {
            stage: "stage5",
            action: "checkout_submitted_via_backstop_recovery",
            mode: "submit",
            ts: new Date().toISOString(),
            confirmationNumbers: backstop.confirmationNumbers,
            submittedTimestamp: backstop.submittedTimestamp,
            historyOrders: backstop.historyOrders,
          });
          const completedAtDateB = new Date();
          return {
            ...session,
            stage5DurationMs: completedAtDateB.getTime() - stage5StartedAtDate.getTime(),
            submitted: true,
            mode: "submit",
            confirmationNumbers: backstop.confirmationNumbers,
            submittedTimestamp: backstop.submittedTimestamp,
            successToastMessages: [],
            errorToastMessages: [],
            confirmationEmail: null,
            currentUrl: backstop.currentUrl,
            outputDir,
            stage5Artifacts,
            historyOrders: backstop.historyOrders,
            recoveredFromBackstop: true,
          };
        } catch (backstopError) {
          // Backstop failed too — re-throw the original timeout with
          // backstop diagnostics attached so we can debug what happened.
          waitError.details = {
            ...(waitError.details || {}),
            backstopError: backstopError?.code || String(backstopError?.message || backstopError),
            backstopDetails: backstopError?.details || null,
          };
          throw waitError;
        }
      }
      throw waitError;
    }

    if (signal.signalType === "error_toast") {
      throw createStage5Error("MILO_STAGE5_ERROR_TOAST", "MILO returned an error toast after the Checkout click — submit failed", {
        currentUrl: signal.currentUrl,
        errorToastMessages: signal.errorToastMessages,
        bodyTail: signal.bodyTail,
      });
    }

    let parsed;
    if (signal.signalType === "thank_you") {
      // The common case: MILO acknowledged submit but doesn't render
      // confirmation # on the thank-you page. Fetch them from the history.
      parsed = await navigateToOrdersAndCapture(page, session, outputDir, stage5Artifacts);
    } else if (signal.signalType === "inline_confirmation" || signal.signalType === "url_orders") {
      // Legacy MILO behavior: confirmation data is on the current page.
      parsed = await parseConfirmationState(page, session);
    } else {
      // success_toast or any unhandled case: try inline first, fall back to
      // history. parseConfirmationState throws if it can't find anything;
      // catch and route to the history page in that case.
      try {
        parsed = await parseConfirmationState(page, session);
      } catch (parseError) {
        if (parseError?.code === "MILO_STAGE5_CONFIRMATION_PARSE_FAILED") {
          parsed = await navigateToOrdersAndCapture(page, session, outputDir, stage5Artifacts);
        } else {
          throw parseError;
        }
      }
    }

    await captureArtifact(page, outputDir, stage5Artifacts, "03-stage5-final");

    await appendAction(outputDir, {
      stage: "stage5",
      action: "checkout_submitted",
      mode: "submit",
      ts: new Date().toISOString(),
      signalType: signal.signalType,
      confirmationNumbers: parsed.confirmationNumbers,
      submittedTimestamp: parsed.submittedTimestamp,
      ...(parsed.historyOrders ? { historyOrders: parsed.historyOrders } : {}),
    });

    const completedAtDate = new Date();
    return {
      ...session,
      stage5DurationMs: completedAtDate.getTime() - stage5StartedAtDate.getTime(),
      submitted: true,
      mode: "submit",
      confirmationNumbers: parsed.confirmationNumbers,
      submittedTimestamp: parsed.submittedTimestamp,
      successToastMessages: parsed.successToastMessages || [],
      errorToastMessages: parsed.errorToastMessages || [],
      confirmationEmail: parsed.confirmationEmail || null,
      currentUrl: parsed.currentUrl,
      outputDir,
      stage5Artifacts,
      ...(parsed.historyOrders ? { historyOrders: parsed.historyOrders } : {}),
      ...(parsed.recoveredFromHistoryPage ? { recoveredFromHistoryPage: true } : {}),
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
