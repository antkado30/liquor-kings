import { describe, it, expect } from "vitest";
import {
  classifyFailureType,
  isRetryableFailureType,
  FAILURE_TYPE,
} from "../src/services/execution-failure.service.js";

/*
 * Regression guard for the 2026-06-24 "validate never works on a flaky MILO"
 * incident. The stages throw specific codes that classifyFailureType preserves
 * verbatim; isRetryableFailureType must recognise the transient ones (so the
 * max_retries=2 machinery actually fires) WITHOUT ever retrying a submit.
 */

describe("isRetryableFailureType — transient MILO failures retry", () => {
  // These are the EXACT codes observed failing on order day (inspect output).
  // NOTE: login codes are intentionally NOT here — see the login describe below.
  const transient = [
    "MILO_STAGE2_SELECT_LICENSE_LINK_NOT_VISIBLE",
    "MILO_STAGE3_ADD_BY_CODE_NAV_FAILED",
    "MILO_STAGE3_TIMEOUT",
    "MILO_STAGE3_CART_CLEAR_FAILED",
    "MILO_STAGE4_VALIDATE_TIMEOUT",
    "MILO_STAGE4_CART_FINALIZATION_TIMEOUT",
    "MILO_STAGE4_VALIDATE_BUTTON_NOT_FOUND",
    "MILO_STAGE4_INVALID_SESSION",
    "MILO_STAGE4_PARSE_FAILED",
    // legacy coarse labels still work
    FAILURE_TYPE.NETWORK_ERROR,
    FAILURE_TYPE.MLCC_UI_CHANGE,
  ];
  for (const code of transient) {
    it(`retries ${code}`, () => {
      expect(isRetryableFailureType(code)).toBe(true);
    });
  }
});

describe("isRetryableFailureType — deterministic business failures do NOT retry", () => {
  const permanent = [
    "MILO_STAGE4_BELOW_9L_MINIMUM",
    "MILO_STAGE4_INVALID_SPLIT_QUANTITIES",
    "MILO_LOGIN_INVALID_CREDENTIALS",
    "MILO_LOGIN_CAPTCHA_DETECTED",
    "MLCC_ITEM_NOT_FOUND",
    "CODE_MISMATCH",
    "OUT_OF_STOCK",
    "QUANTITY_RULE_VIOLATION",
    "LK_DECRYPT_FAILED",
    FAILURE_TYPE.UNKNOWN,
  ];
  for (const code of permanent) {
    it(`does not retry ${code}`, () => {
      expect(isRetryableFailureType(code)).toBe(false);
    });
  }
});

describe("isRetryableFailureType — login failures do NOT run-level retry", () => {
  // login.js retries network blips INTERNALLY (maxAttempts). A run-level retry
  // on top just re-hammers MILO's login and throttles the account. So even
  // though a login network error is 'transient', it must not re-queue here.
  const loginCodes = [
    "MILO_LOGIN_NETWORK_ERROR",
    "MILO_LOGIN_TIMEOUT",
    "MILO_LOGIN_INVALID_CREDENTIALS",
    "MILO_LOGIN_CAPTCHA_DETECTED",
  ];
  for (const code of loginCodes) {
    it(`does not run-level retry ${code}`, () => {
      expect(isRetryableFailureType(code)).toBe(false);
    });
  }
});

describe("isRetryableFailureType — submit-side NEVER retries (double-order safety)", () => {
  // Re-running a run that already reached submit could place a SECOND real
  // order. Every Stage-5 / checkout / reaped code must be non-retryable, even
  // when it contains an otherwise-transient substring like SESSION or TIMEOUT.
  const submitSide = [
    "MILO_STAGE5_INVALID_SESSION", // contains SESSION but is submit-side
    "MILO_STAGE5_EMPTY_CART",
    "MILO_STAGE5_SUBMIT_FAILED",
    "MILO_STAGE5_CONFIRMATION_TIMEOUT", // contains TIMEOUT but is submit-side
    "MILO_CHECKOUT_FAILED",
    "LK_RUN_REAPED", // orphaned mid-run — may have already submitted
  ];
  for (const code of submitSide) {
    it(`does not retry ${code}`, () => {
      expect(isRetryableFailureType(code)).toBe(false);
    });
  }
});

describe("isRetryableFailureType — empty / nullish input", () => {
  it("treats missing type as non-retryable", () => {
    expect(isRetryableFailureType(null)).toBe(false);
    expect(isRetryableFailureType(undefined)).toBe(false);
    expect(isRetryableFailureType("")).toBe(false);
  });
});

describe("classifyFailureType preserves specific codes, which then route to retry", () => {
  it("keeps a well-formed SCREAMING_SNAKE stage code verbatim", () => {
    const t = classifyFailureType({ explicitType: "MILO_STAGE3_TIMEOUT" });
    expect(t).toBe("MILO_STAGE3_TIMEOUT");
    expect(isRetryableFailureType(t)).toBe(true);
  });
  it("UNKNOWN explicit still sniffs the message (timeout -> NETWORK_ERROR -> retry)", () => {
    const t = classifyFailureType({
      errorMessage: "Navigation timeout of 30000ms exceeded",
      explicitType: FAILURE_TYPE.UNKNOWN,
    });
    expect(t).toBe(FAILURE_TYPE.NETWORK_ERROR);
    expect(isRetryableFailureType(t)).toBe(true);
  });
  it("a business message stays non-retryable", () => {
    const t = classifyFailureType({
      errorMessage: "You must order at least nine liters",
      explicitType: "MILO_STAGE4_BELOW_9L_MINIMUM",
    });
    expect(t).toBe("MILO_STAGE4_BELOW_9L_MINIMUM");
    expect(isRetryableFailureType(t)).toBe(false);
  });
});
