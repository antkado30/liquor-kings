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
