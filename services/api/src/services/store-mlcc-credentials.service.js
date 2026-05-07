import {
  encryptCredential,
  decryptCredential,
} from "../lib/credential-encryption.js";
import { loginToMilo } from "../rpa/stages/login.js";
import { logSystemDiagnostic } from "./diagnostics.service.js";

const DEFAULT_LOGIN_URL = "https://www.lara.michigan.gov/milo/auth/sign-in";

const VERIFY_STATUS = Object.freeze({
  SUCCESS: "success",
  INVALID_CREDENTIALS: "invalid_credentials",
  CAPTCHA_REQUIRED: "captcha_required",
  TIMEOUT: "timeout",
  NETWORK_ERROR: "network_error",
  SECURITY_VIOLATION: "security_violation",
  UNKNOWN_ERROR: "unknown_error",
});

function classifyMiloLoginError(err) {
  const code = err?.code || "";
  if (code === "MILO_LOGIN_INVALID_CREDENTIALS") {
    return VERIFY_STATUS.INVALID_CREDENTIALS;
  }
  if (code === "MILO_LOGIN_CAPTCHA_DETECTED") {
    return VERIFY_STATUS.CAPTCHA_REQUIRED;
  }
  if (code === "MILO_LOGIN_TIMEOUT") return VERIFY_STATUS.TIMEOUT;
  if (code === "MILO_LOGIN_NETWORK_ERROR") return VERIFY_STATUS.NETWORK_ERROR;
  if (code === "MILO_LOGIN_SECURITY_VIOLATION") {
    return VERIFY_STATUS.SECURITY_VIOLATION;
  }
  return VERIFY_STATUS.UNKNOWN_ERROR;
}

/**
 * Save (or update) MLCC credentials for a store. Encrypts password before persisting.
 * Does NOT verify against MILO — caller must invoke verifyStoreMlccCredentials separately.
 * Stamps mlcc_credentials_updated_at; clears verification metadata so caller knows it's unverified.
 */
export async function saveStoreMlccCredentials(
  supabase,
  storeId,
  { username, password },
) {
  if (typeof username !== "string" || username.trim() === "") {
    return { ok: false, error: "username is required" };
  }
  if (typeof password !== "string" || password === "") {
    return { ok: false, error: "password is required" };
  }

  let encrypted;
  try {
    encrypted = encryptCredential(password);
  } catch (err) {
    return { ok: false, error: `encryption failed: ${err.message}` };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("stores")
    .update({
      mlcc_username: username.trim(),
      mlcc_password_encrypted: encrypted,
      mlcc_credentials_updated_at: nowIso,
      mlcc_credentials_verified_at: null,
      mlcc_credentials_last_verified_at: null,
      mlcc_credentials_last_status: null,
      mlcc_credentials_last_error_code: null,
      updated_at: nowIso,
    })
    .eq("id", storeId)
    .select(
      "id, mlcc_username, mlcc_credentials_updated_at, mlcc_credentials_verified_at, mlcc_credentials_last_status",
    )
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "store not found" };
  }
  return { ok: true, store: data };
}

/**
 * Load and decrypt MLCC credentials for a store. Returns plaintext password — handle with care.
 * Use ONLY in worker / verify code paths. NEVER return this from an API endpoint.
 */
export async function loadDecryptedStoreMlccCredentials(supabase, storeId) {
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, mlcc_username, mlcc_password_encrypted, mlcc_credentials_verified_at, mlcc_credentials_last_status",
    )
    .eq("id", storeId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "store not found" };
  if (!data.mlcc_username || !data.mlcc_password_encrypted) {
    return {
      ok: false,
      error: "no_credentials_on_file",
      code: "LK_NO_CREDENTIALS",
    };
  }

  let password;
  try {
    password = decryptCredential(data.mlcc_password_encrypted);
  } catch (err) {
    return {
      ok: false,
      error: `decryption failed: ${err.message}`,
      code: "LK_DECRYPT_FAILED",
    };
  }

  return {
    ok: true,
    credentials: {
      username: data.mlcc_username,
      password,
      loginUrl: DEFAULT_LOGIN_URL,
    },
    verifiedAt: data.mlcc_credentials_verified_at,
    lastStatus: data.mlcc_credentials_last_status,
  };
}

/**
 * Read-only credential status — never returns the password. Safe to expose via API.
 */
export async function getStoreMlccCredentialsStatus(supabase, storeId) {
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, mlcc_username, mlcc_password_encrypted, mlcc_credentials_updated_at, mlcc_credentials_verified_at, mlcc_credentials_last_verified_at, mlcc_credentials_last_status, mlcc_credentials_last_error_code",
    )
    .eq("id", storeId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "store not found" };

  return {
    ok: true,
    status: {
      hasCredentials: !!(data.mlcc_username && data.mlcc_password_encrypted),
      username: data.mlcc_username || null,
      credentialsUpdatedAt: data.mlcc_credentials_updated_at,
      verifiedAt: data.mlcc_credentials_verified_at,
      lastVerifiedAt: data.mlcc_credentials_last_verified_at,
      lastStatus: data.mlcc_credentials_last_status,
      lastErrorCode: data.mlcc_credentials_last_error_code,
    },
  };
}

/**
 * Verify stored credentials by running Stage 1 (loginToMilo) against live MILO.
 * Updates mlcc_credentials_last_verified_at + last_status + last_error_code on every attempt.
 * Updates mlcc_credentials_verified_at ONLY on success.
 *
 * NEVER logs password.
 */
export async function verifyStoreMlccCredentials(
  supabase,
  storeId,
  { headless = true, timeoutMs = 30_000 } = {},
) {
  const loaded = await loadDecryptedStoreMlccCredentials(supabase, storeId);
  if (!loaded.ok) {
    return { ok: false, status: null, error: loaded.error, code: loaded.code };
  }

  const attemptedAtIso = new Date().toISOString();
  let status;
  let errorCode = null;
  let errorMessage = null;
  try {
    await loginToMilo(loaded.credentials, {
      headless,
      timeoutMs,
      captureArtifacts: false,
      slowMo: 0,
    });
    status = VERIFY_STATUS.SUCCESS;
  } catch (err) {
    status = classifyMiloLoginError(err);
    errorCode = err?.code || null;
    errorMessage = err?.message || null;
  }

  const updates = {
    mlcc_credentials_last_verified_at: attemptedAtIso,
    mlcc_credentials_last_status: status,
    mlcc_credentials_last_error_code: errorCode,
  };
  if (status === VERIFY_STATUS.SUCCESS) {
    updates.mlcc_credentials_verified_at = attemptedAtIso;
  }

  const { error: updateErr } = await supabase
    .from("stores")
    .update(updates)
    .eq("id", storeId);

  if (updateErr) {
    await logSystemDiagnostic({
      kind: "mlcc_credentials_verify_persist_failed",
      storeId,
      payload: { status, errorCode, persist_error: updateErr.message },
    });
  }

  await logSystemDiagnostic({
    kind: "mlcc_credentials_verify_attempted",
    storeId,
    payload: { status, error_code: errorCode, headless },
  });

  return {
    ok: status === VERIFY_STATUS.SUCCESS,
    status,
    errorCode,
    errorMessage,
    verifiedAt: status === VERIFY_STATUS.SUCCESS ? attemptedAtIso : null,
    lastVerifiedAt: attemptedAtIso,
  };
}

export async function clearStoreMlccCredentials(supabase, storeId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("stores")
    .update({
      mlcc_username: null,
      mlcc_password_encrypted: null,
      mlcc_credentials_updated_at: null,
      mlcc_credentials_verified_at: null,
      mlcc_credentials_last_verified_at: null,
      mlcc_credentials_last_status: null,
      mlcc_credentials_last_error_code: null,
      updated_at: nowIso,
    })
    .eq("id", storeId)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "store not found" };
  return { ok: true };
}

export { VERIFY_STATUS };
