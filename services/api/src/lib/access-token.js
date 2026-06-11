import crypto from "crypto";

/**
 * Local verification of a Supabase access token (HS256 JWT), with no network
 * round-trip to GoTrue.
 *
 * Why: resolveAuthenticatedStore previously called supabase.auth.getUser(token)
 * on EVERY authenticated request — a cross-service HTTP hop that taxed the
 * latency of the entire app ("instant feel" root cause, 2026-06-07). Supabase
 * access tokens are signed JWTs; when SUPABASE_JWT_SECRET is configured we can
 * validate the signature + claims locally in microseconds.
 *
 * Safety:
 *  - Algorithm is pinned to HS256. Any other alg (none / RS256 / ES256 from the
 *    newer asymmetric signing keys) returns null so the caller falls back to the
 *    authoritative getUser() network path — we NEVER accept an unverified token.
 *  - Signature compared with timingSafeEqual.
 *  - exp / nbf enforced; aud must be "authenticated".
 *  - If the secret isn't set, returns null → behaviour is identical to before
 *    (pure progressive enhancement; set the secret to turn the speedup on).
 *
 * Tradeoff: local verification can't observe a server-side revocation (sign-out
 * / ban) until the token expires. Supabase access tokens are short-lived
 * (~1h), so the exposure window is small and bounded — the standard, documented
 * tradeoff for stateless JWT auth.
 *
 * @returns {{ userId: string } | null} userId (the `sub` claim) when the token
 *   is locally proven valid, otherwise null (caller should fall back).
 */
export function verifySupabaseAccessToken(
  token,
  secret = process.env.SUPABASE_JWT_SECRET,
) {
  if (!secret || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  // Pin the algorithm — refuse anything we can't verify with the shared secret.
  if (!header || header.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  let provided;
  try {
    provided = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  return validateClaims(payload);
}

/**
 * Shared claim validation for both verification paths (HS256 + ES256).
 * exp / nbf with small skew, aud must be "authenticated", sub required.
 * @returns {{ userId: string } | null}
 */
function validateClaims(payload) {
  if (!payload || typeof payload !== "object") return null;
  const now = Math.floor(Date.now() / 1000);
  // Small leeway for clock skew between the auth issuer and this server.
  const SKEW = 5;
  if (typeof payload.exp === "number" && payload.exp <= now - SKEW) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + SKEW) return null;

  const aud = payload.aud;
  const audOk =
    aud === "authenticated" ||
    (Array.isArray(aud) && aud.includes("authenticated"));
  if (!audOk) return null;

  if (!payload.sub || typeof payload.sub !== "string") return null;

  return { userId: payload.sub };
}

/* ─── ES256 via JWKS (2026-06-10) ────────────────────────────────────────
 *
 * Tony's Supabase project rotated to the new asymmetric signing keys
 * (CURRENT KEY = ECC P-256), so new access tokens are ES256 — the HS256
 * legacy-secret path above can never match them, and there is no shared
 * secret to configure at all. Instead we verify against the project's
 * PUBLIC keys, fetched once from the standard JWKS endpoint
 * (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) and cached in memory.
 * Per-request cost after warmup: microseconds, zero network. The
 * middleware's getUser() fallback still backstops every miss, so this is
 * a pure progressive enhancement with identical security semantics.
 *
 * Safety:
 *  - alg pinned to ES256; JWK must be kty=EC, crv=P-256.
 *  - kid must match a cached key; unknown kid triggers ONE rate-limited
 *    JWKS refetch (key rotation heals within seconds, no restart).
 *  - Signature is JOSE raw r||s (64 bytes) → verified with node crypto
 *    using dsaEncoding "ieee-p1363".
 *  - iss must start with SUPABASE_URL when both are present.
 *  - Any fetch/parse/verify failure returns null → caller falls back.
 */

const JWKS_TTL_MS = 10 * 60 * 1000; // refresh at most every 10 min
const JWKS_MIN_REFETCH_MS = 30 * 1000; // unknown-kid refetch rate limit

const jwksCache = {
  /** @type {Map<string, crypto.KeyObject>} */
  keysByKid: new Map(),
  fetchedAt: 0,
  /** @type {Promise<void> | null} */
  inFlight: null,
};

function jwksUrl() {
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
}

async function refreshJwks() {
  // Dedupe concurrent refreshes — one fetch serves every waiting request.
  if (jwksCache.inFlight) return jwksCache.inFlight;
  const url = jwksUrl();
  if (!url) return;
  jwksCache.inFlight = (async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const json = await res.json();
      const keys = Array.isArray(json?.keys) ? json.keys : [];
      const next = new Map();
      for (const jwk of keys) {
        if (jwk?.kty !== "EC" || jwk?.crv !== "P-256" || !jwk?.kid) continue;
        try {
          next.set(
            String(jwk.kid),
            crypto.createPublicKey({ key: jwk, format: "jwk" }),
          );
        } catch {
          // Skip malformed keys; never let one bad entry sink the set.
        }
      }
      if (next.size > 0) jwksCache.keysByKid = next;
      jwksCache.fetchedAt = Date.now();
    } catch {
      // Network failure → keep the old cache; callers fall back to getUser().
    } finally {
      jwksCache.inFlight = null;
    }
  })();
  return jwksCache.inFlight;
}

/**
 * Verify an ES256 Supabase access token against the cached JWKS.
 * @returns {Promise<{ userId: string } | null>}
 */
async function verifyEs256ViaJwks(token, headerB64, payloadB64, sigB64, header) {
  if (header.alg !== "ES256") return null;
  const kid = typeof header.kid === "string" ? header.kid : null;
  if (!kid) return null;

  const stale = Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;
  if (jwksCache.keysByKid.size === 0 || stale) await refreshJwks();

  let key = jwksCache.keysByKid.get(kid);
  if (!key && Date.now() - jwksCache.fetchedAt > JWKS_MIN_REFETCH_MS) {
    // Unknown kid — likely a key rotation. One rate-limited refetch.
    await refreshJwks();
    key = jwksCache.keysByKid.get(kid);
  }
  if (!key) return null;

  let sig;
  try {
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (sig.length !== 64) return null; // JOSE ES256 = raw r||s, 32+32 bytes

  let ok = false;
  try {
    ok = crypto.verify(
      "sha256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key, dsaEncoding: "ieee-p1363" },
      sig,
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // Issuer must belong to our Supabase project when both sides are known.
  const base = process.env.SUPABASE_URL;
  if (base && typeof payload.iss === "string" && !payload.iss.startsWith(base)) {
    return null;
  }

  return validateClaims(payload);
}

/**
 * Verify a Supabase access token locally by WHATEVER algorithm it carries:
 * HS256 (legacy shared secret, if configured) or ES256 (new asymmetric keys
 * via JWKS — no configuration needed). Returns null on any miss; the caller
 * falls back to the authoritative supabase.auth.getUser() network path.
 *
 * @returns {Promise<{ userId: string } | null>}
 */
export async function verifySupabaseAccessTokenAny(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object") return null;

  if (header.alg === "HS256") return verifySupabaseAccessToken(token);
  if (header.alg === "ES256") {
    return verifyEs256ViaJwks(token, headerB64, payloadB64, sigB64, header);
  }
  // Anything else (none / RS256 / …) is refused — fallback path decides.
  return null;
}
