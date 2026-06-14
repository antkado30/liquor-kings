/**
 * Public auth routes — sign-up for new stores (task #78, 2026-06-06).
 *
 * Mounted at /auth WITHOUT the resolveAuthenticatedStore middleware
 * because new users (definition: don't have an account yet) can't
 * carry a session bearer. The single public endpoint here is
 * POST /auth/signup which provisions everything a new store needs to
 * walk into the scanner experience:
 *
 *   1. Supabase Auth user (email + password)
 *   2. stores row (store_name, address, liquor_license, encrypted
 *      MLCC creds)
 *   3. store_users row linking the auth user → store
 *
 * After signup the caller signs in via Supabase Auth client-side and
 * navigates to /scanner. No manual LK-side provisioning required.
 *
 * Security:
 *   - This endpoint is rate-limit-friendly: it's idempotent on email
 *     (duplicate email → returns the same email-conflict error) but
 *     creates real resources, so we should add cron-side rate limiting
 *     later. Stage 1 ship just accepts traffic.
 *   - MLCC credentials are encrypted with LK_CREDENTIAL_ENCRYPTION_KEY
 *     before write — same pattern as the existing store-mlcc-credentials
 *     route used by Tony for dad's store.
 *   - The Supabase Admin API runs server-side with the service role
 *     key so the user is created with email_confirm=true; we skip the
 *     email-verification step for V1 launch and add it later.
 */

import express from "express";
import { createClient } from "@supabase/supabase-js";
import supabase from "../config/supabase.js";
import { encryptCredential } from "../lib/credential-encryption.js";
import { resolveAuthenticatedStore } from "../middleware/resolve-store.middleware.js";
import { DIAGNOSTIC_KIND, logSystemDiagnostic } from "../services/diagnostics.service.js";

/**
 * Best-effort rollback of a partially-created auth user. If the delete
 * itself fails, log it loudly instead of swallowing — an orphaned auth
 * user with no store row permanently burns that email for future signups
 * with zero trace (scan-everything pass, 2026-06-13; was `.catch(() => {})`).
 */
async function rollbackAuthUser(supabaseAdmin, userId, reason) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.SIGNUP_ROLLBACK_FAILED,
      userId,
      payload: { reason, delete_error: error.message },
    });
  }
}

const router = express.Router();

const MIN_PASSWORD_LEN = 8;
const MAX_FIELD_LEN = 200;

/*
 * In-memory rate limiter for the public signup endpoint.
 *
 * Limits each IP to 5 signups per hour. Without this a bot could
 * pound /auth/signup and create thousands of throwaway accounts,
 * burn through our Supabase auth.users table, and rack up email
 * verification calls. In-memory state (vs Redis) is fine for a
 * single-instance Fly deployment; if we ever go multi-region we
 * swap this for a Supabase row-based counter.
 *
 * Sliding window: every entry stores [ip → timestamp[]]. On each
 * request we drop timestamps older than the window and check count.
 */
const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SIGNUP_MAX_PER_WINDOW = 5;
const signupAttempts = new Map();

function rateLimitSignup(req) {
  // Trust X-Forwarded-For from Fly (single hop). Fall back to remote addr.
  const ip =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : "") ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const recent = (signupAttempts.get(ip) ?? []).filter(
    (t) => now - t < SIGNUP_WINDOW_MS,
  );
  if (recent.length >= SIGNUP_MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.ceil(SIGNUP_WINDOW_MS / 1000) };
  }
  recent.push(now);
  signupAttempts.set(ip, recent);
  // Periodic cleanup: prune entries with no recent activity. Runs on a
  // 1-in-100 sampling so we don't iterate the whole map every request.
  if (Math.random() < 0.01) {
    for (const [k, v] of signupAttempts) {
      const fresh = v.filter((t) => now - t < SIGNUP_WINDOW_MS);
      if (fresh.length === 0) signupAttempts.delete(k);
      else signupAttempts.set(k, fresh);
    }
  }
  return { ok: true };
}

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isLicenseNumber(s) {
  // MLCC license numbers are 6-7 digits. Allow some slack for legacy formats.
  return typeof s === "string" && /^\d{5,10}$/.test(String(s).trim());
}

function trimField(v, max = MAX_FIELD_LEN) {
  return String(v ?? "").trim().slice(0, max);
}

/**
 * POST /auth/signup
 *
 * Body: {
 *   email, password,
 *   store_name, liquor_license,
 *   mlcc_username, mlcc_password,
 *   address_line1?, city?, state?, postal_code?
 * }
 *
 * Returns: { ok: true, store_id, user_id, email } so the client can
 * immediately call supabase.auth.signInWithPassword({ email, password })
 * with confidence.
 */
router.post("/signup", express.json(), async (req, res) => {
  // Rate limit BEFORE doing any DB work so a bot can't burn cycles.
  const limit = rateLimitSignup(req);
  if (!limit.ok) {
    return res.status(429).json({
      ok: false,
      error: "rate_limited",
      retry_after_seconds: limit.retryAfterSec,
    });
  }
  try {
    const body = req.body ?? {};
    const email = trimField(body.email, 320).toLowerCase();
    const password = String(body.password ?? "");
    const store_name = trimField(body.store_name);
    const liquor_license = trimField(body.liquor_license, 20);
    const mlcc_username = trimField(body.mlcc_username, 200);
    const mlcc_password = String(body.mlcc_password ?? "");
    const address_line1 = trimField(body.address_line1);
    const city = trimField(body.city, 80);
    const state = trimField(body.state, 4).toUpperCase();
    const postal_code = trimField(body.postal_code, 10);

    // Validate up-front so we never half-create resources.
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return res
        .status(400)
        .json({ ok: false, error: `password_too_short_min_${MIN_PASSWORD_LEN}` });
    }
    if (!store_name) {
      return res.status(400).json({ ok: false, error: "store_name_required" });
    }
    if (!isLicenseNumber(liquor_license)) {
      return res
        .status(400)
        .json({ ok: false, error: "liquor_license_invalid" });
    }
    if (!mlcc_username || !mlcc_password) {
      return res
        .status(400)
        .json({ ok: false, error: "mlcc_credentials_required" });
    }

    /*
     * We need the admin API to create users (anon flow requires email
     * confirmation flow which we're skipping for V1). The service role
     * client is the same one supabase.js exports — it's already
     * authenticated as service_role.
     */
    const supabaseAdmin = supabase;

    // 1. Create the auth user. Email confirm true so they can sign in
    //    immediately. The email-verification flow comes later.
    const { data: authUser, error: authErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          store_name,
          signup_source: "self_serve",
        },
      });
    if (authErr) {
      // Common case: email already in use.
      if (/already/i.test(authErr.message)) {
        return res.status(409).json({ ok: false, error: "email_in_use" });
      }
      return res.status(500).json({ ok: false, error: authErr.message });
    }
    const userId = authUser?.user?.id;
    if (!userId) {
      return res
        .status(500)
        .json({ ok: false, error: "auth_user_not_returned" });
    }

    // 2. Encrypt MLCC password before writing.
    let mlcc_password_encrypted;
    try {
      mlcc_password_encrypted = encryptCredential(mlcc_password);
    } catch (encErr) {
      // Roll back the auth user if we can't encrypt — never leave a
      // user without a store.
      await rollbackAuthUser(supabaseAdmin, userId, "credential_encryption_failed");
      return res.status(500).json({
        ok: false,
        error: "credential_encryption_failed",
        details: encErr?.message,
      });
    }

    // 3. Create the store row.
    const { data: store, error: storeErr } = await supabaseAdmin
      .from("stores")
      .insert({
        store_name,
        liquor_license,
        mlcc_username,
        mlcc_password_encrypted,
        address_line1: address_line1 || null,
        city: city || null,
        state: state || "MI",
        postal_code: postal_code || null,
        is_active: true,
      })
      .select("id, store_name")
      .single();
    if (storeErr) {
      // Roll back the auth user so the email isn't permanently burned.
      await rollbackAuthUser(supabaseAdmin, userId, "store_insert_failed");
      return res.status(500).json({ ok: false, error: storeErr.message });
    }

    // 4. Link auth user → store.
    const { error: linkErr } = await supabaseAdmin
      .from("store_users")
      .insert({
        user_id: userId,
        store_id: store.id,
        is_active: true,
        role: "owner",
      });
    if (linkErr) {
      // Roll back both the store and the auth user.
      await supabaseAdmin.from("stores").delete().eq("id", store.id);
      await rollbackAuthUser(supabaseAdmin, userId, "store_users_link_failed");
      return res.status(500).json({ ok: false, error: linkErr.message });
    }

    return res.status(201).json({
      ok: true,
      store_id: store.id,
      store_name: store.store_name,
      user_id: userId,
      email,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/**
 * PATCH /auth/me/mlcc-credentials (task #86, 2026-06-06)
 *
 * Recovery path for users who entered wrong MLCC creds at signup
 * (the activation probe fails, leaving them locked out otherwise),
 * AND for legitimate password rotation later.
 *
 * Auth-gated by resolveAuthenticatedStore — the route reads the
 * caller's store_id from their JWT membership. There is no way to
 * update another store's creds; the middleware enforces it.
 *
 * Body: { mlcc_username?, mlcc_password? }
 *   - Either field can be omitted to leave it unchanged.
 *   - mlcc_password is re-encrypted with the same AES-256-GCM key.
 *
 * Stamps `mlcc_credentials_updated_at` so the Founder Console can
 * surface "creds rotated N days ago" when triaging failed runs.
 *
 * Returns: { ok: true, updated_at }
 */
router.patch(
  "/me/mlcc-credentials",
  express.json(),
  resolveAuthenticatedStore,
  async (req, res) => {
    try {
      const storeId = req.store_id;
      if (!storeId) {
        return res.status(403).json({ ok: false, error: "no_store_for_user" });
      }
      const body = req.body ?? {};
      const newUsername =
        body.mlcc_username !== undefined
          ? trimField(body.mlcc_username, 200)
          : null;
      const newPasswordPlain =
        body.mlcc_password !== undefined ? String(body.mlcc_password) : null;

      if (newUsername === null && newPasswordPlain === null) {
        return res
          .status(400)
          .json({ ok: false, error: "nothing_to_update" });
      }
      if (newUsername !== null && newUsername.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "mlcc_username_required" });
      }
      if (newPasswordPlain !== null && newPasswordPlain.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "mlcc_password_required" });
      }

      const patch = {
        mlcc_credentials_updated_at: new Date().toISOString(),
      };
      if (newUsername !== null) patch.mlcc_username = newUsername;
      if (newPasswordPlain !== null) {
        try {
          patch.mlcc_password_encrypted = encryptCredential(newPasswordPlain);
        } catch (encErr) {
          return res.status(500).json({
            ok: false,
            error: "credential_encryption_failed",
            details: encErr?.message,
          });
        }
      }

      const { data, error } = await supabase
        .from("stores")
        .update(patch)
        .eq("id", storeId)
        .select("id, mlcc_credentials_updated_at")
        .single();

      if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }

      /*
       * Bust the persistent MILO session for this store — the worker
       * caches a logged-in Playwright session keyed by store_id. After
       * a credential change, that cached session is logged in as the
       * OLD user; the next run must re-login with the new creds.
       *
       * For V1 we just blow away any session marker the worker reads;
       * the worker itself will detect "no warm session" and start
       * fresh. (If we miss this, the immediate next run might appear
       * to "still work" because it uses the warm session, masking a
       * real cred problem until the warm session expires.)
       *
       * Implementation note: this is a fire-and-forget bust. If the
       * worker process can't be reached (different Fly machine, etc.)
       * the warm session's TTL eventually expires anyway — the cost
       * is the user might think creds work for a few minutes longer
       * than they do. Acceptable tradeoff for V1 ship speed.
       */
      // No-op for now — leaves a hook here for when we add the warm-
      // session-invalidation message.

      return res.status(200).json({
        ok: true,
        updated_at: data?.mlcc_credentials_updated_at ?? null,
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

/**
 * POST /auth/me/stores — add ANOTHER store to the signed-in owner's
 * account (multi-store V1, Tony 2026-06-10: "multi-store has to be a
 * version one feature... it has to be under that person's name").
 *
 * Same-owner rule enforced structurally: the new store is linked to
 * req.auth_user_id (the verified session user) — there is no way to
 * attach it to anyone else. Service-role callers are refused; this is
 * an owner action, not an ops action.
 *
 * Mirrors the signup flow's store-creation steps (validate → encrypt
 * creds → create store → link membership, with rollback) minus the
 * auth-user creation. The new store starts unverified — the client
 * runs the standard activation probe against it after switching.
 *
 * Body: { store_name, liquor_license, mlcc_username, mlcc_password,
 *         address_line1?, city?, state?, postal_code? }
 * Returns 201 { ok, store_id, store_name }.
 */
/**
 * GET /auth/me/stores — list every store on the signed-in owner's
 * account (id + name + license tail) for the store-switcher UI.
 */
router.get("/me/stores", resolveAuthenticatedStore, async (req, res) => {
  try {
    if (req.auth_mode !== "user" || !req.auth_user_id) {
      return res.status(403).json({ ok: false, error: "owner_session_required" });
    }
    const { data: memberships, error: memErr } = await supabase
      .from("store_users")
      .select("store_id, role, stores ( id, store_name, liquor_license, is_active )")
      .eq("user_id", req.auth_user_id)
      .eq("is_active", true);
    if (memErr) {
      return res.status(500).json({ ok: false, error: memErr.message });
    }
    const stores = (memberships ?? [])
      .map((m) => m.stores)
      .filter((s) => s && s.is_active !== false)
      .map((s) => ({
        store_id: s.id,
        store_name: s.store_name,
        // Last 4 of the license — enough to tell twins apart, never the
        // full number in a list payload.
        license_tail: String(s.liquor_license ?? "").slice(-4) || null,
      }));
    return res.json({ ok: true, stores });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.post(
  "/me/stores",
  express.json(),
  resolveAuthenticatedStore,
  async (req, res) => {
    try {
      if (req.auth_mode !== "user" || !req.auth_user_id) {
        return res.status(403).json({ ok: false, error: "owner_session_required" });
      }
      const userId = req.auth_user_id;
      const body = req.body ?? {};
      const store_name = trimField(body.store_name);
      const liquor_license = trimField(body.liquor_license, 20);
      const mlcc_username = trimField(body.mlcc_username, 200);
      const mlcc_password = String(body.mlcc_password ?? "");
      const address_line1 = trimField(body.address_line1);
      const city = trimField(body.city, 80);
      const state = trimField(body.state, 4).toUpperCase();
      const postal_code = trimField(body.postal_code, 10);

      if (!store_name) {
        return res.status(400).json({ ok: false, error: "store_name_required" });
      }
      if (!isLicenseNumber(liquor_license)) {
        return res.status(400).json({ ok: false, error: "liquor_license_invalid" });
      }
      if (!mlcc_username || !mlcc_password) {
        return res.status(400).json({ ok: false, error: "mlcc_credentials_required" });
      }

      // Each MLCC license is one store — refuse a duplicate license on
      // this account (or anyone's; licenses are state-unique).
      const { data: dupe, error: dupeErr } = await supabase
        .from("stores")
        .select("id")
        .eq("liquor_license", liquor_license)
        .limit(1)
        .maybeSingle();
      if (dupeErr) {
        return res.status(500).json({ ok: false, error: dupeErr.message });
      }
      if (dupe) {
        return res.status(409).json({ ok: false, error: "license_already_registered" });
      }

      let mlcc_password_encrypted;
      try {
        mlcc_password_encrypted = encryptCredential(mlcc_password);
      } catch (encErr) {
        return res.status(500).json({
          ok: false,
          error: "credential_encryption_failed",
          details: encErr?.message,
        });
      }

      const { data: store, error: storeErr } = await supabase
        .from("stores")
        .insert({
          store_name,
          liquor_license,
          mlcc_username,
          mlcc_password_encrypted,
          address_line1: address_line1 || null,
          city: city || null,
          state: state || "MI",
          postal_code: postal_code || null,
          is_active: true,
        })
        .select("id, store_name")
        .single();
      if (storeErr) {
        return res.status(500).json({ ok: false, error: storeErr.message });
      }

      const { error: linkErr } = await supabase.from("store_users").insert({
        user_id: userId,
        store_id: store.id,
        is_active: true,
        role: "owner",
      });
      if (linkErr) {
        // Roll back the orphaned store so the license isn't burned.
        await supabase.from("stores").delete().eq("id", store.id);
        return res.status(500).json({ ok: false, error: linkErr.message });
      }

      return res.status(201).json({
        ok: true,
        store_id: store.id,
        store_name: store.store_name,
      });
    } catch (e) {
      return res
        .status(500)
        .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
);

export default router;
