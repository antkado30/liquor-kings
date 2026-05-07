# What's Next — Liquor Kings

**Living priorities list. Update when priorities shift, a major item ships, or a blocker appears.**

**Anchor docs:** [`PROJECT_STATE.md`](./PROJECT_STATE.md) (master state) · [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (external spec) · [`PRODUCT_SPEC_INTERNAL.md`](./PRODUCT_SPEC_INTERNAL.md) (internal spec) · [`SESSIONLOG.md`](./SESSIONLOG.md) (session continuity)

---

## Phase A ✅ COMPLETE (May 6, 2026) + REAL-WORLD VERIFIED (May 7, 2026)

The full RPA pipeline is wired end-to-end AND has placed a real production order against live MLCC.

✅ Stage 5 built in dry_run mode with 13 typed errors and triple-gated safety  
✅ Stages 1-5 wired into execution-worker as `processOneRpaRun`  
✅ API endpoint `POST /from-cart/:storeId/:cartId` accepts `mode: "rpa_run"` and stamps metadata correctly  
✅ End-to-end test verified May 6 in dry_run mode: run e1617c49-798a-4b82-9ebf-4d928150a0c4
✅ **End-to-end LIVE submission verified May 7: order placed, confirmation numbers received from MLCC**

🚀 **First production order — May 7, 2026:**
- NWS Michigan, Inc. (#321): Order #264935837, Confirmation #30653069, $1,186.37 — delivery 5/12/2026
- General Wine & Liquor (#221): Order #264935818, Confirmation #5591482, $691.35 — delivery 5/12/2026
- 27 of 28 SKUs delivered (Kirkland excluded as MLCC OOS, others all included)
- 95 seconds total wall-clock from terminal command to MILO acceptance
- Self-healing caught + retried 2 silently-dropped items mid-run

Strangler-fig migration intact. Old `mlcc-browser-worker.js` and `processOneMlccDryRun` untouched. Can be removed safely now that processOneRpaRun has placed a real order.

---

## Phase B Priority #1 ✅ COMPLETE (May 7, 2026)

Encrypted MLCC credential storage shipped end-to-end and verified live against MILO with worker DB integration.

✅ AES-256-GCM credential encryption utility with versioned format `v1:<iv>:<authTag>:<ciphertext>`  
✅ `stores.mlcc_password_encrypted` column populated with real ciphertext (verified ZERO plaintext via direct psql read)  
✅ API routes: `PUT/GET/POST/DELETE /stores/:storeId/mlcc-credentials` with status, save, verify, clear  
✅ Verify endpoint runs Stage 1 against live MILO and persists `verifiedAt` + `lastStatus` metadata  
✅ Worker `processOneRpaRun` reads from DB first, env fallback for tests, hard-fail on decrypt error  
✅ End-to-end run with `MILO_USERNAME`/`MILO_PASSWORD` UNSET succeeded — proves DB-only path works  
✅ Evidence trail records `credential_source: "db"` per run

Run 9a873bd4-6657-47d0-9074-4e426de8405f stands as proof. Customer onboarding now has the keystone it needed: every future customer can save encrypted creds via API, worker decrypts on demand.

---

## Phase B — Customer-facing surface (CURRENT FOCUS)

Order matters. These are sequenced for highest leverage to first paying customer.

### Phase B Priority #1.4 (URGENT — discovered May 7 from real order): RPA stages bug fixes

Two real bugs found by placing the first production order.

**Stage 5 confirmation parser timing bug — ✅ FIXED May 7 (commit b2e3f12)**
- Was: threw `MILO_STAGE5_CONFIRMATION_PARSE_FAILED` while MILO was still on the loading state ("Please wait while we confirm your order"). Order DID submit, but parser declared failure too early.
- Root cause: parser was treating any 6+ digit body match as a confirmation candidate. MILO's header always shows the 6-digit license number → false positive on every page.
- Fix shipped: detect "Please wait..." loading state explicitly + continue polling, replace loose digit match with strict `Confirmation #` regex, keep URL change + toasts as terminal signals, add `wasInLoadingState` field to timeout error for diagnostics.
- Verification deferred to next real order — can't easily re-test live without placing a 2nd order.

**Stage 3 silent batch-add drops — STILL OPEN**
- 28 SKUs in one batch consistently drops 1-4 items per run (caught by self-healing layer in resolve-and-run-order.mjs).
- Almost certainly a MILO-side rate-limit or batch-size cap on "Add by Code".
- Self-healing covers it, but root cause should be addressed for cleaner first-pass success rate.
- Fix: split high-SKU-count adds into smaller batches (e.g., 8-10 SKUs per batch) inside Stage 3.
- File: `services/api/src/rpa/stages/add-items-to-cart.js`

### Phase B Priority #1.5 (security hardening before customers): Move encryption key to managed KMS

What we shipped May 7 is Tier 1 (env-var key). Before any paying customer touches the system, we upgrade to Tier 2 (KMS-backed).

- Evaluate Supabase Vault (if GA) vs AWS KMS vs GCP KMS vs HashiCorp Vault
- Migrate `LK_CREDENTIAL_ENCRYPTION_KEY` out of `.env` — key never lives in application memory or filesystem
- Worker + API call KMS over authenticated channel for encrypt/decrypt operations
- Even full server compromise cannot extract the key (HSM-backed)
- Document key rotation procedure
- Migrate existing ciphertext under new wrapping (envelope encryption pattern)
- Per-store Data Encryption Keys (DEKs) wrapped by master Key Encryption Key (KEK) — single-customer blast radius if a DEK leaks

**Why this matters:** the encryption itself is industry-standard. The weak link is where the key lives. Server compromise = all customer credentials decryptable. KMS removes that single point of failure. This is the difference between "we say we encrypt" and "we encrypt at the same tier as banks and password managers."

### Phase B Priority #1.6 (paired with #1.5): Credential access audit log + anomaly detection

- New `credential_access_log` table — every decrypt call recorded (storeId, timestamp, worker_id, run_id, success/failure)
- Immutable / append-only — no UPDATE or DELETE permissions, even for service role
- Anomaly detection rules: alert via Sentry if N decrypts/hour exceeds threshold per store, or if decrypts come from unexpected worker IDs
- Customer-facing "last accessed" surface in dashboard — transparency builds trust + lets customer detect compromise themselves
- Required for any future SOC 2 audit

### Phase B Priority #2: Bulk UPC import tool
- Admin UI for CSV ingestion (NRS, Deja Vu, Ash exports)
- Three-tier confidence triage (auto-confirm / manual review / skip)
- Process Tony's 9,378-row NRS export as proof
- Becomes universal customer onboarding step
- Reminder: NRS size column unreliable — must use UPC + external DB + MLCC catalog as primary signals

### Phase B Priority #3: Customer-facing cart submit + progress UI
- Wire scanner cart from in-memory to authenticated /cart API
- Submit button triggers `mode: "rpa_run"` execution_run
- Progress UI polls `GET /execution-runs/:runId/summary` until done
- Shows confirmation numbers / dry-run cart-ready state

### Phase B Priority #4: Customer signup + login flow
- Real Supabase user auth (replacing service-role bypass for testing)
- store_users membership row creation on signup
- Multi-license switcher

### Phase B Priority #5: Email + push notifications
- Resend or Postmark integration
- RPA failure → notify customer within 5 min
- Order confirmation emails
- Status update push

### Phase B Priority #6: Order history + re-order button
- List of past execution_runs by store
- Tap to view details + receipt
- "Re-order" creates a new cart with same items

---

## Phase C — Business operations (parallel admin, not coding)

- Form Michigan LLC ($200, this week)
- Have Jacob conversation about equity (this week)
- Buy liquorkings.com + variants ($60, this week)
- Hire Michigan startup lawyer ($5-8K) — review credential storage + ToS security disclosures
- Buy ToS + Privacy Policy via Termly ($30/mo)
- **Cyber liability insurance ($1.5-3K/year — required before first paying customer per security review May 7)**
- Business insurance ($1.5-3K/year)
- Penetration test before public launch ($3-5K — third-party security audit)
- Plan for SOC 2 Type II at 100+ customers

---

## Phase D — Saxon-killer features

- Label printing (PDF generation per bottle in inventory)
- Thermal printer (Zebra ZD421) integration as Pro add-on
- Status page (status.liquorkings.com)
- Phase 2 RPA observability + self-healing selectors

---

## Phase E — Launch

- Marketing landing page on liquorkings.com
- Onboard dad's store as customer #1
- Onboard founders' tier customers 2-25 ($25/mo grandfathered)
- Public launch to warm network

---

## Explicitly NOT in scope right now

- AI assistant chat (V2 — defer until 100+ customers)
- Multi-state expansion (PA/OH/UT — defer until 200+ MI customers)
- Vendor-side product (Liquor Kings Vendor — defer until Year 4)
- Native iOS app (NEVER — PWA only)
- Browse/discover page (defer until customer demand emerges)

---

## How to use this file

- **Edit at the end of every session** if priorities shift
- **Read at the start of every session** to orient
- Always pair with `PROJECT_STATE.md` (architectural reality) and last 1-2 `SESSIONLOG.md` entries (recent context)