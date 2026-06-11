/**
 * Settings page — store profile, MLCC connection, credentials, legal, account.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSmartCards, type StoreVerificationMeta } from "../api/home";
import {
  createStore,
  getMyStores,
  type StoreListItem,
} from "../api/stores";
import { MlccCredentialsForm } from "../components/MlccCredentialsForm";
import {
  IconAlert,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconLoader,
  IconLogOut,
  IconPlug,
  IconStore,
  IconX,
} from "../components/Icons";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import { useMlccVerifyProbe } from "../hooks/useMlccVerifyProbe";
import {
  clearCurrentStoreId,
  getCurrentStoreId,
  setCurrentStoreId,
} from "../lib/currentStore";
import { clearAllCache, useCachedResource } from "../lib/swr";
import { signOut } from "../lib/supabase";

const APP_VERSION =
  (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ?? "0.1.0";

function formatVerifiedAt(iso: string | null | undefined): string {
  if (!iso) return "Never verified";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type ConnectionTone = "checking" | "connected" | "problem" | "success";

function getConnectionTone(
  verifiedAt: string | null,
  verifyState: ReturnType<typeof useMlccVerifyProbe>["state"],
): ConnectionTone {
  if (verifyState.kind === "running") return "checking";
  if (verifyState.kind === "failed") return "problem";
  if (verifyState.kind === "succeeded") return "success";
  if (verifiedAt) return "connected";
  return "problem";
}

function AddStoreModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (storeId: string) => void;
}) {
  useLockBodyScroll();
  const [storeName, setStoreName] = useState("");
  const [liquorLicense, setLiquorLicense] = useState("");
  const [mlccUsername, setMlccUsername] = useState("");
  const [mlccPassword, setMlccPassword] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const r = await createStore({
      store_name: storeName,
      liquor_license: liquorLicense,
      mlcc_username: mlccUsername,
      mlcc_password: mlccPassword,
      address_line1: addressLine1 || undefined,
      city: city || undefined,
      state: state || undefined,
      postal_code: postalCode || undefined,
    });
    setSubmitting(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onCreated(r.store_id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mstore-add-title"
      className="confirm-overlay"
      onClick={onClose}
    >
      <div
        className="confirm-card mstore-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mstore-modal__head">
          <h2 id="mstore-add-title" className="confirm-title">
            Add another store
          </h2>
          <button
            type="button"
            className="mstore-modal__close"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <IconX size={20} strokeWidth={2} />
          </button>
        </div>
        <p className="confirm-body">
          Register a new location under your account. After adding, we&apos;ll
          switch to it and verify MLCC on the home screen.
        </p>

        {err ? (
          <p className="auth-alert" role="alert">
            <IconAlert size={16} strokeWidth={2} aria-hidden />
            {err}
          </p>
        ) : null}

        <form className="mstore-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="mstore-field">
            <span className="mstore-field__label">Store name</span>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
              autoComplete="organization"
              disabled={submitting}
            />
          </label>
          <label className="mstore-field">
            <span className="mstore-field__label">Liquor license</span>
            <input
              type="text"
              inputMode="numeric"
              value={liquorLicense}
              onChange={(e) => setLiquorLicense(e.target.value)}
              required
              className="mono"
              disabled={submitting}
            />
          </label>
          <label className="mstore-field">
            <span className="mstore-field__label">MLCC username</span>
            <input
              type="text"
              value={mlccUsername}
              onChange={(e) => setMlccUsername(e.target.value)}
              required
              autoComplete="username"
              disabled={submitting}
            />
          </label>
          <label className="mstore-field">
            <span className="mstore-field__label">MLCC password</span>
            <input
              type="password"
              value={mlccPassword}
              onChange={(e) => setMlccPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={submitting}
            />
          </label>

          <details className="mstore-address">
            <summary>Address (optional)</summary>
            <div className="mstore-address__fields">
              <label className="mstore-field">
                <span className="mstore-field__label">Street address</span>
                <input
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  autoComplete="street-address"
                  disabled={submitting}
                />
              </label>
              <div className="mstore-address__row">
                <label className="mstore-field">
                  <span className="mstore-field__label">City</span>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    autoComplete="address-level2"
                    disabled={submitting}
                  />
                </label>
                <label className="mstore-field mstore-field--short">
                  <span className="mstore-field__label">State</span>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    autoComplete="address-level1"
                    maxLength={4}
                    disabled={submitting}
                  />
                </label>
              </div>
              <label className="mstore-field mstore-field--short">
                <span className="mstore-field__label">ZIP</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  autoComplete="postal-code"
                  disabled={submitting}
                />
              </label>
            </div>
          </details>

          <div className="confirm-actions mstore-modal__actions">
            <button
              type="button"
              className="btn secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? (
                <>
                  <IconLoader size={16} strokeWidth={2} aria-hidden />
                  Adding…
                </>
              ) : (
                "Add store"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const storeId = getCurrentStoreId() ?? "none";
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [myStores, setMyStores] = useState<StoreListItem[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [addStoreOpen, setAddStoreOpen] = useState(false);

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoresError(null);
    const r = await getMyStores();
    if (!r.ok) {
      setStoresError(r.error);
      setMyStores([]);
    } else {
      setMyStores(r.stores);
    }
    setStoresLoading(false);
  }, []);

  useEffect(() => {
    void loadStores();
  }, [loadStores, storeId]);

  const switchToStore = useCallback(
    (id: string) => {
      if (id === getCurrentStoreId()) return;
      setSwitchingId(id);
      setCurrentStoreId(id);
      clearAllCache();
      navigate("/");
    },
    [navigate],
  );

  const onStoreCreated = useCallback(
    (id: string) => {
      setAddStoreOpen(false);
      setCurrentStoreId(id);
      clearAllCache();
      navigate("/");
    },
    [navigate],
  );

  const metaRes = useCachedResource<StoreVerificationMeta | null>(
    `settings-store-meta:${storeId}`,
    async () => {
      const r = await getSmartCards();
      if (!r.ok) throw new Error(r.error);
      return r.store_meta ?? null;
    },
  );

  const storeMeta = metaRes.data;
  const verifiedAt = storeMeta?.mlcc_credentials_last_verified_at ?? null;

  const { state: verifyState, runProbe } = useMlccVerifyProbe(() => {
    void metaRes.refresh();
  });

  const metaError =
    metaRes.error instanceof Error
      ? metaRes.error.message
      : metaRes.error
        ? String(metaRes.error)
        : null;

  const connectionTone = getConnectionTone(verifiedAt, verifyState);

  return (
    <div className="page-shell settings-page">
      <header className="page-header">
        <Link to="/more" className="page-header__back" aria-label="Back to More">
          <IconChevronLeft size={20} strokeWidth={2} />
        </Link>
        <h1>Settings</h1>
      </header>

      {/* ─── Store ─── */}
      <section className="settings-block" aria-labelledby="settings-store-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconStore size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-store-title" className="settings-block__title">
            Store info
          </h2>
        </div>

        <div className="settings-card">
          {metaRes.loading && !storeMeta ? (
            <div className="settings-state settings-state--loading" role="status">
              <span className="settings-spinner" aria-hidden>
                <IconLoader size={24} strokeWidth={2} />
              </span>
              <div>
                <div className="settings-state__label">Loading store info</div>
                <p className="settings-state__desc muted small">
                  Fetching your profile from Liquor Kings…
                </p>
              </div>
            </div>
          ) : metaError ? (
            <div className="settings-state settings-state--error" role="alert">
              <IconAlert size={22} strokeWidth={2} aria-hidden />
              <div>
                <div className="settings-state__label">Couldn&apos;t load store info</div>
                <p className="settings-state__desc muted small">{metaError}</p>
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost settings-state__retry"
                  onClick={() => void metaRes.refresh()}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-store-stats" aria-label="Store details">
              <div className="orders-stat orders-stat--highlight">
                <div className="orders-stat__head">
                  <IconStore size={14} strokeWidth={2} aria-hidden />
                  Store name
                </div>
                <div className="orders-stat__value settings-store-stats__name">
                  {storeMeta?.store_name?.trim() || "—"}
                </div>
              </div>
              <div className="orders-stat">
                <div className="orders-stat__head">Liquor license</div>
                <div className="orders-stat__value mono settings-store-stats__license">
                  {storeMeta?.liquor_license?.trim() || "—"}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Your stores (multi-store switcher) ─── */}
      <section className="settings-block" aria-labelledby="settings-stores-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconStore size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-stores-title" className="settings-block__title">
            Your stores
          </h2>
        </div>

        <div className="settings-card">
          <p className="settings-card__desc">
            Switch between locations on your account. Changing stores refreshes
            the app under that store&apos;s data.
          </p>

          {storesError ? (
            <p className="auth-alert" role="alert">
              <IconAlert size={16} strokeWidth={2} aria-hidden />
              {storesError}
              <button
                type="button"
                className="mstore-retry"
                onClick={() => void loadStores()}
              >
                Try again
              </button>
            </p>
          ) : null}

          {storesLoading ? (
            <div className="mstore-skeleton" aria-hidden>
              <div className="mstore-shimmer mstore-shimmer--row" />
              <div className="mstore-shimmer mstore-shimmer--row" />
              <div className="mstore-shimmer mstore-shimmer--row" />
            </div>
          ) : (
            <ul className="mstore-list" role="list">
              {myStores.map((s) => {
                const isCurrent = s.store_id === getCurrentStoreId();
                const busy = switchingId === s.store_id;
                return (
                  <li key={s.store_id}>
                    <button
                      type="button"
                      className={`mstore-row${isCurrent ? " mstore-row--current" : ""}`}
                      onClick={() => switchToStore(s.store_id)}
                      disabled={isCurrent || switchingId !== null}
                      aria-current={isCurrent ? "true" : undefined}
                    >
                      <span className="mstore-row__icon" aria-hidden>
                        <IconStore size={18} strokeWidth={1.75} />
                      </span>
                      <span className="mstore-row__body">
                        <span className="mstore-row__name">{s.store_name}</span>
                        {s.license_tail ? (
                          <span className="mstore-row__tail mono">
                            · #{s.license_tail}
                          </span>
                        ) : null}
                      </span>
                      {busy ? (
                        <span className="mstore-row__check settings-spinner" aria-hidden>
                          <IconLoader size={18} strokeWidth={2} />
                        </span>
                      ) : isCurrent ? (
                        <span className="mstore-row__check" aria-label="Current store">
                          <IconCheck size={18} strokeWidth={2.2} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className="settings-btn settings-btn--ghost mstore-add-btn"
            onClick={() => setAddStoreOpen(true)}
            disabled={storesLoading || switchingId !== null}
          >
            <IconPlug size={18} strokeWidth={1.75} aria-hidden />
            Add another store
          </button>
        </div>
      </section>

      {/* ─── MLCC connection ─── */}
      <section className="settings-block" aria-labelledby="settings-mlcc-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconPlug size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-mlcc-title" className="settings-block__title">
            MLCC connection
          </h2>
        </div>

        <div className="settings-card">
          <p className="settings-card__desc">
            Confirms your MILO login works. Usually takes 30–60 seconds.
          </p>

          <div
            className={`settings-conn settings-conn--${connectionTone}`}
            role="status"
            aria-live="polite"
          >
            <span className="settings-conn__icon" aria-hidden>
              {connectionTone === "checking" ? (
                <span className="settings-spinner">
                  <IconLoader size={20} strokeWidth={2} />
                </span>
              ) : connectionTone === "connected" || connectionTone === "success" ? (
                <IconCheck size={20} strokeWidth={2.2} />
              ) : (
                <IconAlert size={20} strokeWidth={2} />
              )}
            </span>
            <div className="settings-conn__body">
              <div className="settings-conn__label">
                {connectionTone === "checking"
                  ? "Checking connection"
                  : connectionTone === "success"
                    ? "Connection verified"
                    : connectionTone === "connected"
                      ? "Connected to MLCC"
                      : verifiedAt
                        ? "Connection needs attention"
                        : "Not verified yet"}
              </div>
              <div className="settings-conn__value">
                {connectionTone === "checking"
                  ? "Verifying your MILO login — this may take up to a minute."
                  : connectionTone === "success"
                    ? "Your credentials are working. Orders can be placed."
                    : formatVerifiedAt(verifiedAt)}
              </div>
            </div>
          </div>

          {verifyState.kind === "running" ? (
            <div className="settings-inline-msg settings-inline-msg--running">
              <span className="settings-spinner" aria-hidden>
                <IconLoader size={18} strokeWidth={2} />
              </span>
              Verifying MLCC connection…
            </div>
          ) : null}

          {verifyState.kind === "succeeded" ? (
            <div className="banner banner-ok settings-inline-msg">
              <IconCheck size={16} strokeWidth={2} aria-hidden />
              MLCC connection verified successfully.
            </div>
          ) : null}

          {verifyState.kind === "failed" ? (
            <div className="banner banner-err settings-inline-msg">
              <IconAlert size={16} strokeWidth={2} aria-hidden />
              {verifyState.message}
            </div>
          ) : null}

          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={() => void runProbe()}
            disabled={verifyState.kind === "running"}
          >
            {verifyState.kind === "failed" ? "Retry verification" : "Re-verify connection"}
          </button>
        </div>
      </section>

      {/* ─── MLCC credentials ─── */}
      <section className="settings-block" aria-labelledby="settings-creds-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconPlug size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-creds-title" className="settings-block__title">
            MLCC credentials
          </h2>
        </div>

        <div className="settings-card">
          <p className="settings-card__desc">
            Update the MILO username or password we use to place orders on your
            behalf. Leave a field blank to keep it the same.
          </p>
          <MlccCredentialsForm
            submitLabel="Save credentials"
            onSaved={(updatedAt) => {
              setSavedAt(updatedAt);
              void metaRes.refresh();
            }}
          />
          {savedAt ? (
            <div className="banner banner-ok settings-inline-msg">
              <IconCheck size={16} strokeWidth={2} aria-hidden />
              Saved. Re-verify your connection above to confirm the new credentials.
            </div>
          ) : null}
        </div>
      </section>

      {/* ─── Legal ─── */}
      <section className="settings-block" aria-labelledby="settings-legal-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconFileText size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-legal-title" className="settings-block__title">
            Legal
          </h2>
        </div>

        <div className="settings-card settings-card--links">
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-link-row"
          >
            <span>Terms of Service</span>
            <IconChevronRight size={18} aria-hidden />
          </a>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-link-row"
          >
            <span>Privacy Policy</span>
            <IconChevronRight size={18} aria-hidden />
          </a>
        </div>
      </section>

      {/* ─── Account ─── */}
      <section className="settings-block" aria-labelledby="settings-account-title">
        <div className="settings-block__head">
          <span className="settings-block__icon" aria-hidden>
            <IconLogOut size={18} strokeWidth={1.75} />
          </span>
          <h2 id="settings-account-title" className="settings-block__title">
            Account
          </h2>
        </div>

        <div className="settings-card">
          <div className="settings-version-card">
            <div className="settings-version-card__label">App version</div>
            <div className="settings-version-card__value">v{APP_VERSION}</div>
            <p className="settings-version-card__meta muted small">
              Liquor Kings Scanner
            </p>
          </div>
          <button
            type="button"
            className="settings-btn settings-btn--danger"
            onClick={() => setConfirmSignOut(true)}
          >
            <IconLogOut size={18} strokeWidth={1.9} aria-hidden />
            Sign out
          </button>
        </div>
      </section>

      {addStoreOpen ? (
        <AddStoreModal
          onClose={() => setAddStoreOpen(false)}
          onCreated={onStoreCreated}
        />
      ) : null}

      {confirmSignOut ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-signout-title"
          className="settings-modal-backdrop"
          onClick={() => setConfirmSignOut(false)}
        >
          <div
            className="settings-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-signout-title" className="settings-modal-title">
              Sign out?
            </h2>
            <p className="settings-modal-body">
              You&apos;ll need your Liquor Kings email and password to sign back
              in. Your cart stays saved locally.
            </p>
            <div className="settings-modal-actions">
              <button
                type="button"
                className="settings-btn settings-btn--ghost"
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-btn settings-btn--danger-solid"
                onClick={() => {
                  clearCurrentStoreId();
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
