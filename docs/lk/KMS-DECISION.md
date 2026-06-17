# KMS / Credential Encryption — Decision Doc

**Closes:** SCALE-READINESS S4 (P1). **Status:** decision pending Tony's pick.
**Constraint:** doc only — no code lands until after Thursday's order + a green
light on the approach. The credential *decrypt* path is load-bearing for every
real order, so this migrates deliberately, never in a rush.

---

## Where we are today

`services/api/src/lib/credential-encryption.js`: **AES-256-GCM**, format
`v1:<iv>:<authTag>:<ciphertext>`. The crypto is good. The **key management** is
the gap:

- One static 256-bit key in a single env var, `LK_CREDENTIAL_ENCRYPTION_KEY`,
  present on **every** API + worker machine.
- That one key decrypts **every store's** MLCC portal password. One leak (a
  compromised Fly secret, a memory dump, a deploy-pipeline mistake, an insider)
  = every store's michigan.gov login, all at once.
- No native rotation, no per-store isolation, no audit trail of who/what
  decrypted a credential and when.

At one store this is acceptable. At hundreds it's the kind of thing an
enterprise buyer's security review (or an acquirer's diligence) fails you on.

**The one thing already right for migration:** the `v1:` version prefix. We can
introduce a `v2:` envelope format, dispatch decryption on the prefix, and
backfill lazily — zero downtime, no big-bang.

---

## The bar (what "fixed" means)

1. **Master key never sits in app env or process memory.** It lives in a key
   service; the app can *use* it to wrap/unwrap, but can't exfiltrate it.
2. **Envelope encryption** — a master key encrypts per-store data keys (DEKs);
   DEKs encrypt the credentials. Standard, auditable, rotatable.
3. **Audit + rotation + revocation** — every decrypt is logged; rotating the
   master or a store's DEK doesn't require re-reading plaintext from outside.
4. **Doesn't slow the order loop** — a decrypt happens once per RPA run; budget
   a few ms, cache the unwrapped DEK briefly in the worker.

---

## Options

### ❌ Rejected: Supabase Transparent Column Encryption / pgsodium
pgsodium is **pending deprecation** and Supabase **does not recommend** TCE or
Server Key Management for new projects (operational complexity + misconfig
risk; the table-editor UI for it was already removed). Building on it now would
be building on a sunset. ([source](https://supabase.com/docs/guides/database/extensions/pgsodium), [discussion](https://github.com/orgs/supabase/discussions/27109))

### ✅ Recommended: Cloud KMS + envelope encryption (AWS KMS or GCP KMS)
- A **Customer Master Key (CMK)** lives in the KMS and never leaves it.
- **Per-store DEK:** on store onboarding, `GenerateDataKey` returns a plaintext
  DEK + a KMS-encrypted DEK. Encrypt that store's credentials with the plaintext
  DEK (AES-256-GCM, our existing primitive), store the **encrypted** DEK in the
  store row, discard the plaintext.
- **Decrypt path:** worker sends the encrypted DEK to KMS → gets the plaintext
  DEK back → decrypts the credential locally. Cache the plaintext DEK in worker
  memory with a short TTL (e.g. 5 min) so we don't call KMS on every run.
- **Why it meets the bar:** CMK never in our env; IAM scopes who can call
  `Decrypt`/`GenerateDataKey`; CloudTrail/Cloud Audit logs every use; native
  key rotation; revoke a store by dropping/rotating its DEK.
- **Cost:** ~$1/mo per CMK + ~$0.03 per 10k KMS calls (approximate — confirm
  current AWS/GCP pricing). With DEK caching, KMS calls ≈ a handful per store
  per day. Effectively free at our scale.
- **Latency:** one ~10–50ms KMS call on a cold DEK, then cached. Negligible
  against a ~60–90s RPA run.
- **New dependency:** an AWS (or GCP) account + an IAM credential as a Fly
  secret. Note: that IAM key grants *use* of the CMK (scoped, rotatable,
  logged) — it is **not** the master key itself. That's the whole point.

### ◻︎ Supabase Vault — useful, but as a *secrets store*, not the KMS
Vault survives pgsodium's deprecation (same API, new backend). It encrypts a
table of secrets at rest under a **Supabase-managed root key**, readable via a
decrypted view. Good fit for storing *our* app secrets (e.g. the KMS IAM
credential, or — interim — the master AES key, off the Fly env). But it is
**not** a per-row credential KMS: the decrypted view is reachable by anything
with service-role DB access (which our app has everywhere), so the isolation
gain for store credentials is marginal. Use it to hold the master/IAM secret,
not as the envelope engine. ([Vault docs](https://supabase.com/docs/guides/database/vault))

### ◻︎ Interim cheap win (optional): HKDF per-store keys
Derive a per-store key from the existing master via HKDF(masterKey, storeId).
Gains per-store isolation + rotation granularity **without** new infra — but the
master still lives in env, so it does **not** close the core gap. Only worth it
if KMS slips and we want a partial improvement in the meantime. Not recommended
as the destination.

---

## Recommended path (phased, zero-downtime)

1. **Pick a KMS** (AWS vs GCP — see open decisions). Create one CMK, enable
   rotation, scope an IAM principal to `Decrypt` + `GenerateDataKey` only.
2. **Add `v2:` envelope format** to `credential-encryption.js`. `encrypt` writes
   v2 (per-store DEK). `decrypt` dispatches on prefix: `v1:` → current env key,
   `v2:` → KMS-unwrap-DEK then AES. Dual-read = no flag day.
3. **New writes go v2 immediately** (new store onboardings + any credential
   re-save).
4. **Backfill** existing `v1:` rows: decrypt with env key, re-encrypt as `v2:`,
   write. A one-shot script in the `scripts/` pattern (like the others).
5. **Retire the env key** once zero `v1:` rows remain. Keep it archived offline
   only long enough to confirm.
6. **Worker DEK cache** (short TTL) so KMS isn't called per run.

Each phase is independently shippable and reversible. The order loop keeps
working throughout (dual-read).

---

## Open decisions for Tony

1. **AWS KMS vs GCP KMS** — functionally equivalent. AWS KMS is the most common
   in SOC 2 / acquirer-diligence narratives and the cheapest mental model;
   GCP KMS is equal if you'd rather live in GCP. (Fly has no native KMS, so we
   bring our own either way.) *Default recommendation: AWS KMS.*
2. **Per-store DEK vs per-write DEK** — per-store (one DEK per store, reused for
   that store's creds) is simpler and enables per-store revoke/rotate.
   *Recommendation: per-store.*
3. **Timing** — this is a "before first paying enterprise customer / before the
   security review" item, not a launch blocker for the pilot. Sequence it after
   the autoscaling + queue-ETA work unless an enterprise deal pulls it forward.

**Effort:** ~M. Steps 1–3 ≈ a focused day; backfill + retire ≈ a half day +
careful verification. No core-loop logic changes — only the encrypt/decrypt
internals, behind the version prefix.

---

## Sources
- [pgsodium (pending deprecation) — Supabase Docs](https://supabase.com/docs/guides/database/extensions/pgsodium)
- [pgsodium / TCE not recommended and deprecated — Supabase Discussion #27109](https://github.com/orgs/supabase/discussions/27109)
- [Vault — Supabase Docs](https://supabase.com/docs/guides/database/vault)
- [Supabase Vault is now in Beta](https://supabase.com/blog/vault-now-in-beta)
