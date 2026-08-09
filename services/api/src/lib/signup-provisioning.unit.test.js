/**
 * signup-provisioning pins (SIGNUP MACHINE M1, 2026-08-08).
 * The rules under guard: exactly 14 days of trial, Detroit time by
 * default, sub-user-first means creds are optional-but-atomic at
 * signup, and a credless store starts at store_created so the wizard
 * knows to route the owner into the MILO-connect step.
 */
import { describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  DEFAULT_TIMEZONE,
  ONBOARDING,
  trialEndsAtIso,
  buildSignupStoreRow,
  validateSignupCredsPair,
} from "./signup-provisioning.js";

const NOW = Date.parse("2026-08-08T16:00:00.000Z");

describe("trialEndsAtIso", () => {
  it("is exactly 14 days — two Wednesday orders of proof", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAtIso(NOW)).toBe("2026-08-22T16:00:00.000Z");
  });
});

describe("buildSignupStoreRow", () => {
  const base = {
    storeName: "Colony Party Store",
    liquorLicense: "123456",
    addressLine1: "1 Main St",
    city: "Detroit",
    state: "MI",
    postalCode: "48201",
    nowMs: NOW,
  };

  it("credless signup: store_created state, null creds, trial stamped, Detroit time", () => {
    const row = buildSignupStoreRow({ ...base, mlccUsername: null, mlccPasswordEncrypted: null });
    expect(row.onboarding_state).toBe(ONBOARDING.STORE_CREATED);
    expect(row.mlcc_username).toBe(null);
    expect(row.mlcc_password_encrypted).toBe(null);
    expect(row.trial_ends_at).toBe("2026-08-22T16:00:00.000Z");
    expect(row.timezone).toBe(DEFAULT_TIMEZONE);
    expect(row.is_active).toBe(true);
    // Arming stays with the column default (false) — no override here.
    expect(row).not.toHaveProperty("allow_order_submission");
  });

  it("with creds: milo_connected state and both fields stored", () => {
    const row = buildSignupStoreRow({
      ...base,
      mlccUsername: "colonysub1",
      mlccPasswordEncrypted: "enc:abc",
    });
    expect(row.onboarding_state).toBe(ONBOARDING.MILO_CONNECTED);
    expect(row.mlcc_username).toBe("colonysub1");
    expect(row.mlcc_password_encrypted).toBe("enc:abc");
  });

  it("state defaults to MI, empty optionals become null", () => {
    const row = buildSignupStoreRow({
      storeName: "X",
      liquorLicense: "123456",
      mlccUsername: null,
      mlccPasswordEncrypted: null,
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      nowMs: NOW,
    });
    expect(row.state).toBe("MI");
    expect(row.address_line1).toBe(null);
    expect(row.city).toBe(null);
    expect(row.postal_code).toBe(null);
  });
});

describe("validateSignupCredsPair", () => {
  it("both, neither, and half-pairs", () => {
    expect(validateSignupCredsPair("u", "p")).toEqual({ ok: true, hasCreds: true });
    expect(validateSignupCredsPair("", "")).toEqual({ ok: true, hasCreds: false });
    expect(validateSignupCredsPair("u", "")).toEqual({
      ok: false,
      error: "mlcc_credentials_incomplete",
    });
    expect(validateSignupCredsPair("", "p")).toEqual({
      ok: false,
      error: "mlcc_credentials_incomplete",
    });
  });
});
