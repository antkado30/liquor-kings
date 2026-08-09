import { useCallback, useEffect, useMemo, useState } from "react";
import { createCheckoutSession, getBillingStatus } from "../api/billing";
import type { BillingStatusPayload } from "../lib/billingCopy";
import { describeBillingState } from "../lib/billingCopy";
import { IconAlert, IconFileText, IconLoader } from "./Icons";

/**
 * Settings › Billing (M4 client, 2026-08-09).
 *
 * Reads GET /billing/status and renders the plain-words state from
 * describeBillingState (pinned copy). The Add-billing button only
 * exists when Stripe is configured server-side — it POSTs
 * /billing/checkout-session and hands the browser to Stripe.
 *
 * Stripe returns to /scanner/settings?billing=success|canceled; we
 * read that flag once on mount for a one-line acknowledgement.
 * Success note is soft ("payment received — activating") because the
 * webhook may land seconds after the redirect; a refresh shows the
 * final state.
 */
export function BillingSection() {
  const [status, setStatus] = useState<BillingStatusPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const returnFlag = useMemo(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("billing");
    return v === "success" || v === "canceled" ? v : null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await getBillingStatus();
    if (res.ok) {
      const { ok: _ok, ...payload } = res;
      setStatus(payload);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAddBilling() {
    setLaunching(true);
    setLaunchError(null);
    const res = await createCheckoutSession();
    if (!res.ok) {
      setLaunchError(
        res.error === "billing_not_configured"
          ? "Billing isn't open yet — nothing needed from you."
          : `Couldn't open checkout: ${res.error}`,
      );
      setLaunching(false);
      return;
    }
    window.location.assign(res.url);
  }

  const copy = status ? describeBillingState(status) : null;

  return (
    <section className="settings-block" aria-labelledby="settings-billing-title">
      <div className="settings-block__head">
        <span className="settings-block__icon" aria-hidden>
          <IconFileText size={18} strokeWidth={1.75} />
        </span>
        <h2 id="settings-billing-title" className="settings-block__title">
          Billing
        </h2>
      </div>

      <div className="settings-card">
        {returnFlag === "success" ? (
          <p className="settings-card__desc billing-return billing-return--success">
            Payment received — your subscription is activating. This page
            will show it as active within a minute.
          </p>
        ) : null}
        {returnFlag === "canceled" ? (
          <p className="settings-card__desc billing-return">
            Checkout closed — nothing was charged. Add billing any time.
          </p>
        ) : null}

        {loading ? (
          <div className="settings-state settings-state--loading" role="status">
            <span className="settings-spinner" aria-hidden>
              <IconLoader size={24} strokeWidth={2} />
            </span>
            <div>
              <div className="settings-state__label">Loading billing</div>
            </div>
          </div>
        ) : loadError ? (
          <div className="settings-state settings-state--error" role="alert">
            <IconAlert size={22} strokeWidth={2} aria-hidden />
            <div>
              <div className="settings-state__label">
                Couldn&apos;t load billing
              </div>
              <p className="settings-state__desc muted small">{loadError}</p>
              <button
                type="button"
                className="settings-btn settings-btn--ghost settings-state__retry"
                onClick={() => void load()}
              >
                Try again
              </button>
            </div>
          </div>
        ) : copy ? (
          <div className={`billing-panel billing-panel--${copy.tone}`}>
            <div className="billing-panel__title">{copy.title}</div>
            <p className="settings-card__desc">{copy.body}</p>
            {copy.showAddButton ? (
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                disabled={launching}
                onClick={() => void onAddBilling()}
              >
                {launching ? "Opening secure checkout…" : copy.buttonLabel}
              </button>
            ) : null}
            {launchError ? (
              <p className="settings-card__desc muted small" role="alert">
                {launchError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
