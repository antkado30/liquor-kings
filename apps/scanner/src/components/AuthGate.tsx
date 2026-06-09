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
  IconLoader,
  IconSparkles,
  IconStore,
} from "./Icons";

type AuthGateProps = {
  children: ReactNode;
};

type SignupStep = 1 | 2;

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

  useEffect(() => {
    if (scannerMisconfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        await resolveCurrentStoreIdFromSession();
        const profile = await getMyStoreProfile();
        if (profile.ok && profile.mlcc_credentials_last_verified_at) {
          setPendingActivation(false);
        }
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, next) => {
        setSession(next);
        if (event === "SIGNED_OUT" || !next) {
          clearCurrentStoreId();
          setPendingActivation(false);
          setPendingActivationStoreId(null);
        } else if (event === "SIGNED_IN") {
          await resolveCurrentStoreIdFromSession();
        }
      },
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

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
    return (
      <div className="onboarding-shell onboarding-shell--loading">
        <span className="settings-spinner" aria-hidden>
          <IconLoader size={28} strokeWidth={2} />
        </span>
        <p className="onboarding-subtitle">Loading your account…</p>
      </div>
    );
  }

  if (scannerMisconfigured) {
    return (
      <div className="onboarding-shell">
        <div className="onboarding-card">
          <div className="onboarding-brand">
            <span className="onboarding-brand__icon" aria-hidden>
              <IconAlert size={22} strokeWidth={2} />
            </span>
            <div>
              <h1 className="onboarding-title">Scanner misconfigured</h1>
              <p className="onboarding-subtitle">
                This build is missing required configuration. Contact the person
                who set up your scanner.
              </p>
            </div>
          </div>
          <p className="onboarding-error" role="alert">
            <IconAlert size={16} strokeWidth={2} aria-hidden />
            <span>{scannerMisconfigured.reason}</span>
          </p>
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
      <div className="onboarding-shell">
        <div className="onboarding-card">
          <div className="onboarding-brand">
            <span className="onboarding-brand__icon" aria-hidden>
              <IconSparkles size={22} strokeWidth={1.9} />
            </span>
            <div>
              <h1 className="onboarding-title">Liquor Kings</h1>
              <p className="onboarding-subtitle">
                {mode === "login"
                  ? "Sign in to start scanning and ordering."
                  : "Create your store account in two quick steps."}
              </p>
            </div>
          </div>

          <div className="onboarding-tabs" role="tablist" aria-label="Account mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`onboarding-tab${mode === "login" ? " onboarding-tab--active" : ""}`}
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
              className={`onboarding-tab${mode === "signup" ? " onboarding-tab--active" : ""}`}
              onClick={() => {
                setMode("signup");
                resetErrors();
              }}
            >
              Sign up
            </button>
          </div>

          {mode === "signup" ? (
            <div className="onboarding-progress" aria-label="Signup progress">
              <span className="onboarding-progress__label">
                Step {signupStep} of 2
              </span>
              <div className="onboarding-progress__track">
                <div
                  className="onboarding-progress__fill"
                  style={{ width: signupStep === 1 ? "50%" : "100%" }}
                />
              </div>
            </div>
          ) : null}

          {mode === "login" ? (
            <form className="onboarding-form" onSubmit={handleSignIn}>
              <label className="onboarding-field">
                <span className="onboarding-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="onboarding-input"
                  placeholder="you@example.com"
                  disabled={submitting}
                />
              </label>
              <label className="onboarding-field">
                <span className="onboarding-field__label">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="onboarding-input"
                  disabled={submitting}
                />
              </label>

              {errorMsg ? (
                <p className="onboarding-error" role="alert">
                  <IconAlert size={16} strokeWidth={2} aria-hidden />
                  <span>{errorMsg}</span>
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="onboarding-btn onboarding-btn--primary onboarding-btn--block"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : signupStep === 1 ? (
            <form className="onboarding-form" onSubmit={goToSignupStep2}>
              <p className="onboarding-section-title">Step 1 — Your account</p>
              <label className="onboarding-field">
                <span className="onboarding-field__label">Store name</span>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="onboarding-input"
                  placeholder="Your store name"
                  disabled={submitting}
                />
              </label>
              <label className="onboarding-field">
                <span className="onboarding-field__label">
                  Liquor license number
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={liquorLicense}
                  onChange={(e) => setLiquorLicense(e.target.value)}
                  className="onboarding-input"
                  placeholder="1234567"
                  disabled={submitting}
                />
              </label>
              <label className="onboarding-field">
                <span className="onboarding-field__label">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="onboarding-input"
                  placeholder="you@example.com"
                  disabled={submitting}
                />
              </label>
              <label className="onboarding-field">
                <span className="onboarding-field__label">Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="onboarding-input"
                  placeholder="Minimum 8 characters"
                  disabled={submitting}
                />
              </label>

              {errorMsg ? (
                <p className="onboarding-error" role="alert">
                  <IconAlert size={16} strokeWidth={2} aria-hidden />
                  <span>{errorMsg}</span>
                </p>
              ) : null}

              <button
                type="submit"
                className="onboarding-btn onboarding-btn--primary onboarding-btn--block"
              >
                Continue
              </button>
            </form>
          ) : (
            <form className="onboarding-form" onSubmit={handleSignUp}>
              <p className="onboarding-section-title">
                Step 2 — MLCC connection
              </p>
              <p className="onboarding-hint">
                Same username and password you use at lara.michigan.gov (MILO).
                We encrypt them and only use them to place orders on your
                behalf.
              </p>
              <label className="onboarding-field">
                <span className="onboarding-field__label">MLCC username</span>
                <input
                  type="text"
                  required
                  value={mlccUsername}
                  onChange={(e) => setMlccUsername(e.target.value)}
                  className="onboarding-input"
                  autoComplete="off"
                  disabled={submitting}
                />
              </label>
              <label className="onboarding-field">
                <span className="onboarding-field__label">MLCC password</span>
                <input
                  type="password"
                  required
                  value={mlccPassword}
                  onChange={(e) => setMlccPassword(e.target.value)}
                  className="onboarding-input"
                  autoComplete="off"
                  disabled={submitting}
                />
              </label>

              <details className="onboarding-details">
                <summary>Store address (optional)</summary>
                <label className="onboarding-field">
                  <span className="onboarding-field__label">Street</span>
                  <input
                    type="text"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    className="onboarding-input"
                    disabled={submitting}
                  />
                </label>
                <div className="onboarding-field-row">
                  <label className="onboarding-field">
                    <span className="onboarding-field__label">City</span>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="onboarding-input"
                      disabled={submitting}
                    />
                  </label>
                  <label className="onboarding-field">
                    <span className="onboarding-field__label">State</span>
                    <input
                      type="text"
                      maxLength={2}
                      value={stateAbbr}
                      onChange={(e) =>
                        setStateAbbr(e.target.value.toUpperCase())
                      }
                      className="onboarding-input"
                      disabled={submitting}
                    />
                  </label>
                  <label className="onboarding-field">
                    <span className="onboarding-field__label">ZIP</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="onboarding-input"
                      disabled={submitting}
                    />
                  </label>
                </div>
              </details>

              {errorMsg ? (
                <p className="onboarding-error" role="alert">
                  <IconAlert size={16} strokeWidth={2} aria-hidden />
                  <span>{errorMsg}</span>
                </p>
              ) : null}

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-btn onboarding-btn--secondary"
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
                  className="onboarding-btn onboarding-btn--primary"
                >
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              </div>

              <p className="onboarding-hint">
                <IconStore
                  size={14}
                  strokeWidth={1.8}
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                  aria-hidden
                />
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
