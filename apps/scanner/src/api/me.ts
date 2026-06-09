/**
 * Scanner ↔ /auth/me API client (task #86, 2026-06-06).
 *
 * Endpoints scoped to "the current authenticated user." Currently
 * just MLCC credential management — recovery path when activation
 * fails because of wrong creds, plus legitimate password rotation.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer, handleAuthFailure } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

const BASE = "/auth/me";

export type UpdateMlccCredentialsResult =
  | { ok: true; updated_at: string | null }
  | { ok: false; error: string };

export type StoreProfileResult =
  | {
      ok: true;
      store_name: string | null;
      mlcc_credentials_last_verified_at: string | null;
    }
  | { ok: false; error: string };

/**
 * Lightweight store profile for onboarding gates. Uses the existing
 * /home/smart-cards endpoint (store_meta) so we don't need a new API.
 * Verified returning users skip activation friction.
 */
export async function getMyStoreProfile(): Promise<StoreProfileResult> {
  const bearer = await getAuthBearer();
  const storeId = getCurrentStoreId();
  if (!bearer || !storeId) {
    return { ok: false, error: "Not signed in" };
  }

  let res: Response;
  try {
    res = await fetchWithRetry(
      "/home/smart-cards",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
        },
      },
      { maxRetries: 1, baseDelayMs: 400, timeoutMs: 8_000 },
    );
  } catch (e) {
    return {
      ok: false,
      error: humanizeNetworkError(
        e instanceof Error ? e.message : String(e),
      ),
    };
  }

  if (await handleAuthFailure(res)) {
    return { ok: false, error: "session_expired" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: humanizeNetworkError("network_error") };
  }

  if (!res.ok || raw.ok !== true) {
    const err =
      typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: humanizeNetworkError(err) };
  }

  const meta =
    raw.store_meta && typeof raw.store_meta === "object"
      ? (raw.store_meta as Record<string, unknown>)
      : null;

  return {
    ok: true,
    store_name:
      meta && typeof meta.store_name === "string" ? meta.store_name : null,
    mlcc_credentials_last_verified_at:
      meta && typeof meta.mlcc_credentials_last_verified_at === "string"
        ? meta.mlcc_credentials_last_verified_at
        : null,
  };
}

/**
 * PATCH /auth/me/mlcc-credentials
 *
 * Either or both fields can be updated. Backend re-encrypts password
 * with AES-256-GCM and stamps mlcc_credentials_updated_at.
 *
 * @param overrideStoreId — for the onboarding flow; mirrors the same
 *   plumbing as triggerMlccCartReset so a brand-new signup whose
 *   activation failed can immediately PATCH their creds without
 *   waiting for the runtime store-id resolver.
 */
export async function updateMlccCredentials(args: {
  mlcc_username?: string;
  mlcc_password?: string;
  overrideStoreId?: string;
}): Promise<UpdateMlccCredentialsResult> {
  const bearer = await getAuthBearer();
  if (!bearer) return { ok: false, error: "Not signed in" };

  const storeId = args.overrideStoreId ?? getCurrentStoreId();
  if (!storeId) return { ok: false, error: "No active store" };

  const body: Record<string, string> = {};
  if (args.mlcc_username !== undefined)
    body.mlcc_username = args.mlcc_username;
  if (args.mlcc_password !== undefined)
    body.mlcc_password = args.mlcc_password;
  if (Object.keys(body).length === 0)
    return { ok: false, error: "Nothing to update" };

  let res: Response;
  try {
    res = await fetchWithRetry(
      `${BASE}/mlcc-credentials`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Store-Id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { maxRetries: 1, baseDelayMs: 500, timeoutMs: 10_000 },
    );
  } catch (e) {
    return {
      ok: false,
      error: humanizeNetworkError(
        e instanceof Error ? e.message : String(e),
      ),
    };
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: humanizeNetworkError(`HTTP ${res.status}`) };
  }
  if (!res.ok || raw.ok !== true) {
    const err = typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    return { ok: false, error: humanizeMlccCredsError(err) };
  }
  return {
    ok: true,
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

export function humanizeNetworkError(code: string): string {
  const c = code.trim().toLowerCase();
  if (!c || c === "network_error") {
    return "Couldn't reach our servers. Check your connection and try again.";
  }
  if (/^http 5/.test(c) || c.includes("500") || c.includes("503")) {
    return "Our servers are temporarily unavailable. Please try again.";
  }
  if (/timeout|timed out|aborted/i.test(c)) {
    return "The request timed out. Check your connection and try again.";
  }
  if (/fetch|network|failed to fetch/i.test(c)) {
    return "Couldn't reach our servers. Check your connection and try again.";
  }
  return code;
}

export function humanizeLoginError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email or password is incorrect. Double-check and try again.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email before signing in.";
  }
  if (/network|fetch|timeout/i.test(m)) {
    return humanizeNetworkError(message);
  }
  return message;
}

export function humanizeSignupError(code?: string): string {
  switch (code) {
    case "invalid_email":
      return "That email address doesn't look valid.";
    case "password_too_short_min_8":
      return "Password must be at least 8 characters.";
    case "store_name_required":
      return "Store name is required.";
    case "liquor_license_invalid":
      return "Liquor license must be 5–10 digits.";
    case "mlcc_credentials_required":
      return "MLCC username and password are required.";
    case "email_in_use":
      return "An account already exists with that email. Try signing in instead.";
    case "credential_encryption_failed":
      return "We couldn't securely save your MLCC credentials. Please try again.";
    default:
      if (!code) return "Sign-up failed. Please try again.";
      return humanizeNetworkError(code);
  }
}

function humanizeMlccCredsError(code: string): string {
  switch (code) {
    case "mlcc_username_required":
      return "MLCC username can't be blank.";
    case "mlcc_password_required":
      return "MLCC password can't be blank.";
    case "credential_encryption_failed":
      return "Server couldn't encrypt the new password — try again or contact support.";
    case "nothing_to_update":
      return "No changes to save.";
    case "no_store_for_user":
      return "Your account isn't linked to a store. Sign out and back in.";
    default:
      return humanizeNetworkError(code);
  }
}
