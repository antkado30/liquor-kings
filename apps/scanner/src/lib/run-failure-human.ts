/**
 * humanizeRunFailure — one human sentence for every RPA run failure.
 *
 * Quality mandate (2026-06-12, born from the 2026-06-10 real order):
 * "MLCC validate finished as failed" after a 4-minute grind, with no
 * explanation, is itself a failure. Every failure must state its reason
 * in one sentence a store owner understands, and suggest the one action
 * that helps.
 *
 * The server has always sent failure_type + failure_message — this maps
 * the known vocabulary (services/api/src/rpa stage failure types) to
 * premium, human copy. Unknown types fall back to an honest generic line
 * that still shows the raw detail.
 */

export type HumanFailure = {
  /** One sentence: what happened, in store-owner language. */
  sentence: string;
  /** What tapping "Try again" should do — informs button copy. */
  action: "retry" | "check_credentials" | "contact_support";
};

const EXACT: Record<string, HumanFailure> = {
  MILO_LOGIN_NETWORK_ERROR: {
    sentence: "Couldn't reach MILO — their site looks slow or down. Usually clears in a minute.",
    action: "retry",
  },
  MILO_LOGIN_TIMEOUT: {
    sentence: "MILO took too long to respond on sign-in. Their site is slow right now.",
    action: "retry",
  },
  MILO_LOGIN_INVALID_CREDENTIALS: {
    sentence: "MILO rejected your MLCC sign-in. Check your credentials in Settings.",
    action: "check_credentials",
  },
  MILO_LOGIN_CAPTCHA_DETECTED: {
    sentence: "MILO is showing a security check we can't pass automatically. Try again shortly.",
    action: "retry",
  },
  MILO_LOGIN_SECURITY_VIOLATION: {
    sentence: "MILO flagged the sign-in for a security check. Try again in a few minutes.",
    action: "retry",
  },
  MILO_LOGIN_TERMS_CHECKBOX_MISSING: {
    sentence: "MILO's sign-in page changed and we couldn't complete it. We're on it — try again shortly.",
    action: "retry",
  },
  MILO_LOGIN_FORM_ELEMENTS_MISSING: {
    sentence: "MILO's sign-in page changed and we couldn't complete it. We're on it — try again shortly.",
    action: "retry",
  },
  MILO_LOGIN_UNEXPECTED_URL: {
    sentence: "MILO sent us somewhere unexpected during sign-in. Try again shortly.",
    action: "retry",
  },
  LK_DECRYPT_FAILED: {
    sentence: "We couldn't unlock your saved MLCC credentials. Re-enter them in Settings.",
    action: "check_credentials",
  },
  BELOW_9L_MINIMUM: {
    sentence: "MLCC requires at least 9 liters per ADA — one of your suppliers is under the minimum.",
    action: "retry",
  },
  INVALID_SPLIT_QUANTITIES: {
    sentence: "One of your quantities doesn't match MLCC's case-split rules for that size.",
    action: "retry",
  },
};

/** Prefix rules for types without an exact entry. Order matters. */
const PREFIXES: Array<{ prefix: string; human: HumanFailure }> = [
  {
    prefix: "MILO_LOGIN_",
    human: {
      sentence: "Sign-in to MILO didn't complete. Their site may be having a moment — try again.",
      action: "retry",
    },
  },
  {
    prefix: "MLCC_ADD_BY_CODE_",
    human: {
      sentence: "MILO's cart page changed while we were adding your items. Try again — it usually clears.",
      action: "retry",
    },
  },
  {
    prefix: "MLCC_LICENSE_STORE_",
    human: {
      sentence: "We couldn't get past MILO's store-selection screen. Try again shortly.",
      action: "retry",
    },
  },
];

export function humanizeRunFailure(
  failureType: string | null | undefined,
  failureMessage: string | null | undefined,
): HumanFailure {
  const type = String(failureType ?? "").trim().toUpperCase();

  if (type && EXACT[type]) return EXACT[type];

  for (const { prefix, human } of PREFIXES) {
    if (type.startsWith(prefix)) return human;
  }

  const detail = String(failureMessage ?? "").trim();
  if (detail) {
    // Honest fallback: show the real detail, trimmed to one line.
    const oneLine = detail.replace(/\s+/g, " ").slice(0, 140);
    return {
      sentence: `The run stopped: ${oneLine}`,
      action: "retry",
    };
  }

  return {
    sentence:
      "The run stopped before finishing and didn't say why. Try again — if it repeats, we'll dig in.",
    action: "retry",
  };
}
