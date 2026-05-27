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
import { supabase } from "../lib/supabase";

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

  useEffect(() => {
    // Initial session check on mount.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Subscribe to auth changes (sign-in, sign-out, token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

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

  if (loading) {
    return (
      <div style={loadingStyle}>
        <div style={{ opacity: 0.7 }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={shellStyle}>
        <form onSubmit={handleSignIn} style={cardStyle}>
          <h1 style={titleStyle}>Liquor Kings Scanner</h1>
          <p style={subtitleStyle}>Sign in to start scanning.</p>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Email</span>
            <input
              type="email"
              autoComplete="username"
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </label>

          {errorMsg && <div style={errorStyle}>{errorMsg}</div>}

          <button type="submit" disabled={submitting} style={buttonStyle}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
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
