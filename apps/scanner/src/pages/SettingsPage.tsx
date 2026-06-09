/**
 * Settings page — store profile, MLCC connection, credentials, legal, account.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { getSmartCards, type StoreVerificationMeta } from "../api/home";
import { MlccCredentialsForm } from "../components/MlccCredentialsForm";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconLoader,
  IconLogOut,
  IconPlug,
  IconStore,
} from "../components/Icons";
import { useMlccVerifyProbe } from "../hooks/useMlccVerifyProbe";
import { clearCurrentStoreId, getCurrentStoreId } from "../lib/currentStore";
import { useCachedResource } from "../lib/swr";
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

export function SettingsPage() {
  const storeId = getCurrentStoreId() ?? "none";
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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

  return (
    <div className="page-shell settings-page">
      <header className="page-header">
        <Link to="/more" className="page-header__back" aria-label="Back to More">
          <IconChevronLeft size={20} strokeWidth={2} />
        </Link>
        <h1>Settings</h1>
      </header>

      {metaError ? (
        <div className="banner banner-err settings-page__fetch-err">
          Couldn&apos;t load store info: {metaError}
        </div>
      ) : null}

      {/* ─── Store ─── */}
      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon" aria-hidden>
            <IconStore size={20} strokeWidth={1.75} />
          </span>
          <h2 className="settings-section__title">Store</h2>
        </div>
        {metaRes.loading && !storeMeta ? (
          <p className="settings-section__desc muted">Loading store info…</p>
        ) : (
          <dl className="settings-dl">
            <div className="settings-dl__row">
              <dt>Store name</dt>
              <dd>{storeMeta?.store_name?.trim() || "—"}</dd>
            </div>
            <div className="settings-dl__row">
              <dt>Liquor license</dt>
              <dd className="mono">{storeMeta?.liquor_license?.trim() || "—"}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* ─── MLCC connection ─── */}
      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon" aria-hidden>
            <IconPlug size={20} strokeWidth={1.75} />
          </span>
          <h2 className="settings-section__title">MLCC connection</h2>
        </div>
        <p className="settings-section__desc">
          Confirms your MILO login works. Usually takes 30–60 seconds.
        </p>

        <div
          className={
            verifiedAt
              ? "settings-status settings-status--ok"
              : "settings-status settings-status--warn"
          }
        >
          {verifiedAt ? (
            <IconCheck size={18} strokeWidth={2} aria-hidden />
          ) : (
            <IconPlug size={18} strokeWidth={1.75} aria-hidden />
          )}
          <div>
            <div className="settings-status__label">
              {verifiedAt ? "Last verified" : "Not verified yet"}
            </div>
            <div className="settings-status__value">
              {formatVerifiedAt(verifiedAt)}
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
      </section>

      {/* ─── MLCC credentials ─── */}
      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon" aria-hidden>
            <IconPlug size={20} strokeWidth={1.75} />
          </span>
          <h2 className="settings-section__title">MLCC credentials</h2>
        </div>
        <p className="settings-section__desc">
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
      </section>

      {/* ─── Legal ─── */}
      <section className="settings-section settings-section--links">
        <div className="settings-section__head">
          <span className="settings-section__icon" aria-hidden>
            <IconFileText size={20} strokeWidth={1.75} />
          </span>
          <h2 className="settings-section__title">Legal</h2>
        </div>
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
      </section>

      {/* ─── Account ─── */}
      <section className="settings-section">
        <div className="settings-section__head">
          <span className="settings-section__icon" aria-hidden>
            <IconLogOut size={20} strokeWidth={1.75} />
          </span>
          <h2 className="settings-section__title">Account</h2>
        </div>
        <p className="settings-section__desc settings-version">
          Liquor Kings Scanner v{APP_VERSION}
        </p>
        <button
          type="button"
          className="settings-btn settings-btn--danger"
          onClick={() => setConfirmSignOut(true)}
        >
          <IconLogOut size={18} strokeWidth={1.9} aria-hidden />
          Sign out
        </button>
      </section>

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
