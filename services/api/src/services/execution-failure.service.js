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
  const normalizedExplicit = normalizeFailureType(explicitType);
  if (normalizedExplicit) {
    return normalizedExplicit;
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
