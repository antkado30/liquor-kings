/**
 * Supabase browser client for the scanner SPA.
 *
 * Configuration comes from Vite env vars baked into the production build:
 *   - VITE_SUPABASE_URL      — public Supabase project URL
 *   - VITE_SUPABASE_ANON_KEY — public anon key (intended for client use,
 *                              safe to ship in the bundle; server-side RLS
 *                              policies are what actually authorize requests)
 *
 * Auth flow:
 *   - User signs in with email + password (see AuthGate.tsx)
 *   - Supabase returns a JWT; the client persists it in localStorage and
 *     refreshes automatically before expiry
 *   - All scanner API calls grab the current JWT via getAuthBearer() and
 *     send it as `Authorization: Bearer <jwt>` — the API's
 *     resolveAuthenticatedStore middleware maps the JWT to the user's
 *     store_id via the store_users table
 *
 * SECURITY: the anon key is intentionally public. It cannot bypass RLS on
 * its own — only the service-role key can, and that NEVER ships to clients.
 * The previous dev-bearer model that bundled the service role key has been
 * removed; the scanner now authenticates as a real Supabase Auth user.
 */
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { clearAllCache } from "./swr";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

/**
 * If env vars are missing at runtime, log a visible diagnostic INSTEAD of
 * throwing at module load. Throwing here used to blank-screen the whole app
 * (we hit this exact bug 2026-05-27 when .dockerignore blocked .env.production).
 * Soft-failing lets AuthGate render a user-facing "scanner misconfigured"
 * message instead of a black void — engineers can still find the cause via
 * dev tools, but users see something useful.
 */
export const scannerMisconfigured: { reason: string } | null =
  !supabaseUrl || !supabaseAnonKey
    ? {
        reason:
          "Scanner is missing Supabase env vars — see apps/scanner/.env. " +
          "If you see this in production, the build skipped baking " +
          "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY into the bundle.",
      }
    : null;

if (scannerMisconfigured) {
  console.error("[scanner] CONFIG ERROR:", scannerMisconfigured.reason);
}

/**
 * If env vars are missing, we still need a SupabaseClient object so the rest
 * of the code can compile + import without crashing — but every call will
 * fail gracefully. We use placeholder values; AuthGate inspects
 * scannerMisconfigured and shows the misconfig screen before any auth call.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://placeholder.invalid",
  supabaseAnonKey || "placeholder",
  {
    auth: {
      // Keep the session in localStorage across page reloads (dad's iPhone
      // shouldn't have to sign in every time he opens Safari).
      persistSession: true,
      // Refresh JWT before it expires so long-lived sessions don't 401 mid-shift.
      autoRefreshToken: true,
      // Pick up sessions returned via magic-link / OAuth redirects (future).
      detectSessionInUrl: true,
    },
  },
);

/**
 * In-memory mirror of the current session, kept fresh by onAuthStateChange
 * below. This lets getAuthBearer() return the JWT synchronously from memory
 * instead of awaiting supabase.auth.getSession() before EVERY API call —
 * that per-request round trip was part of the "everything feels slow"
 * problem (see feedback_instant_feel). Supabase fires onAuthStateChange on
 * sign-in, sign-out, AND token auto-refresh, so this mirror never goes
 * stale: when the JWT rotates, we get the new one immediately.
 */
let cachedSession: Session | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedSession = session;
});

// Prime the mirror once at startup (covers a persisted session restored
// from localStorage on a fresh page load, before the first auth event).
void supabase.auth.getSession().then(({ data }) => {
  if (data.session) cachedSession = data.session;
});

/**
 * Returns the current session's access token (JWT) for use as a Bearer
 * token against the Liquor Kings API. Returns null if not signed in.
 *
 * Reads from the in-memory mirror first (instant, no await on storage),
 * falling back to a real getSession() only on a cold cache (e.g. the very
 * first request right after load, before the mirror is primed).
 */
export async function getAuthBearer(): Promise<string | null> {
  if (cachedSession?.access_token) return cachedSession.access_token;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    // Don't throw — let callers decide how to react (usually: redirect to login).
    console.warn("[scanner] supabase.auth.getSession failed:", error.message);
    return null;
  }
  cachedSession = data.session;
  return data.session?.access_token ?? null;
}

/**
 * Signs the current user out. Used by:
 *   - Sign-out button in the scanner header
 *   - 401-handler when the API rejects the JWT (token revoked / password
 *     changed / membership removed) — forces a return to the login screen
 *     so the user can re-authenticate instead of sitting stuck on a broken
 *     scanner page
 *
 * AuthGate listens to onAuthStateChange and will automatically re-render
 * the login form when this resolves.
 */
export async function signOut(): Promise<void> {
  // Wipe the SWR cache so the next user in this browser starts clean and
  // never sees the previous user's cached orders/templates/catalog.
  clearAllCache();
  cachedSession = null;
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.warn("[scanner] supabase.auth.signOut failed:", error.message);
  }
}

/**
 * Handle an authenticated API response — if it's a 401, our JWT is no
 * longer valid (expired beyond refresh, revoked, user removed from
 * store_users, etc.). Force sign-out so AuthGate shows the login screen
 * instead of letting the app silently spin with broken auth.
 *
 * Returns true if a 401 was handled (caller should treat the request as
 * failed and bail). Returns false otherwise (caller continues normally).
 */
export async function handleAuthFailure(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  console.warn(
    "[scanner] API returned 401 — forcing sign-out so the user can re-authenticate",
  );
  await signOut();
  return true;
}
