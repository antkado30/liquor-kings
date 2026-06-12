/**
 * AuthGate — wraps the scanner SPA and gates it behind Supabase Auth.
 *
 * Flow for new stores:
 *   Step 1 — account (email, password, store basics)
 *   Step 2 — MLCC credentials → POST /auth/signup
 *   Activation probe → scanner
 *
 * Returning verified users land in the scanner with no friction.
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
import {
  getMyStoreProfile,
  humanizeLoginError,
  humanizeNetworkError,
  humanizeSignupError,
} from "../api/me";
import { OnboardingActivation } from "./OnboardingActivation";
import {
  IconAlert,
  IconSparkles,
  IconStore,
} from "./Icons";

type AuthGateProps = {
  children: ReactNode;
};

type SignupStep = 1 | 2;

function AuthAlert({ message }: { message: string }) {
  return (
    <p className="auth-alert" role="alert">
      <IconAlert size={16} strokeWidth={2} aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function AuthLoadingSkeleton() {
  return (
    <div className="auth-shell auth-shell--loading">
      <div className="auth-card auth-card--skeleton" aria-hidden>
        <div className="auth-shimmer auth-shimmer--brand" />
        <div className="auth-shimmer auth-shimmer--line" />
        <div className="auth-shimmer auth-shimmer--tabs" />
        <div className="auth-shimmer auth-shimmer--input" />
        <div className="auth-shimmer auth-shimmer--input" />
        <div className="auth-shimmer auth-shimmer--btn" />
      </div>
      <p className="auth-subtitle auth-subtitle--loading">Loading your account…</p>
    </div>
  );
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">(() => {
    if (typeof window !== "undefined" && window.location.hash === "#signup") {
      return "signup";
    }
    return "login";
  });
  const [signupStep, setSignupStep] = useState<SignupStep>(1);
  const [storeName, setStoreName] = useState("");
  const [liquorLicense, setLiquorLicense] = useState("");
  const [mlccUsername, setMlccUsername] = useState("");
  const [mlccPassword, setMlccPassword] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateAbbr, setStateAbbr] = useState("MI");
  const [postalCode, setPostalCode] = useState("");
  const [pendingActivation, setPendingActivation] = useState(false);
  const [pendingActivationStoreName, setPendingActivationStoreName] =
    useState<string>("");
  const [pendingActivationStoreId, setPendingActivationStoreId] =
    useState<string | null>(null);
  /** Non-null when the account boot failed/timed out — renders a Retry screen. */
  const [bootError, setBootError] = useState<string | null>(null);
  /** Bumped by the Retry button; re-runs the boot effect. */
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    if (scannerMisconfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    /*
      Account-boot hardening (2026-06-12 P0: "Loading your account…" spun
      for 5+ minutes). Two booby traps lived here:
        1. The boot chain had NO catch/finally — any rejection meant
           setLoading(false) never ran: permanent skeleton.
        2. resolveCurrentStoreIdFromSession's Supabase REST call has no
           timeout — a hanging connection froze the await forever.
      Now every leg is time-bounded, every failure lands in a visible
      error screen with a Retry button, and loading ALWAYS resolves.
      (Quality mandate: if data isn't ready the UI says so — it never
      freezes, never spins blind.)
    */
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
        ),
      ]);

    void (async () => {
      setBootError(null);
      setLoading(true);
      try {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          10_000,
          "auth session check",
        );
        if (cancelled) return;
        setSession(data.session);
        if (data.session) {
          await withTimeout(
            resolveCurrentStoreIdFromSession(),
            10_000,
            "store membership lookup",
          );
          if (cancelled) return;
          // getMyStoreProfile is internally bounded (8s timeout + retry).
          const profile = await getMyStoreProfile();
          if (!cancelled && profile.ok && profile.mlcc_credentials_last_verified_at) {
            setPendingActivation(false);
          }
        }
      } catch {
        if (!cancelled) {
          setBootError(
            "We couldn't load your account — the connection looks slow or down.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      /*
        IMPORTANT: this callback must stay synchronous. Awaiting
        resolveCurrentStoreIdFromSession here is a documented supabase-js
        deadlock: the callback holds the auth lock that getSession()
        (called inside the resolve) then waits on. Defer to a macrotask
        so the lock is released first.
      */
      setSession(next);
      if (event === "SIGNED_OUT" || !next) {
        clearCurrentStoreId();
        setPendingActivation(false);
        setPendingActivationStoreId(null);
      } else if (event === "SIGNED_IN") {
        setTimeout(() => {
          void resolveCurrentStoreIdFromSession().catch(() => {
            /* next API call will surface the missing store loudly */
          });
        }, 0);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [bootAttempt]);

  function resetErrors() {
    setErrorMsg(null);
  }

  function validateSignupStep1(): string | null {
    if (!storeName.trim()) return "Store name is required.";
    if (!/^\d{5,10}$/.test(liquorLicense.trim())) {
      return "Liquor license must be 5–10 digits.";
    }
    if (!email.trim() || !email.includes("@")) {
      return "Enter a valid email address.";
    }
    if (password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    return null;
  }

  function validateSignupStep2(): string | null {
    if (!mlccUsername.trim() || !mlccPassword) {
      return "MLCC username and password are required.";
    }
    return null;
  }

  function goToSignupStep2(e: FormEvent) {
    e.preventDefault();
    resetErrors();
    const err = validateSignupStep1();
    if (err) {
      setErrorMsg(err);
      return;
    }
    setSignupStep(2);
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    resetErrors();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setErrorMsg(humanizeLoginError(error.message));
        return;
      }
      const profile = await getMyStoreProfile();
      if (profile.ok && profile.mlcc_credentials_last_verified_at) {
        setPendingActivation(false);
      }
    } catch (err) {
      setErrorMsg(
        humanizeNetworkError(
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    resetErrors();
    const step1Err = validateSignupStep1();
    if (step1Err) {
      setSignupStep(1);
      setErrorMsg(step1Err);
      return;
    }
    const step2Err = validateSignupStep2();
    if (step2Err) {
      setErrorMsg(step2Err);
      return;
    }

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

      let body: {
        ok?: boolean;
        error?: string;
        store_id?: string;
      };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        setErrorMsg(humanizeNetworkError("network_error"));
        return;
      }

      if (!res.ok || body.ok !== true) {
        setErrorMsg(humanizeSignupError(body.error));
        return;
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setErrorMsg(
          `Account created but couldn't sign in: ${humanizeLoginError(signInErr.message)}. Switch to Sign in.`,
        );
        return;
      }

      if (body.store_id) setCurrentStoreId(body.store_id);
      setPendingActivationStoreName(storeName.trim() || "your store");
      setPendingActivationStoreId(body.store_id ?? null);
      setPendingActivation(true);
    } catch (err) {
      setErrorMsg(
        humanizeNetworkError(
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <AuthLoadingSkeleton />;
  }

  if (bootError) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand__badge auth-brand__badge--warn" aria-hidden>
              <IconAlert size={18} strokeWidth={2} />
            </span>
            <span className="auth-brand__name">Liquor Kings</span>
          </div>
          <AuthAlert message={bootError} />
          <button
            type="button"
            className="btn btn-block"
            onClick={() => setBootAttempt((a) => a + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (scannerMisconfigured) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand__badge auth-brand__badge--warn" aria-hidden>
              <IconAlert size={22} strokeWidth={2} />
            </span>
            <div>
              <h1 className="auth-wordmark">
                <span className="auth-wordmark__liquor">Liquor</span>{" "}
                <span className="auth-wordmark__kings">Kings</span>
              </h1>
              <p className="auth-subtitle">
                This build is missing required configuration. Contact the person
                who set up your scanner.
              </p>
            </div>
          </div>
          <AuthAlert message={scannerMisconfigured.reason} />
        </div>
      </div>
    );
  }

  if (session && pendingActivation) {
    return (
      <OnboardingActivation
        storeName={pendingActivationStoreName}
        storeId={pendingActivationStoreId}
        onComplete={() => {
          setPendingActivation(false);
          setPendingActivationStoreId(null);
        }}
      />
    );
  }

  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand__badge" aria-hidden>
              <IconSparkles size={22} strokeWidth={1.9} />
            </span>
            <div>
              <h1 className="auth-wordmark">
                <span className="auth-wordmark__liquor">Liquor</span>{" "}
                <span className="auth-wordmark__kings">Kings</span>
              </h1>
              <p className="auth-subtitle">
                {mode === "login"
                  ? "Sign in to start scanning and ordering."
                  : "Create your store account in two quick steps."}
              </p>
            </div>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Account mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`auth-tab${mode === "login" ? " auth-tab--active" : ""}`}
              onClick={() => {
                setMode("login");
                resetErrors();
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={`auth-tab${mode === "signup" ? " auth-tab--active" : ""}`}
              onClick={() => {
                setMode("signup");
                resetErrors();
              }}
            >
              Sign up
            </button>
          </div>

          {mode === "signup" ? (
            <div className="auth-progress" aria-label="Signup progress">
              <span className="auth-progress__label">
                Step {signupStep} of 2
              </span>
              <div className="auth-progress__track">
                <div
                  className="auth-progress__fill"
                  style={{ width: signupStep === 1 ? "50%" : "100%" }}
                />
              </div>
            </div>
          ) : null}

          {mode === "login" ? (
            <form className="auth-form" onSubmit={handleSignIn}>
              <label className="auth-field">
                <span className="auth-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder="you@example.com"
                  disabled={submitting}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  disabled={submitting}
                />
              </label>

              {errorMsg ? <AuthAlert message={errorMsg} /> : null}

              <button
                type="submit"
                disabled={submitting}
                className="auth-btn auth-btn--primary auth-btn--block"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : signupStep === 1 ? (
            <form className="auth-form" onSubmit={goToSignupStep2}>
              <p className="auth-section-title">Step 1 — Your account</p>
              <label className="auth-field">
                <span className="auth-field__label">Store name</span>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="auth-input"
                  placeholder="Your store name"
                  disabled={submitting}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">
                  Liquor license number
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={liquorLicense}
                  onChange={(e) => setLiquorLicense(e.target.value)}
                  className="auth-input"
                  placeholder="1234567"
                  disabled={submitting}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder="you@example.com"
                  disabled={submitting}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  placeholder="Minimum 8 characters"
                  disabled={submitting}
                />
              </label>

              {errorMsg ? <AuthAlert message={errorMsg} /> : null}

              <button
                type="submit"
                className="auth-btn auth-btn--primary auth-btn--block"
              >
                Continue
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleSignUp}>
              <p className="auth-section-title">
                Step 2 — MLCC connection
              </p>
              <p className="auth-hint">
                Same username and password you use at lara.michigan.gov (MILO).
                We encrypt them and only use them to place orders on your
                behalf.
              </p>
              <label className="auth-field">
                <span className="auth-field__label">MLCC username</span>
                <input
                  type="text"
                  required
                  value={mlccUsername}
                  onChange={(e) => setMlccUsername(e.target.value)}
                  className="auth-input"
                  autoComplete="off"
                  disabled={submitting}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">MLCC password</span>
                <input
                  type="password"
                  required
                  value={mlccPassword}
                  onChange={(e) => setMlccPassword(e.target.value)}
                  className="auth-input"
                  autoComplete="off"
                  disabled={submitting}
                />
              </label>

              <details className="auth-details">
                <summary>Store address (optional)</summary>
                <label className="auth-field">
                  <span className="auth-field__label">Street</span>
                  <input
                    type="text"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    className="auth-input"
                    disabled={submitting}
                  />
                </label>
                <div className="auth-field-row">
                  <label className="auth-field">
                    <span className="auth-field__label">City</span>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="auth-input"
                      disabled={submitting}
                    />
                  </label>
                  <label className="auth-field">
                    <span className="auth-field__label">State</span>
                    <input
                      type="text"
                      maxLength={2}
                      value={stateAbbr}
                      onChange={(e) =>
                        setStateAbbr(e.target.value.toUpperCase())
                      }
                      className="auth-input"
                      disabled={submitting}
                    />
                  </label>
                  <label className="auth-field">
                    <span className="auth-field__label">ZIP</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="auth-input"
                      disabled={submitting}
                    />
                  </label>
                </div>
              </details>

              {errorMsg ? <AuthAlert message={errorMsg} /> : null}

              <div className="auth-actions">
                <button
                  type="button"
                  className="auth-btn auth-btn--secondary"
                  disabled={submitting}
                  onClick={() => {
                    resetErrors();
                    setSignupStep(1);
                  }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="auth-btn auth-btn--primary"
                >
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              </div>

              <p className="auth-hint auth-hint--icon">
                <IconStore size={14} strokeWidth={1.8} aria-hidden />
                Next we&apos;ll verify your MLCC connection (~30–60s) before
                opening the scanner.
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
