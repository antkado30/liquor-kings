/**
 * signup-provisioning — pure builders for the self-serve signup flow
 * (SIGNUP MACHINE M1, 2026-08-08; blueprint docs/lk/SIGNUP-MACHINE.md).
 *
 * Extracted from auth.routes.js so the provisioning rules are pinned by
 * sandbox-runnable tests: the 14-day trial stamp, the Michigan default
 * timezone (store-local grouping doctrine), and the onboarding state
 * machine (creds at signup are now OPTIONAL — the wizard's MILO-connect
 * step happens after account creation, sub-user first).
 *
 * Arming note (conscious choice, blueprint §Build order): new stores
 * keep the column default allow_order_submission=false at creation.
 * The MILO-connect step flips it to true only after a LIVE credential
 * verify succeeds — ordering is the product, but never before we know
 * the creds work.
 */

export const TRIAL_DAYS = 14;
export const DEFAULT_TIMEZONE = "America/Detroit";

export const ONBOARDING = Object.freeze({
  STORE_CREATED: "store_created",
  MILO_CONNECTED: "milo_connected",
  LIVE: "live",
});

/** trial_ends_at = signup instant + exactly 14 days. */
export function trialEndsAtIso(nowMs) {
  return new Date(nowMs + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Build the stores insert row for a self-serve signup. Pure.
 *
 * @param {object} args
 * @param {string} args.storeName
 * @param {string} args.liquorLicense
 * @param {string|null} args.mlccUsername            null = connect later
 * @param {string|null} args.mlccPasswordEncrypted   null = connect later
 * @param {string|null} [args.addressLine1]
 * @param {string|null} [args.city]
 * @param {string|null} [args.state]
 * @param {string|null} [args.postalCode]
 * @param {number} args.nowMs
 */
export function buildSignupStoreRow({
  storeName,
  liquorLicense,
  mlccUsername,
  mlccPasswordEncrypted,
  addressLine1,
  city,
  state,
  postalCode,
  nowMs,
}) {
  const hasCreds = Boolean(mlccUsername && mlccPasswordEncrypted);
  return {
    store_name: storeName,
    liquor_license: liquorLicense,
    mlcc_username: hasCreds ? mlccUsername : null,
    mlcc_password_encrypted: hasCreds ? mlccPasswordEncrypted : null,
    address_line1: addressLine1 || null,
    city: city || null,
    state: state || "MI",
    postal_code: postalCode || null,
    timezone: DEFAULT_TIMEZONE,
    trial_ends_at: trialEndsAtIso(nowMs),
    onboarding_state: hasCreds ? ONBOARDING.MILO_CONNECTED : ONBOARDING.STORE_CREATED,
    is_active: true,
  };
}

/**
 * Signup-time credential validation: both-or-neither. Providing only a
 * username (or only a password) is a mistake we refuse loudly rather
 * than half-storing.
 * @returns {{ok: true, hasCreds: boolean} | {ok: false, error: string}}
 */
export function validateSignupCredsPair(mlccUsername, mlccPassword) {
  const u = Boolean(mlccUsername);
  const p = Boolean(mlccPassword);
  if (u !== p) return { ok: false, error: "mlcc_credentials_incomplete" };
  return { ok: true, hasCreds: u && p };
}
