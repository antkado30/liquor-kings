import crypto from "crypto";
import supabase from "../config/supabase.js";
import { logSystemDiagnostic, DIAGNOSTIC_KIND } from "../services/diagnostics.service.js";

function timingSafeEqualStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isServiceRoleBearer(token) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !token) return false;
  return timingSafeEqualStrings(token, key);
}

/**
 * Reads Supabase JWT or service-role bearer, maps users to store_id via store_users,
 * and attaches req.store_id. Service role must send X-Store-Id for store-scoped routes.
 */
export async function resolveAuthenticatedStore(req, res, next) {
  const authHeader = req.headers.authorization;
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.UNAUTHORIZED,
      payload: { path: req.path, reason: "missing_bearer" },
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (isServiceRoleBearer(token)) {
    req.auth_mode = "service_role";
    req.auth_user_id = null;
    const headerStore = req.headers["x-store-id"]?.trim();
    req.store_id = headerStore || null;
    return next();
  }

  const { data: userData, error: userErr } =
    await supabase.auth.getUser(token);

  if (userErr || !userData?.user) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.UNAUTHORIZED,
      payload: {
        path: req.path,
        reason: "invalid_token",
        message: userErr?.message,
      },
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = userData.user;
  req.auth_mode = "user";
  req.auth_user_id = user.id;

  const { data: memberships, error: memErr } = await supabase
    .from("store_users")
    .select("store_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (memErr) {
    return res.status(500).json({ error: memErr.message });
  }

  if (!memberships?.length) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.MISSING_STORE,
      userId: user.id,
      payload: { path: req.path, reason: "no_active_store_users_row" },
    });
    return res.status(403).json({ error: "No store membership for user" });
  }

  const headerStore = req.headers["x-store-id"]?.trim();

  if (memberships.length === 1) {
    req.store_id = memberships[0].store_id;
    if (headerStore && headerStore !== req.store_id) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.STORE_MISMATCH,
        userId: user.id,
        storeId: req.store_id,
        payload: {
          path: req.path,
          reason: "x_store_id_not_member",
          header_store_id: headerStore,
        },
      });
      return res.status(403).json({ error: "Not a member of specified store" });
    }
    return next();
  }

  if (!headerStore) {
    return res.status(400).json({
      error: "Multiple store memberships; send X-Store-Id header",
    });
  }

  const allowed = memberships.some((m) => m.store_id === headerStore);
  if (!allowed) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.STORE_MISMATCH,
      userId: user.id,
      payload: {
        path: req.path,
        reason: "header_store_not_in_memberships",
        header_store_id: headerStore,
      },
    });
    return res.status(403).json({ error: "Not a member of specified store" });
  }

  req.store_id = headerStore;
  return next();
}
