# What's Next — Liquor Kings

**Living priorities list. Update when priorities shift, a major item ships, or a blocker appears.**

**Anchor docs:** [`PROJECT_STATE.md`](./PROJECT_STATE.md) (master state) · [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (external spec) · [`PRODUCT_SPEC_INTERNAL.md`](./PRODUCT_SPEC_INTERNAL.md) (internal spec) · [`SESSIONLOG.md`](./SESSIONLOG.md) (session continuity)

---

## Phase A ✅ COMPLETE (May 6, 2026)

The full RPA pipeline is wired end-to-end and verified live against MILO.

✅ Stage 5 built in dry_run mode with 13 typed errors and triple-gated safety  
✅ Stages 1-5 wired into execution-worker as `processOneRpaRun`  
✅ API endpoint `POST /from-cart/:storeId/:cartId` accepts `mode: "rpa_run"` and stamps metadata correctly  
✅ End-to-end test verified — API call → execution_run created → worker claimed → all 5 stages ran live MILO → finalized as succeeded with 13 evidence entries  

Run e1617c49-798a-4b82-9ebf-4d928150a0c4 stands as the proof: ~26s wall clock, Stage 5 109ms, no submission (dry_run gate refused).

Strangler-fig migration intact. Old `mlcc-browser-worker.js` and `processOneMlccDryRun` untouched. Will be removed in a future session after multi-customer real-order proof.

---

## Phase B — Customer-facing surface (NEW CURRENT FOCUS)

Order matters. These are sequenced for highest leverage to first paying customer.

### Phase B Priority #1: Encrypted MILO credential storage
- AES-256 column on stores table
- Stage 1 verify on credential save
- Replaces hardcoded env vars in worker for per-customer credentials
- Critical — every customer needs their own credentials before onboarding

### Phase B Priority #2: Bulk UPC import tool
- Admin UI for CSV ingestion (NRS, Deja Vu, Ash exports)
- Three-tier confidence triage (auto-confirm / manual review / skip)
- Process Tony's 9,378-row NRS export as proof
- Becomes universal customer onboarding step

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
- Hire Michigan startup lawyer ($5-8K)
- Buy ToS + Privacy Policy via Termly ($30/mo)
- Business insurance ($1.5-3K/year)

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