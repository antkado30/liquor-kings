/**
 * M4 billing routes (2026-08-08). Two surfaces:
 *
 *   billingRouter (store-authed, mounted at /billing):
 *     GET  /billing/status            — trial/billing state for Settings
 *     POST /billing/checkout-session  — Stripe Checkout URL ($149/mo)
 *
 *   handleStripeWebhook (mounted at /billing/webhook with express.raw
 *   BEFORE the app-level json parser — signature verify needs the raw
 *   bytes):
 *     checkout.session.completed        → link customer/sub, 'active'
 *     customer.subscription.updated     → mapped status
 *     customer.subscription.deleted     → 'canceled'
 *
 * billing_status is written ONLY here (webhook) — see lib/billing.js
 * safety laws. When Stripe env keys are absent every route degrades
 * honestly: status says configured:false, checkout returns 503,
 * webhook 503s (Stripe would have nothing to sign with anyway).
 */

import express from "express";
import supabase from "../config/supabase.js";
import {
  createCheckoutSession,
  ensureStripeCustomer,
  getBillingState,
  isBillingConfigured,
  mapSubscriptionStatus,
  verifyStripeWebhook,
} from "../lib/billing.js";

const router = express.Router();

const BILLING_COLUMNS =
  "id, name, store_name, billing_status, trial_ends_at, stripe_customer_id, stripe_subscription_id";

async function fetchBillingRow(storeId) {
  const { data, error } = await supabase
    .from("stores")
    .select(BILLING_COLUMNS)
    .eq("id", storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

router.get("/status", async (req, res) => {
  try {
    const store = await fetchBillingRow(req.store_id);
    if (!store) return res.status(404).json({ error: "store_not_found" });
    const state = getBillingState(store);
    return res.json({
      ok: true,
      configured: isBillingConfigured(),
      billing_status: store.billing_status,
      trial_ends_at: store.trial_ends_at,
      state: state.state,
      days_left: state.days_left,
      blocked: state.blocked,
      price_usd_month: 149,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/checkout-session", async (req, res) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ error: "billing_not_configured" });
  }
  try {
    const store = await fetchBillingRow(req.store_id);
    if (!store) return res.status(404).json({ error: "store_not_found" });

    const customerId = await ensureStripeCustomer(store);
    if (customerId !== store.stripe_customer_id) {
      const { error } = await supabase
        .from("stores")
        .update({ stripe_customer_id: customerId })
        .eq("id", store.id);
      if (error) throw new Error(error.message);
    }

    const origin =
      process.env.LK_PUBLIC_ORIGIN ?? "https://liquor-kings.fly.dev";
    const session = await createCheckoutSession({
      customerId,
      storeId: store.id,
      successUrl: `${origin}/scanner/settings?billing=success`,
      cancelUrl: `${origin}/scanner/settings?billing=canceled`,
    });
    return res.json({ ok: true, url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** Raw-body webhook handler — mount with express.raw, pre-json. */
export async function handleStripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "billing_not_configured" });

  const event = verifyStripeWebhook(
    req.body, // Buffer from express.raw
    req.headers["stripe-signature"],
    secret,
  );
  if (!event) return res.status(400).json({ error: "invalid_signature" });

  try {
    const type = event.type;
    const obj = event.data?.object ?? {};

    if (type === "checkout.session.completed") {
      const storeId = obj.client_reference_id;
      if (storeId && obj.subscription) {
        const { error } = await supabase
          .from("stores")
          .update({
            stripe_customer_id:
              typeof obj.customer === "string" ? obj.customer : undefined,
            stripe_subscription_id: obj.subscription,
            billing_status: "active",
          })
          .eq("id", storeId);
        if (error) throw new Error(error.message);
      }
    } else if (
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const mapped =
        type === "customer.subscription.deleted"
          ? "canceled"
          : mapSubscriptionStatus(obj.status);
      if (mapped && obj.id) {
        const { error } = await supabase
          .from("stores")
          .update({ billing_status: mapped })
          .eq("stripe_subscription_id", obj.id);
        if (error) throw new Error(error.message);
      }
    }
    // Unknown event types: acknowledged and ignored on purpose.
    return res.json({ received: true });
  } catch (err) {
    // 500 → Stripe retries with backoff; safe because all writes above
    // are idempotent (same values, keyed updates).
    return res.status(500).json({ error: err.message });
  }
}

export { fetchBillingRow };
export default router;
