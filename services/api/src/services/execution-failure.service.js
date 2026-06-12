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

export function isRetryableFailureType(type) {
  return (
    type === FAILURE_TYPE.NETWORK_ERROR || type === FAILURE_TYPE.MLCC_UI_CHANGE
  );
}
