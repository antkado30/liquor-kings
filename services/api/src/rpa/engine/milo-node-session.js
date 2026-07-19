/**
 * milo-node-session — pure-Node MILO auth session + per-store cache.
 *
 * Born 2026-07-18 from the Node-direct probe VERDICT, run ON the worker:
 *   POST /auth/login (pure Node)  → 200, accessToken present
 *   token lifetime                → 30 minutes (JWT exp)
 *   GET /account with that token  → 200 in ~330ms
 *   cf_clearance cookie           → did not exist; Cloudflare not challenging
 *
 * So a check no longer needs a browser at all. This module owns the two
 * calls that used to justify one (login + account) and caches their result
 * per store for the token's lifetime, so back-to-back checks skip even the
 * ~460ms auth pair (the "warm micro-win" from the 2026-07-18 handoff).
 *
 * Rules (doctrine):
 *   - Credentials and tokens are NEVER logged; errors are redacted.
 *   - Cache reuse requires same username AND >5 min of token life left.
 *   - Login failures are CLASSIFIED so the worker can route honestly:
 *       invalid_credentials → fail the run loud (never burn a second
 *         bad-password attempt in the browser — MLCC can lock the account)
 *       blocked_or_down     → Cloudflare/network shaped; the worker falls
 *         back to the proven browser path for this run, loudly.
 *   - A poisoned cache is worse than a fresh login: the worker invalidates
 *     on ANY node-engine failure (mirrors rpa-session-manager's policy).
 */

import { makeNodeMiloTransport, redact } from "./engine-api.js";

/** Refuse to reuse a token with less than this much life left. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
/** If a token carries no readable exp, assume a short life and re-login often. */
const UNKNOWN_EXP_FALLBACK_MS = 10 * 60 * 1000;

/** storeId → { username, token, expMs, groupId, subscriptionId } */
const cache = new Map();

/**
 * Read the exp claim (ms epoch) out of a JWT without verifying it — we only
 * use it to decide when to refresh, never for trust. Returns null on any
 * malformed input.
 */
export function decodeJwtExpMs(token) {
  try {
    const seg = String(token).split(".")[1];
    if (!seg) return null;
    const payload = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class MiloNodeLoginError extends Error {
  /**
   * @param {string} message (already redacted by the thrower)
   * @param {{classification: "invalid_credentials"|"blocked_or_down", status: number}} info
   */
  constructor(message, { classification, status }) {
    super(message);
    this.name = "MiloNodeLoginError";
    this.classification = classification;
    this.status = status;
  }
}

function classifyAuthFailure(status) {
  // 400/401 = MILO itself rejected the credentials (a JSON API answer —
  // Cloudflare blocks don't come back as 401 JSON). Everything else —
  // 403/503 (challenge), 5xx, 429, status 0 network death — is
  // "blocked_or_down": not a credential problem, safe to retry via browser.
  return status === 400 || status === 401 ? "invalid_credentials" : "blocked_or_down";
}

/**
 * Get a ready-to-use node MILO session for a store: transport + token +
 * groupId + subscriptionId. Serves from cache while the token has >5 min
 * left AND the username matches; otherwise performs a fresh login+account
 * (~500ms total).
 *
 * @param {object} args
 * @param {string} args.storeId
 * @param {string} args.username  MILO credential (decrypted by the caller)
 * @param {string} args.password
 * @param {object} [args.transport]  injectable for tests; defaults to a real
 *   node transport.
 * @returns {Promise<{transport: object, token: string, groupId: string|number,
 *   subscriptionId: string|number, expMs: number, fromCache: boolean}>}
 * @throws {MiloNodeLoginError} with .classification (see header).
 */
export async function getNodeMiloSession({ storeId, username, password, transport } = {}) {
  if (!storeId) throw new Error("getNodeMiloSession: storeId is required");
  if (!username || !password) throw new Error("getNodeMiloSession: username + password are required");
  const t = transport ?? makeNodeMiloTransport();

  const hit = cache.get(storeId);
  const now = Date.now();
  if (hit && hit.username === username && hit.expMs - now > EXPIRY_MARGIN_MS) {
    return {
      transport: t,
      token: hit.token,
      groupId: hit.groupId,
      subscriptionId: hit.subscriptionId,
      expMs: hit.expMs,
      fromCache: true,
    };
  }
  // Stale / wrong-user / near-expiry entry: drop it before the fresh login so
  // a failure below can never leave a half-valid entry behind.
  cache.delete(storeId);

  const login = await t.call("POST", "/auth/login", {
    body: { username, password },
    label: "POST /auth/login (node)",
    silent: true,
  });
  if (!login.ok || !login.body?.accessToken) {
    const status = login.status ?? 0;
    throw new MiloNodeLoginError(
      `node MILO login failed (${status}): ${redact(JSON.stringify(login.body)).slice(0, 160)}`,
      { classification: classifyAuthFailure(status), status },
    );
  }
  const token = login.body.accessToken;
  const expMs = decodeJwtExpMs(token) ?? now + UNKNOWN_EXP_FALLBACK_MS;

  const account = await t.call("GET", "/account", { token, label: "GET /account (node)", silent: true });
  if (!account.ok) {
    const status = account.status ?? 0;
    throw new MiloNodeLoginError(`node GET /account failed (${status})`, {
      classification: classifyAuthFailure(status),
      status,
    });
  }
  const group = account.body?.groups?.[0] ?? {};
  const groupId = group.id;
  const subscriptionId = group.subscriptionId;
  if (groupId == null || String(groupId).trim() === "" || subscriptionId == null || String(subscriptionId).trim() === "") {
    throw new MiloNodeLoginError("node /account response missing groupId/subscriptionId", {
      classification: "blocked_or_down",
      status: account.status ?? 0,
    });
  }

  cache.set(storeId, { username, token, expMs, groupId, subscriptionId });
  const lifeMin = Math.round((expMs - now) / 60000);
  console.log(`[node-session] fresh MILO session for store ${storeId} (token life ~${lifeMin}min)`);
  return { transport: t, token, groupId, subscriptionId, expMs, fromCache: false };
}

/**
 * Drop a store's cached session. The worker calls this on ANY node-engine
 * failure — one extra ~500ms login next run beats ever re-using a token that
 * just presided over a failure.
 */
export function invalidateNodeMiloSession(storeId, reason = "invalidated") {
  if (!cache.has(storeId)) return false;
  cache.delete(storeId);
  console.log(`[node-session] invalidated cached session for store ${storeId} (${reason})`);
  return true;
}

/** Diagnostics — never includes tokens or credentials. */
export function getNodeMiloSessionStats() {
  return {
    entries: [...cache.entries()].map(([storeId, v]) => ({
      storeId,
      username_present: Boolean(v.username),
      expires_in_ms: v.expMs - Date.now(),
    })),
  };
}

/** Test helper — clears state. Unit tests only. */
export function __resetNodeMiloSessionForTests() {
  cache.clear();
}
