/**
 * Billing panel copy mapper (M4 client, 2026-08-09). Pure — pinned in
 * billingCopy.test.ts. Terms locked 8/8: $149/store/month flat, 14-day
 * free trial, no card until the trial ends.
 *
 * Tone ladder: ok (nothing to do) · info (heads-up) · warn (act soon)
 * · alert (ordering blocked). The Add-billing button only renders when
 * Stripe is actually configured server-side — before that, the panel
 * says plainly that no card is needed yet (never a dead button).
 */

export type BillingStatusPayload = {
  state:
    | "grandfathered"
    | "trial"
    | "trial_expired"
    | "active"
    | "past_due"
    | "canceled"
    | "unknown";
  days_left: number | null;
  configured: boolean;
  blocked: boolean;
};

export type BillingPanelCopy = {
  title: string;
  body: string;
  tone: "ok" | "info" | "warn" | "alert";
  showAddButton: boolean;
  buttonLabel: string;
};

export function describeBillingState(s: BillingStatusPayload): BillingPanelCopy {
  const button = "Add billing — $149/month";
  switch (s.state) {
    case "grandfathered":
      return {
        title: "Founding store",
        body: "No billing on this account — founding stores ride free. Thank you for building this with us.",
        tone: "ok",
        showAddButton: false,
        buttonLabel: button,
      };
    case "active":
      return {
        title: "Subscription active",
        body: "$149/month. Ordering, scanning, and everything else — all on.",
        tone: "ok",
        showAddButton: false,
        buttonLabel: button,
      };
    case "trial": {
      const n = s.days_left ?? 0;
      const days = n === 1 ? "1 day" : `${n} days`;
      return {
        title: `Free trial — ${days} left`,
        body: s.configured
          ? "After the trial it is $149/month flat. Add billing any time — you will not be charged until the trial ends."
          : "After the trial it is $149/month flat. No card needed yet — we will tell you here when billing opens.",
        tone: n <= 3 ? "warn" : "info",
        showAddButton: s.configured,
        buttonLabel: button,
      };
    }
    case "trial_expired":
      return {
        title: "Your free trial has ended",
        body: s.configured
          ? "Scanning and live prices stay free. Add billing to keep placing orders — $149/month flat, cancel anytime."
          : "Scanning and live prices stay free, and ordering still works while billing is being set up. Nothing needed from you yet.",
        tone: s.configured ? "alert" : "info",
        showAddButton: s.configured,
        buttonLabel: button,
      };
    case "past_due":
      return {
        title: "Payment issue",
        body: "Your card did not go through — it is being retried automatically and ordering still works. Updating your card fixes it fastest.",
        tone: "warn",
        showAddButton: s.configured,
        buttonLabel: "Update billing",
      };
    case "canceled":
      return {
        title: "Subscription ended",
        body: s.configured
          ? "Scanning and live prices stay free. Restart billing to place orders again — $149/month flat."
          : "Scanning and live prices stay free.",
        tone: s.configured ? "alert" : "info",
        showAddButton: s.configured,
        buttonLabel: "Restart billing",
      };
    default:
      return {
        title: "Billing",
        body: "Couldn't determine billing state. Ordering is unaffected.",
        tone: "info",
        showAddButton: false,
        buttonLabel: button,
      };
  }
}
