/**
 * Runtime store-id resolution for the scanner (task #85, 2026-06-06).
 *
 * THE PROBLEM THIS FIXES:
 * Until today, the scanner read its store id from `VITE_SCANNER_STORE_ID`
 * — a build-time env var. That was fine while LK was single-tenant
 * (dad's store baked into the build). The moment a second store
 * signed up via /auth/signup, the baked-in id no longer matched their
 * `store_users` membership, and the API's `resolveAuthenticatedStore`
 * middleware started 403'ing every call with "Not a member of
 * specified store". Tony tripped this in real time after his first
 * test signup — browse, orders, dashboard, templates all dead.
 *
 * THE FIX:
 * Resolve the store id at RUNTIME from the authenticated user's
 * `store_users` row(s). Cache it in module scope + localStorage so:
 *   - All API helpers can read it synchronously
 *   - It survives a hard refresh without an extra round trip
 *   - It clears on sign-out so a different user starting a new session
 *     in the same browser doesn't inherit the previous user's store
 *
 * FALLBACK:
 * If runtime resolution fails (network blip during boot, no membership
 * row yet), we fall back to `VITE_SCANNER_STORE_ID` if set. That
 * preserves the dev/local workflow where dad's store id is in .env.
 */
import { supabase } from "./supabase";

const STORAGE_KEY = "lk.currentStoreId.v1";

let currentStoreId: string | null = readFromStorage();

function readFromStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToStorage(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode etc — fine, in-memory state still works */
  }
}

/**
 * Synchronous accessor for API helpers. Returns:
 *   1. The cached runtime store id, if resolved
 *   2. VITE_SCANNER_STORE_ID env fallback, if no runtime id yet
 *   3. null if neither is available (caller should error clearly)
 */
export function getCurrentStoreId(): string | null {
  if (currentStoreId) return currentStoreId;
  const envFallback = import.meta.env.VITE_SCANNER_STORE_ID as
    | string
    | undefined;
  return envFallback ?? null;
}

/**
 * Manually set the current store id. Used by the signup flow which
 * already knows the new store_id from the /auth/signup response —
 * skips a redundant lookup before activation can fire.
 */
export function setCurrentStoreId(id: string | null) {
  currentStoreId = id;
  writeToStorage(id);
}

/**
 * Look up the signed-in user's store_users membership and cache the
 * resulting store_id. Should be called by AuthGate right after a
 * session lands (login OR refresh-with-existing-session). Returns the
 * resolved id, or null if the user has no active membership (which
 * means the server will also reject them — we surface a clear error
 * instead of letting requests silently fail).
 *
 * Multi-store users: V1 picks the first active membership. When LK
 * supports a user belonging to multiple stores (manager of two
 * locations, accountant covering several), this becomes a chooser UI.
 */
export async function resolveCurrentStoreIdFromSession(): Promise<
  string | null
> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    setCurrentStoreId(null);
    return null;
  }
  const { data, error } = await supabase
    .from("store_users")
    .select("store_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) {
    // No active membership. Keep any prior cached id null so callers
    // can't silently call against the wrong store. AuthGate will
    // surface this state as "no store linked to your account."
    setCurrentStoreId(null);
    return null;
  }
  const id = data[0].store_id as string;
  setCurrentStoreId(id);
  return id;
}

/**
 * Clear the cached store id. Called on sign-out so the next user in
 * the same browser doesn't inherit a stale value.
 */
export function clearCurrentStoreId() {
  setCurrentStoreId(null);
}
