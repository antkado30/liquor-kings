export const FAILURE_TYPE = {
  CODE_MISMATCH: "CODE_MISMATCH",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  QUANTITY_RULE_VIOLATION: "QUANTITY_RULE_VIOLATION",
  MLCC_UI_CHANGE: "MLCC_UI_CHANGE",
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN: "UNKNOWN",
};

const ALL_FAILURE_TYPES = new Set(Object.values(FAILURE_TYPE));

export function normalizeFailureType(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return ALL_FAILURE_TYPES.has(v) ? v : null;
}

export function classifyFailureType({ errorMessage, explicitType }) {
  /*
    Explicit UNKNOWN means "caller has no type" — it must NOT short-circuit
    message classification below (found 2026-06-12: worker call sites pass
    `?? FAILURE_TYPE.UNKNOWN`, which made the message sniffing dead code on
    every untyped error). UNKNOWN remains the final fallback, not a verdict.
  */
  const normalizedExplicit = normalizeFailureType(explicitType);
  if (normalizedExplicit && normalizedExplicit !== FAILURE_TYPE.UNKNOWN) {
    return normalizedExplicit;
  }

  /*
    Preserve the RPA stages' rich typed vocabulary (2026-06-12, the
    worker-wedge incident). The stages throw precisely-typed codes —
    MILO_LOGIN_NETWORK_ERROR, MILO_LOGIN_INVALID_CREDENTIALS, LK_DECRYPT_
    FAILED, … — but this function only recognized the 6 legacy enum values
    and flattened everything else to UNKNOWN at the recording boundary.
    Result: 29 consecutive identical failures recorded as "UNKNOWN" with
    nothing actionable in the UI or Command Deck. Boundary contract
    (doctrine #1): a typed code crossing this boundary survives verbatim.
    Only well-formed SCREAMING_SNAKE codes pass; arbitrary strings still
    fall through to message classification below.
  */
  if (typeof explicitType === "string") {
    const v = explicitType.trim().toUpperCase();
    if (v && v !== "UNKNOWN" && /^[A-Z][A-Z0-9_]{3,64}$/.test(v)) {
      return v;
    }
  }

  const msg = String(errorMessage ?? "").toLowerCase();

  if (msg.includes("mlcc login failed")) {
    return FAILURE_TYPE.MLCC_UI_CHANGE;
  }

  if (
    msg.includes("code_mismatch") ||
    msg.includes("mlcc_item_not_found") ||
    msg.includes("missing mlcc code")
  ) {
    return FAILURE_TYPE.CODE_MISMATCH;
  }
  if (msg.includes("out of stock") || msg.includes("insufficient inventory")) {
    return FAILURE_TYPE.OUT_OF_STOCK;
  }
  if (
    msg.includes("quantity") ||
    msg.includes("rule") ||
    msg.includes("positive integer")
  ) {
    return FAILURE_TYPE.QUANTITY_RULE_VIOLATION;
  }
  if (
    msg.includes("selector") ||
    msg.includes("login failed") ||
    msg.includes("ui changed")
  ) {
    return FAILURE_TYPE.MLCC_UI_CHANGE;
  }
  if (
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("econn") ||
    msg.includes("fetch failed") ||
    msg.includes("503") ||
    msg.includes("502")
  ) {
    return FAILURE_TYPE.NETWORK_ERROR;
  }
  return FAILURE_TYPE.UNKNOWN;
}

/*
 * Should a failed run be auto-retried?
 *
 * 2026-06-24 (the "validate never works on a flaky MILO" incident). The retry
 * machinery (max_retries=2) was effectively DEAD: this function only matched
 * the two coarse legacy labels (NETWORK_ERROR, MLCC_UI_CHANGE), but the RPA
 * stages throw — and classifyFailureType above now preserves verbatim —
 * SPECIFIC codes (MILO_STAGE2_SELECT_LICENSE_LINK_NOT_VISIBLE,
 * MILO_STAGE3_TIMEOUT, MILO_LOGIN_NETWORK_ERROR, …). None matched, so every
 * transient MILO stumble failed permanently with retry_count=0. On a slow
 * MILO that meant roughly half of multi-item validates died with no 2nd try
 * (observed: 7 fails / 10 runs, every one a different transient stage).
 *
 * Model: retry a TRANSIENT infrastructure/UI/network stumble (re-running may
 * well succeed). NEVER retry a deterministic business failure (same input →
 * same answer, just slower) or anything submit-side (re-running a submit risks
 * a DOUBLE ORDER). The deny-list is checked FIRST so it wins over the broad
 * transient patterns — e.g. MLCC_ITEM_NOT_FOUND contains "NOT_FOUND" but is a
 * deterministic code mismatch; MILO_STAGE5_INVALID_SESSION contains "SESSION"
 * but is submit-side and must never auto-retry.
 */

// Deterministic / business / submit-side — NEVER auto-retry. Checked first.
const NON_RETRYABLE_SUBSTRINGS = [
  // Submit-side: re-running could place a SECOND real order. Hard no.
  "STAGE5", "CHECKOUT", "SUBMIT", "PLACE_ORDER", "REAPED",
  // Auth / security: retrying won't help and can lock the MLCC account.
  "INVALID_CREDENTIAL", "CAPTCHA", "SECURITY_VIOLATION", "DECRYPT",
  // Login: login.js ALREADY retries network blips internally (maxAttempts +
  // RETRYABLE_LOGIN_CODES). A run-level retry on top just re-hammers MILO's
  // login — which is exactly what throttles the account on a heavy day
  // (2026-06-24: 20+ cold logins from repeated validates -> login failures).
  // Let login self-heal; never pile a full-pipeline retry on a login failure.
  "MILO_LOGIN",
  // Deterministic cart / business rules: same cart → same failure.
  "BELOW_9L", "NINE_LITER", "INVALID_SPLIT", "SPLIT_QUANT",
  "OUT_OF_STOCK", "INSUFFICIENT_INVENTORY",
  "CODE_MISMATCH", "ITEM_NOT_FOUND", "QUANTITY_RULE",
];

// Transient infrastructure / flaky-MILO / not-yet-rendered — worth a retry.
const RETRYABLE_SUBSTRINGS = [
  "NETWORK", "TIMEOUT", "ETIMEDOUT", "ECONN", "FETCH_FAILED",
  "502", "503", "504",
  "NAV_FAILED", "NAVIGATION",
  "NOT_VISIBLE", "NOT_FOUND", "NOT_PRESENT", "MISSING",
  "FINALIZATION", "STABILIZ",
  "SESSION", "TARGET_CLOSED", "DISCONNECT", "CRASH",
  "CART_CLEAR_FAILED", "PARSE_FAILED", "UI_CHANGE",
];

export function isRetryableFailureType(type) {
  const t = String(type ?? "").toUpperCase();
  if (!t) return false;
  // Deny-list wins (submit-side + deterministic business failures).
  if (NON_RETRYABLE_SUBSTRINGS.some((s) => t.includes(s))) return false;
  // Legacy coarse types (kept explicit for clarity; patterns below also cover).
  if (t === FAILURE_TYPE.NETWORK_ERROR || t === FAILURE_TYPE.MLCC_UI_CHANGE) {
    return true;
  }
  // Transient infrastructure / UI / network stumbles.
  return RETRYABLE_SUBSTRINGS.some((s) => t.includes(s));
}
