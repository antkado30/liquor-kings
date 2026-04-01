/**
 * MLCC execution operator context: optional `failure_details.mlcc_signal` (string)
 * plus enrichment rules. Does not add new top-level failure_type values (DB constraint).
 */

export const MLCC_SIGNAL = {
  LOGIN_AUTH: "login_auth",
  CONFIG_ENV: "config_env",
  SELECTOR_UI: "selector_ui",
  DRY_RUN_PREFLIGHT: "dry_run_preflight",
  MLCC_PREFLIGHT: "mlcc_preflight",
  DRY_RUN_PLAN: "dry_run_plan",
  CART_IDENTITY: "cart_identity",
  QUANTITY_RULES: "quantity_rules",
  INVENTORY: "inventory",
  BROWSER_RUNTIME: "browser_runtime",
  NETWORK_TRANSPORT: "network_transport",
};

const GUIDANCE = {
  [MLCC_SIGNAL.LOGIN_AUTH]: {
    label: "MLCC login / authentication",
    guidance:
      "Login page, credentials, or post-login landing did not match what automation expects. Verify MLCC credentials, MFA, and that the login URL still serves the expected flow. Check automation evidence (screens/diagnostics) before retry.",
  },
  [MLCC_SIGNAL.CONFIG_ENV]: {
    label: "MLCC environment configuration",
    guidance:
      "Missing or invalid MLCC URL, username, password, or related env for this worker. Fix store/env configuration; retries will not help until config is valid.",
  },
  [MLCC_SIGNAL.SELECTOR_UI]: {
    label: "Selector or UI mismatch",
    guidance:
      "Error text or stage suggests DOM/selectors or page structure drift. Treat like site/UI change: review evidence, update selectors or automation, then retry if appropriate.",
  },
  [MLCC_SIGNAL.DRY_RUN_PREFLIGHT]: {
    label: "Dry-run payload preflight",
    guidance:
      "Payload/plan validation failed before browser work (dry-run preflight). Inspect failure message and cart_verification_snapshot evidence; fix data or rules.",
  },
  [MLCC_SIGNAL.MLCC_PREFLIGHT]: {
    label: "MLCC preflight (rules / items)",
    guidance:
      "MLCC preflight reported item or quantity rule issues. Review learned_qty_rule_dump evidence and cart lines; align catalog rules before retry.",
  },
  [MLCC_SIGNAL.DRY_RUN_PLAN]: {
    label: "Dry-run plan generation",
    guidance:
      "Dry-run plan could not be built from the payload. Inspect plan errors in evidence (learned_qty_rule_dump) and correct cart or configuration.",
  },
  [MLCC_SIGNAL.CART_IDENTITY]: {
    label: "Cart / code identity",
    guidance:
      "Bottle or MLCC code does not match the deterministic cart snapshot. Reconcile bottle mapping and cart contents; do not retry blindly.",
  },
  [MLCC_SIGNAL.QUANTITY_RULES]: {
    label: "Quantity / validation rules",
    guidance:
      "Quantity or validation rules failed (including deterministic checks). Fix quantities or rules in source data; retry is unlikely to succeed until corrected.",
  },
  [MLCC_SIGNAL.INVENTORY]: {
    label: "Inventory / availability",
    guidance:
      "Failure is classified as inventory or stock related. Verify stock and cart quantities; adjust inventory or cart before retry.",
  },
  [MLCC_SIGNAL.BROWSER_RUNTIME]: {
    label: "Browser / automation runtime",
    guidance:
      "Playwright or browser session error (launch, navigation, or runtime). Check worker logs and evidence; distinguish from pure network issues. Retry may help after infra fixes.",
  },
  [MLCC_SIGNAL.NETWORK_TRANSPORT]: {
    label: "Network transport",
    guidance:
      "Classified as network/HTTP-level failure. Often transient if retry_allowed; confirm API/MLCC reachability and proxy/VPN.",
  },
};

/**
 * Merge mlcc_signal into failure_details when workers did not set it, using only
 * stored-equivalent inputs (message, stage, failure_type).
 */
export function enrichFailureDetailsWithMlccSignal({
  failureDetails,
  errorMessage,
  failureType,
}) {
  const fd = {
    ...(failureDetails && typeof failureDetails === "object" ? failureDetails : {}),
  };
  if (fd.mlcc_signal && typeof fd.mlcc_signal === "string") {
    return fd;
  }

  const msg = String(errorMessage ?? "").toLowerCase();
  const stage = fd.stage != null ? String(fd.stage) : "";

  if (msg.includes("mlcc login failed")) {
    fd.mlcc_signal = MLCC_SIGNAL.LOGIN_AUTH;
    return fd;
  }
  if (stage === "browser_config") {
    fd.mlcc_signal = MLCC_SIGNAL.CONFIG_ENV;
    return fd;
  }
  if (stage === "payload_preflight") {
    fd.mlcc_signal = MLCC_SIGNAL.DRY_RUN_PREFLIGHT;
    return fd;
  }
  if (stage === "mlcc_preflight") {
    fd.mlcc_signal = MLCC_SIGNAL.MLCC_PREFLIGHT;
    return fd;
  }
  if (stage === "mlcc_dry_run_plan") {
    fd.mlcc_signal = MLCC_SIGNAL.DRY_RUN_PLAN;
    return fd;
  }
  if (stage === "validate" && failureType === "CODE_MISMATCH") {
    fd.mlcc_signal = MLCC_SIGNAL.CART_IDENTITY;
    return fd;
  }
  if (stage === "validate" && failureType === "QUANTITY_RULE_VIOLATION") {
    fd.mlcc_signal = MLCC_SIGNAL.QUANTITY_RULES;
    return fd;
  }
  if (failureType === "OUT_OF_STOCK") {
    fd.mlcc_signal = MLCC_SIGNAL.INVENTORY;
    return fd;
  }
  if (stage === "browser_runtime") {
    fd.mlcc_signal =
      failureType === "NETWORK_ERROR"
        ? MLCC_SIGNAL.NETWORK_TRANSPORT
        : MLCC_SIGNAL.BROWSER_RUNTIME;
    return fd;
  }
  if (failureType === "MLCC_UI_CHANGE" && msg.includes("selector")) {
    fd.mlcc_signal = MLCC_SIGNAL.SELECTOR_UI;
    return fd;
  }
  return fd;
}

const asEvidenceArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Resolve mlcc_signal and whether it was stored explicitly on the row vs inferred by merge rules.
 */
export function resolveMlccSignalWithSource(run) {
  const raw =
    run?.failure_details && typeof run.failure_details === "object"
      ? run.failure_details
      : {};
  const explicit =
    typeof raw.mlcc_signal === "string" && String(raw.mlcc_signal).length > 0;
  const merged = enrichFailureDetailsWithMlccSignal({
    failureDetails: raw,
    errorMessage: run?.error_message,
    failureType: run?.failure_type,
  });
  const signal = merged.mlcc_signal ?? null;
  if (!signal) {
    return { signal: null, source: null };
  }
  return {
    signal,
    source: explicit ? "explicit" : "inferred",
  };
}

/** Short label for diagnostics (same as operator context title). */
export function getMlccSignalShortLabel(signal) {
  if (!signal || !GUIDANCE[signal]) return signal ?? "";
  return GUIDANCE[signal].label;
}

/**
 * Operator-facing MLCC context for API summaries. Null when no signal applies.
 */
export function deriveMlccOperatorContext(run) {
  if (!run || typeof run !== "object") return null;

  const fdIn =
    run.failure_details && typeof run.failure_details === "object"
      ? run.failure_details
      : {};

  const merged = enrichFailureDetailsWithMlccSignal({
    failureDetails: fdIn,
    errorMessage: run.error_message,
    failureType: run.failure_type,
  });

  const signal = merged.mlcc_signal;
  if (!signal || !GUIDANCE[signal]) return null;

  const g = GUIDANCE[signal];
  const evidence = asEvidenceArray(run.evidence);
  const kinds = [...new Set(evidence.map((e) => e?.kind).filter(Boolean))];

  return {
    mlcc_signal: signal,
    label: g.label,
    guidance: g.guidance,
    evidence_kinds: kinds.length ? kinds : undefined,
  };
}
