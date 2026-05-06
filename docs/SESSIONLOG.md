# Session log — Liquor Kings (append-only)

**Purpose:** Reduce drift between work bursts: each session leaves a short, structured trace of what happened, what was verified, and what comes next.

**How to use**

- **End of session:** Append **one new entry** below the divider (copy the template from `scripts/sessionlog-template.sh` or from the “Blank template” section).
- **Start of session:** Read the **last 2–3 entries** here, then skim [`WHATSNEXT.md`](./WHATSNEXT.md).

---

## Blank template (copy everything from the `---` through the closing `---`)

```
---
Date: YYYY-MM-DD (timezone if helpful)
Focus: one line — what this burst was for
Files touched (high level):
  - area/path or “docs only” / “no code”
Commands / tests run:
  - e.g. npm run safety:lk:rpa-local — PASS / SKIP / NOT RUN
  - e.g. psql … -f sql/… — NOT RUN
Observed state:
  - Green: …
  - Red / blocked: … (or “none”)
What's next (1–3 bullets):
  - …
Notes:
  - optional
---
```

---

## Example session (structure reference)

```
---
Date: 2026-04-10
Focus: Session continuity docs + mapping/selector safety documentation trail
Files touched (high level):
  - docs/SESSIONLOG.md, docs/WHATSNEXT.md, scripts/sessionlog-template.sh
  - (earlier bursts) docs/SELECTORS.md, sql/mlcc_mapping_audit.sql, docs/MLCC_MAPPING.md, sql/rls_audit_query.sql, docs/RLSAUDIT.md
Commands / tests run:
  - npm run safety:lk:rpa-local — NOT RUN this burst (docs-only)
Observed state:
  - Green: no application code changes in this burst
  - Red / blocked: none
What's next (1–3 bullets):
  - Run `sql/rls_audit_query.sql` + `sql/mlcc_mapping_audit.sql` against staging; paste results into RLSAUDIT / MLCC_MAPPING snapshots
  - Re-read last SESSIONLOG entries before the next RPA or schema-adjacent change
Notes:
  - Template helper: `./scripts/sessionlog-template.sh`
---
```

---

## Log entries (newest at bottom — append below this line)

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