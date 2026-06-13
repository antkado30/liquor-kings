/**
 * Email + password sign-in for the Command Deck (2026-06-07).
 *
 * WHY: the operator sign-in used to require pasting a raw Supabase access
 * token extracted from the browser console — and those tokens expire in ~1h,
 * so Tony hit "Invalid or expired token." This replaces that with a normal
 * email + password login (same credentials as the scanner), done via
 * Supabase's REST token endpoint so we don't add the @supabase/supabase-js
 * dependency to the admin bundle.
 *
 * The URL + anon key below are PUBLIC by design (the anon key is meant to ship
 * in client bundles; RLS is what authorizes data access). They already live in
 * the repo via apps/scanner/.env.production. Hardcoding here avoids env/Docker
 * wiring for two values that are not secret.
 */
const SUPABASE_URL = "https://eamoozfhqolshdztbrez.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhbW9vemZocW9sc2hkenRicmV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTI2MTYsImV4cCI6MjA5NDE4ODYxNn0.NldMNHIQ3XecLdxZkKobAFVtKTxTVrLtWGvOT5PYfvQ";

export type PasswordSignInResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string };

/**
 * Exchange email + password for a fresh Supabase access token via the GoTrue
 * REST endpoint. Returns a short-lived access_token the operator session
 * `connect()` then trades for a long-lived HttpOnly session cookie.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  let res: Response;
  try {
    // AUDIT #28 follow-up: bare fetch with no timeout — same class as the
    // rest of apps/admin's API layer. A stalled Supabase auth response would
    // leave SignInView's `busy` state (and "Signing in…" button) stuck
    // forever with no way out except reloading. 15s is generous for a login
    // POST but bounds the wait.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error during sign-in.",
    };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* fall through to status-based error */
  }

  if (!res.ok) {
    const msg =
      (typeof body.error_description === "string" && body.error_description) ||
      (typeof body.msg === "string" && body.msg) ||
      (typeof body.error === "string" && body.error) ||
      `Sign-in failed (HTTP ${res.status})`;
    return { ok: false, error: msg };
  }

  const token = body.access_token;
  if (typeof token !== "string" || !token) {
    return { ok: false, error: "Sign-in succeeded but no token was returned." };
  }
  return { ok: true, accessToken: token };
}
