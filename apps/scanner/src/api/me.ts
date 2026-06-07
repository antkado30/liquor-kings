/**
 * Scanner ↔ /auth/me API client (task #86, 2026-06-06).
 *
 * Endpoints scoped to "the current authenticated user." Currently
 * just MLCC credential management — recovery path when activation
 * fails because of wrong creds, plus legitimate password rotation.
 */
import { fetchWithRetry } from "./catalog";
import { getAuthBearer } from "../lib/supabase";
import { getCurrentStoreId } from "../lib/currentStore";

const BASE = "/auth/me";

export type UpdateMlccCredentialsResult =
  | { ok: true; updated_at: string | null }
  | { ok: false; error: string };

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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
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
      return code;
  }
}
