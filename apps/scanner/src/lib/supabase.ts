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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at module-eval time so a misconfigured build is obvious
  // immediately instead of producing confusing 401s deeper in.
  throw new Error(
    "Scanner is missing Supabase env vars (VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_ANON_KEY). Set both in apps/scanner/.env before building.",
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey,
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
 * Returns the current session's access token (JWT) for use as a Bearer
 * token against the Liquor Kings API. Returns null if not signed in.
 *
 * Always read this freshly — Supabase rotates the JWT on auto-refresh, so
 * caching the token across requests would eventually serve a stale value.
 */
export async function getAuthBearer(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    // Don't throw — let callers decide how to react (usually: redirect to login).
    console.warn("[scanner] supabase.auth.getSession failed:", error.message);
    return null;
  }
  return data.session?.access_token ?? null;
}
