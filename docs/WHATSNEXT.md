# What's Next — Liquor Kings

**Living priorities list. Update when priorities shift, a major item ships, or a blocker appears.**

**Anchor docs:** [`PROJECT_STATE.md`](./PROJECT_STATE.md) (master state) · [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) (external spec) · [`PRODUCT_SPEC_INTERNAL.md`](./PRODUCT_SPEC_INTERNAL.md) (internal spec) · [`SESSIONLOG.md`](./SESSIONLOG.md) (session continuity)

---

## Current Focus: Phase A — Wire the engine end-to-end

The RPA stages work individually. The API + DB + workers are built. **The gap is integration.** Get a single end-to-end happy path working: customer hits submit → run created → worker claims → stages run → result back.

### Active priorities (in order)

1. **Wire RPA Stages 1-4 into execution-worker** — worker should call login, navigate, add-items, validate stages instead of just building preflight reports
2. **Build Stage 5 (checkout submission) in dry_run mode** — final stage; locked behind `allowOrderSubmission` flag + `LK_ALLOW_ORDER_SUBMISSION=yes` env
3. **API endpoint that triggers a full run from a cart** — POST that creates execution_run + enqueues + returns run id for customer to poll
4. **End-to-end test against live MILO** — use real Thursday family liquor order as the test (when Tony's family is placing one)

---

## Next Phases (don't start until Phase A is done)

### Phase B — Customer-facing surface
- Customer signup flow (vs operator/admin auth)
- MILO credential onboarding with AES-256 encryption + Stage 1 verify on connect
- Customer-facing cart review + submit UI in scanner
- Order confirmation + history + re-order button
- Email notifications (Resend or Postmark)

### Phase C — Business operations (parallel admin work, not coding)
- Form Michigan LLC ($200, this week)
- Have Jacob conversation about equity (this week)
- Buy liquorkings.com + variants ($60, this week)
- Hire Michigan startup lawyer ($5-8K)
- Buy ToS + Privacy Policy via Termly ($30/mo)
- Business insurance ($1.5-3K/year)
- Call Deja Vu POS support re: CSV export

### Phase D — Saxon-killer features
- Label printing (PDF generation per bottle in customer's inventory)
- Thermal printer (Zebra ZD421) integration as Pro add-on
- Status page (status.liquorkings.com)
- Phase 2 RPA observability + self-healing selectors

### Phase E — Launch
- Marketing landing page
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