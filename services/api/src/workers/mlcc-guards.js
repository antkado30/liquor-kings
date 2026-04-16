/**
 * MLCC Layer 2 (network) and Layer 3 (probe click text) safety guards.
 * Extracted from mlcc-browser-add-by-code-probe.js for modular reuse; behavior unchanged.
 */

/** Clicks matching these labels are never performed during the probe. */
export const MLCC_PROBE_UNSAFE_UI_TEXT = [
  /add\s*to\s*cart/i,
  /add\s*all/i,
  /checkout/i,
  /submit(\s*order)?/i,
  /place\s*order/i,
  /update\s*cart/i,
  /buy\s*now/i,
  /purchase/i,
  /complete\s*order/i,
  /confirm\s*order/i,
  /finalize/i,
];

/**
 * Layer 2: block likely order/cart mutation requests. Conservative; may be tuned per MLCC tenant.
 */
export function shouldBlockHttpRequest(url, method) {
  const m = String(method ?? "GET").toUpperCase();
  const u = String(url ?? "").toLowerCase();

  const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(m);
  if (mutation) {
    // Phase 2n / 2q may rely on these XHRs; never block even if other patterns evolve.
    if (/\/order\/apply-line\b/i.test(u) || /\/order\/validate\b/i.test(u)) {
      return { block: false };
    }

    const patterns = [
      /\/checkout/i,
      /\/cart\/add/i,
      /\/cart\/update/i,
      /\/cart\/line/i,
      /\/cart\/submit/i,
      /\/cart\/checkout\b/i,
      /\/order\/submit/i,
      /\/order\/place/i,
      /\/order\/confirm/i,
      /\/order\/final/i,
      /\/order\/complete\b/i,
      /\/order\/completion\b/i,
      /\/order\/pay\b/i,
      /\/order\/payment\b/i,
      /\/order\/capture\b/i,
      /\/order\/authorize\b/i,
      /\/order\/process\b/i,
      /\/milo\/order\/(submit|place|complete|confirm)\b/i,
      /place-order/i,
      /submit-order/i,
      /confirm-order/i,
      /final-confirmation/i,
      /\/finalize/i,
      /addtocart/i,
      /add-to-cart/i,
      /\/purchase/i,
      /\/order\/create/i,
    ];
    for (const re of patterns) {
      if (re.test(u)) {
        return { block: true, reason: `mutation_url:${re}` };
      }
    }
  }

  if (m === "GET") {
    const getPatterns = [
      /addtocart/i,
      /add-to-cart/i,
      /\/cart\/add/i,
      /\/cart\/checkout\b/i,
      /\/checkout\/confirm\b/i,
      /\/order\/complete\b/i,
    ];
    for (const re of getPatterns) {
      if (re.test(u)) {
        return { block: true, reason: `get_url:${re}` };
      }
    }
  }

  return { block: false };
}

/**
 * Layer 3: blocklist for any probe navigation click (button/link text).
 */
export function isProbeUiTextUnsafe(text) {
  if (text == null || typeof text !== "string") {
    return { unsafe: false };
  }

  const t = text.trim();

  for (const re of MLCC_PROBE_UNSAFE_UI_TEXT) {
    if (re.test(t)) {
      return { unsafe: true, matched: re.toString() };
    }
  }

  return { unsafe: false };
}

/**
 * Install route handler on browser context (call after newContext, before newPage).
 * @param {import('playwright').BrowserContext} context
 * @param {{ blockedRequestCount?: number } | null} [statsRef] — optional; increments when a request is aborted
 */
export async function installMlccSafetyNetworkGuards(context, statsRef) {
  await context.route("**/*", (route) => {
    const req = route.request();
    const { block, reason } = shouldBlockHttpRequest(req.url(), req.method());

    if (block) {
      if (statsRef && typeof statsRef === "object") {
        if (typeof statsRef.blockedRequestCount === "number") {
          statsRef.blockedRequestCount += 1;
        }
        statsRef.lastBlockedUrl = req.url();
        statsRef.lastBlockedMethod = req.method();
        statsRef.lastBlockedReason = reason;
      }

      return route.abort("blockedbyclient");
    }

    return route.continue();
  });
}
