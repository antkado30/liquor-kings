/**
 * push.routes — device registration for the "order needs you" notify layer
 * (2026-07-05). Mounted behind resolveAuthenticatedStore: every call carries a
 * real user + store context; subscriptions are store-scoped.
 *
 * GET    /push/config          → { enabled, public_key } (safe when dormant)
 * POST   /push/subscriptions   → register this device  { subscription }
 * DELETE /push/subscriptions   → unregister            { endpoint }
 */
import express from "express";
import supabase from "../config/supabase.js";
import { getVapidPublicKey, isPushConfigured } from "../lib/push-notify.js";

const router = express.Router();

router.get("/config", (req, res) => {
  const enabled = isPushConfigured();
  return res.json({
    success: true,
    data: { enabled, public_key: enabled ? getVapidPublicKey() : null },
  });
});

router.post("/subscriptions", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Push notifications aren't enabled on this server yet" });
  }

  const sub = req.body?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint.trim() : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";

  if (!endpoint.startsWith("https://") || endpoint.length > 1000 || !p256dh || !auth) {
    return res.status(400).json({ error: "A valid push subscription (endpoint + keys) is required" });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      store_id: req.store_id,
      endpoint,
      keys: { p256dh, auth },
      user_agent: String(req.headers["user-agent"] ?? "").slice(0, 300) || null,
      created_by: req.auth_user_id ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return res.status(500).json({ error: `Could not save the subscription: ${error.message}` });
  }
  return res.json({ success: true });
});

router.delete("/subscriptions", async (req, res) => {
  if (!req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
  if (!endpoint) {
    return res.status(400).json({ error: "endpoint is required" });
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("store_id", req.store_id)
    .eq("endpoint", endpoint);
  if (error) {
    return res.status(500).json({ error: `Could not remove the subscription: ${error.message}` });
  }
  return res.json({ success: true });
});

export default router;
