/**
 * AuthGate — wraps the scanner SPA and gates it behind Supabase Auth.
 *
 * Behavior:
 *   - On mount, checks supabase.auth.getSession()
 *   - If no session: shows a minimal email + password login form
 *   - If signed in: renders children (the actual scanner app)
 *   - Listens for auth state changes so sign-out from anywhere updates the UI
 *
 * Why minimal styling: this is V1 for a single store. The login screen is
 * mostly invisible after first use (sessions persist). When we add real
 * onboarding for multi-store, this gets replaced with a proper auth flow
 * (magic links, store-branded login pages, etc.).
 */
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { scannerMisconfigured, supabase } from "../lib/supabase";
import {
  clearCurrentStoreId,
  resolveCurrentStoreIdFromSession,
  setCurrentStoreId,
} from "../lib/currentStore";
import { OnboardingActivation } from "./OnboardingActivation";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Mode toggle (task #78, 2026-06-06): "login" = existing dad/staff flow;
  // "signup" = a new store owner creating their LK account from scratch.
  // The signup mode opens up the full multi-store onboarding form.
  // Initial default: respect URL hash so /scanner#signup lands on signup
  // tab. Marketing CTAs link to /scanner#signup so the flow is seamless.
  const [mode, setMode] = useState<"login" | "signup">(() => {
    if (typeof window !== "undefined" && window.location.hash === "#signup") {
      return "signup";
    }
    return "login";
  });
  // Signup form state.
  const [storeName, setStoreName] = useState("");
  const [liquorLicense, setLiquorLicense] = useState("");
  const [mlccUsername, setMlccUsername] = useState("");
  const [mlccPassword, setMlccPassword] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateAbbr, setStateAbbr] = useState("MI");
  const [postalCode, setPostalCode] = useState("");
  /*
   * Activation gate (task #84, 2026-06-06). When `pendingActivation`
   * is true we render OnboardingActivation INSTEAD of children — the
   * user just signed up and we want to verify their MLCC creds work
   * via a real RPA probe before they touch the scanner.
   *
   * Set true on successful signup. Existing-user login leaves it
   * false. After verification completes (succeed OR user skips),
   * onComplete fires and we drop into the scanner.
   *
   * State is in-memory only — a refresh sends the user straight to
   * the scanner (where their first Validate will surface real errors
   * if creds are wrong). Persistent activation status is a follow-up.
   */
  const [pendingActivation, setPendingActivation] = useState(false);
  const [pendingActivationStoreName, setPendingActivationStoreName] =
    useState<string>("");
  /*
   * Brand-new-signup store_id. Returned by /auth/signup and held only
   * for the activation flow. We can't rely on VITE_SCANNER_STORE_ID
   * (build-time, baked-in for dad's store) — the activation RPA needs
   * to hit the *new* user's just-created store.
   */
  const [pendingActivationStoreId, setPendingActivationStoreId] =
    useState<string | null>(null);

  useEffect(() => {
    // Misconfigured build (missing Supabase env vars) — skip auth entirely
    // and let the misconfig screen render. Calling getSession here would
    // throw because supabase client points at a placeholder URL.
    if (scannerMisconfigured) {
      setLoading(false);
      return;
    }

    // Initial session check on mount.
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      // If we already have a session (returning user, persisted via
      // localStorage), resolve their store_id from store_users so the
      // scanner uses the right tenant on first paint. Without this,
      // the first API call after refresh sends the env-fallback store
      // id and 403s on multi-tenant accounts.
      if (data.session) {
        await resolveCurrentStoreIdFromSession();
      }
      setLoading(false);
    });

    // Subscribe to auth changes (sign-in, sign-out, token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, next) => {
        setSession(next);
        if (event === "SIGNED_OUT" || !next) {
          clearCurrentStoreId();
        } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          // SIGNED_IN fires for fresh logins; we re-resolve in case the
          // user just switched accounts in the same browser session.
          // TOKEN_REFRESHED keeps the cached id but doesn't need a
          // round-trip — guard against unnecessary work.
          if (event === "SIGNED_IN") {
            await resolveCurrentStoreIdFromSession();
          }
        }
      },
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (error) {
      setErrorMsg(error.message);
    }
  }

  /*
   * Sign-up handler (task #78). Posts to /auth/signup which provisions:
   *   1. Supabase Auth user
   *   2. stores row with encrypted MLCC creds
   *   3. store_users link row
   * On success: immediately signs the user in with the same email +
   * password they just created. Drops them straight into their scanner.
   */
  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          store_name: storeName.trim(),
          liquor_license: liquorLicense.trim(),
          mlcc_username: mlccUsername.trim(),
          mlcc_password: mlccPassword,
          address_line1: addressLine1.trim() || undefined,
          city: city.trim() || undefined,
          state: stateAbbr.trim() || undefined,
          postal_code: postalCode.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        details?: string;
        store_id?: string;
      };
      if (!res.ok || body.ok !== true) {
        const msg = humanizeSignupError(body.error);
        setErrorMsg(msg);
        setSubmitting(false);
        return;
      }
      // Auto-sign-in to land in the scanner immediately.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setSubmitting(false);
      if (signInErr) {
        setErrorMsg(
          `Account created but couldn't sign in: ${signInErr.message}. Switch to Sign in tab.`,
        );
        return;
      }
      // Seed the runtime store id IMMEDIATELY from the signup response.
      // The auth-state listener will also call resolveCurrentStoreIdFromSession
      // on SIGNED_IN, but that race is annoying — by setting it here we
      // guarantee every API call after signup uses the new store, with
      // zero round-trips and zero possibility of a stale env-fallback
      // value bleeding through.
      if (body.store_id) setCurrentStoreId(body.store_id);
      // Activation gate — verify MLCC creds via RPA probe before scanner.
      setPendingActivationStoreName(storeName.trim() || "your store");
      setPendingActivationStoreId(body.store_id ?? null);
      setPendingActivation(true);
      // Auth state change subscription will flip session; with
      // pendingActivation=true the render path will show the
      // OnboardingActivation modal instead of children.
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return (
      <div style={loadingStyle}>
        <div style={{ opacity: 0.7 }}>Loading…</div>
      </div>
    );
  }

  if (scannerMisconfigured) {
    return (
      <div style={shellStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Scanner misconfigured</h1>
          <p style={subtitleStyle}>
            This build is missing required configuration. Please contact the
            person who set up your scanner.
          </p>
          <p style={{ ...errorStyle, marginTop: 4 }}>
            {scannerMisconfigured.reason}
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={shellStyle}>
        <form
          onSubmit={mode === "login" ? handleSignIn : handleSignUp}
          style={cardStyle}
        >
          <h1 style={titleStyle}>Liquor Kings</h1>
          <p style={subtitleStyle}>
            {mode === "login"
              ? "Sign in to start scanning."
              : "Sign your store up for Liquor Kings."}
          </p>

          {/* Mode toggle — tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setErrorMsg(null);
              }}
              style={{
                ...tabStyle,
                ...(mode === "login" ? tabActiveStyle : {}),
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErrorMsg(null);
              }}
              style={{
                ...tabStyle,
                ...(mode === "signup" ? tabActiveStyle : {}),
              }}
            >
              Sign up
            </button>
          </div>

          {mode === "signup" ? (
            <>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Store name</span>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  style={inputStyle}
                  placeholder="Your store name"
                />
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Liquor license number</span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={liquorLicense}
                  onChange={(e) => setLiquorLicense(e.target.value)}
                  style={inputStyle}
                  placeholder="1234567"
                />
              </label>
            </>
          ) : null}

          <label style={labelStyle}>
            <span style={labelTextStyle}>Email</span>
            <input
              type="email"
              autoComplete={mode === "login" ? "username" : "email"}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@example.com"
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Password</span>
            <input
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder={mode === "signup" ? "Minimum 8 characters" : ""}
            />
          </label>

          {mode === "signup" ? (
            <>
              <p
                style={{
                  ...subtitleStyle,
                  fontSize: 12,
                  marginTop: 12,
                  marginBottom: 6,
                }}
              >
                MLCC (michigan.gov MILO) credentials — same login you use for
                lara.michigan.gov to place orders. We encrypt and only use them
                to place orders on your behalf.
              </p>
              <label style={labelStyle}>
                <span style={labelTextStyle}>MLCC username</span>
                <input
                  type="text"
                  required
                  value={mlccUsername}
                  onChange={(e) => setMlccUsername(e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>MLCC password</span>
                <input
                  type="password"
                  required
                  value={mlccPassword}
                  onChange={(e) => setMlccPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </label>
              {/* Address — optional but useful for billing later */}
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 0.75,
                    marginBottom: 8,
                  }}
                >
                  Store address (optional)
                </summary>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>Street</span>
                  <input
                    type="text"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ ...labelStyle, flex: 2 }}>
                    <span style={labelTextStyle}>City</span>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...labelStyle, flex: 1 }}>
                    <span style={labelTextStyle}>State</span>
                    <input
                      type="text"
                      maxLength={2}
                      value={stateAbbr}
                      onChange={(e) =>
                        setStateAbbr(e.target.value.toUpperCase())
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...labelStyle, flex: 1 }}>
                    <span style={labelTextStyle}>ZIP</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                </div>
              </details>
            </>
          ) : null}

          {errorMsg && <div style={errorStyle}>{errorMsg}</div>}

          <button type="submit" disabled={submitting} style={buttonStyle}>
            {submitting
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {children}
      {pendingActivation ? (
        <OnboardingActivation
          storeName={pendingActivationStoreName}
          storeId={pendingActivationStoreId}
          onComplete={() => {
            setPendingActivation(false);
            setPendingActivationStoreId(null);
          }}
        />
      ) : null}
    </>
  );
}

function humanizeSignupError(code?: string): string {
  switch (code) {
    case "invalid_email":
      return "That email looks invalid.";
    case "password_too_short_min_8":
      return "Password must be at least 8 characters.";
    case "store_name_required":
      return "Store name is required.";
    case "liquor_license_invalid":
      return "Liquor license must be 5–10 digits.";
    case "mlcc_credentials_required":
      return "MLCC username and password are required.";
    case "email_in_use":
      return "An account already exists with that email. Try signing in.";
    case "credential_encryption_failed":
      return "We couldn't securely save your MLCC credentials. Please try again.";
    default:
      return code ? `Sign-up failed: ${code}` : "Sign-up failed.";
  }
}

// Inline styles to avoid adding a CSS dependency for the gate alone. The
// scanner uses its own global CSS for the main app; this login screen is
// rarely seen after first use.
const shellStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0b0d12",
  color: "#fff",
  padding: 16,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

const loadingStyle = {
  ...shellStyle,
} as const;

const cardStyle = {
  width: "100%",
  maxWidth: 360,
  background: "#15181f",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
  display: "flex",
  flexDirection: "column",
  gap: 14,
} as const;

const titleStyle = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  letterSpacing: -0.2,
} as const;

const subtitleStyle = {
  fontSize: 14,
  opacity: 0.7,
  margin: "0 0 6px 0",
} as const;

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
} as const;

const labelTextStyle = {
  fontSize: 13,
  opacity: 0.85,
} as const;

const inputStyle = {
  background: "#0b0d12",
  border: "1px solid #2a2f3a",
  color: "#fff",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 16, // 16px prevents iOS Safari from zooming the page on focus
  outline: "none",
} as const;

const errorStyle = {
  color: "#ff7a7a",
  fontSize: 13,
  background: "rgba(255, 122, 122, 0.08)",
  border: "1px solid rgba(255, 122, 122, 0.3)",
  padding: "8px 10px",
  borderRadius: 6,
} as const;

const buttonStyle = {
  background: "#3a82f7",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 4,
} as const;

const tabStyle = {
  flex: 1,
  background: "transparent",
  color: "rgba(255,255,255,0.6)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
} as const;

const tabActiveStyle = {
  background: "rgba(58, 130, 247, 0.18)",
  color: "#fff",
  borderColor: "rgba(58, 130, 247, 0.6)",
} as const;
