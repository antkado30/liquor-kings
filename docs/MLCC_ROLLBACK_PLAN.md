# MLCC rollback & incident response (ordering mistakes / failures)

**Purpose:** Operational steps if an MLCC order is **mis-submitted**, **duplicated**, **partially submitted**, or if automation **fails after** a human believed an order might have gone through. This is **not** a substitute for MLCC vendor contracts, support SLAs, or legal review.

**Scope:** Human procedures + **which artifacts to collect** + **where to look** in Liquor Kings systems. **No** runtime behavior is defined here; the repo does not ship an automated “cancel order” RPA path.

**Related:** [`MLCC_PRE_RUN_CHECKLIST.md`](./MLCC_PRE_RUN_CHECKLIST.md), [`RPA_MONITORING_SPEC.md`](./RPA_MONITORING_SPEC.md), [`RLSAUDIT.md`](./RLSAUDIT.md), [`SESSIONLOG.md`](./SESSIONLOG.md).

---

## 1. Immediate containment (first 15 minutes)

1. **Stop the worker** (terminate process / stop container / revoke worker credentials per your ops runbook) so no further API or browser actions run.
2. **Do not** disable SAFE MODE network guards or set ad-hoc env flags to “force success” ([`RPA_SAFETY_CHECKLIST.md`](./RPA_SAFETY_CHECKLIST.md)).
3. **Preserve disk artifacts:** if `MLCC_SAFE_FLOW_SCREENSHOT_DIR` was set, **copy the entire per-run directory** (named by `run_id`) to a durable location before any cleanup. That folder may contain:
   - `mlcc_run_summary.json` (see `MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME` in `mlcc-browser-evidence.js`)
   - Milestone PNGs (`mlcc_ms_*__*` filenames from `buildMlccSafeFlowMilestoneDiskFilename`)
4. **Capture MLCC-side truth:** in the **MLCC / MILO UI** (logged-in session if still available), note **order number**, **timestamp**, **line items**, **totals**, and **submission state** (pending / confirmed / error). Screenshot each screen; include URL bar where safe.

---

## 2. If an order was mis-submitted or duplicated

| Step | Owner | Action |
|------|--------|--------|
| A | Operator | Export / screenshot MLCC order detail and cart as above. |
| B | Operator | Record **Liquor Kings** `run_id`, `store_id`, and time window (UTC). |
| C | Business / account owner | Contact **MLCC** per your vendor process (phone/email portal) — **cancellation or adjustment is vendor-dependent**; this repo does not document MLCC’s internal cancel API. |
| D | Engineering | Open internal incident; attach artifacts from §3. |

**Partial submission:** treat as **unknown state** until MLCC UI or support confirms — do not assume idempotency across retries unless your integration contract says so (validate externally).

---

## 3. Evidence artifacts to collect (minimum bundle)

Collect **all** of the following that exist for the incident window:

1. **On-disk safe-flow pack (if configured):** full directory under `MLCC_SAFE_FLOW_SCREENSHOT_DIR` for the `run_id` (see worker: `buildMlccSafeFlowRunOutputDir`, `writeMlccSafeFlowRunSummaryJson`).
2. **`mlcc_run_summary.json`:** includes `outcome`, `started_at_iso`, `finished_at_iso`, `error_message`, `final_page_url`, `mlcc_dry_run_safe_mode`, `add_by_code_probe_enabled`, `network_guard_blocked_request_count`, `evidence_entry_count`, `evidence_kinds_tally`, `milestone_screenshot_evidence_entries` (see `buildMlccSafeFlowRunSummaryPayload` in `mlcc-browser-evidence.js`).
3. **Worker / process logs** from the host (stdout/stderr, container logs, systemd journal) covering **claim** → **finalize**.
4. **API / Supabase — `execution_runs`:** row for `run_id`: status, `error_message`, `failure_type` / `failure_details` if present, timestamps. Evidence JSON attached on finalize may contain structured entries (kinds such as `mlcc_dry_run_mapping_confidence`, `mlcc_safe_flow_run_summary`, probe kinds, etc.) — export or screenshot the row via admin tooling / SQL **read-only** as per policy.
5. **Supabase — related business tables (read-only):** as appropriate for your incident: `carts`, line tables, any execution payload snapshots your deployment stores — **do not** mutate production data without a separate approved change process.
6. **RLS / access audit (if access leak suspected):** follow [`RLSAUDIT.md`](./RLSAUDIT.md) for read-only `sql/rls_audit_query.sql` posture; paste snapshots into that doc’s template if this is part of a formal review.

---

## 4. What to verify (checklist)

- [ ] **MLCC:** single vs duplicate order numbers; dollar totals match intent; any “pending” vs “submitted” flags.
- [ ] **Liquor Kings DB:** `execution_runs` status vs what operators saw; whether `evidence` contains `validate_mapping_confidence` or failure stages consistent with the timeline.
- [ ] **Mapping:** for the cart lines in question, what was `mappingconfidence` on the payload (`confirmed` / `inferred` / `unknown`) — see [`MLCC_MAPPING.md`](./MLCC_MAPPING.md).
- [ ] **Screenshots / HTML excerpts:** any `collectSafeModeFailureEvidencePack` or login-failure forensics referenced in worker/probe docs ([`SELECTORS.md`](./SELECTORS.md)) — attach to the incident ticket.
- [ ] **Network guards:** `network_guard_blocked_request_count` in run summary — spikes may explain partial UI state without a successful order.

---

## 5. After stabilization

- [ ] Append [`SESSIONLOG.md`](./SESSIONLOG.md) with incident summary, artifact paths (no secrets), and follow-ups.
- [ ] If schema or RLS was implicated, schedule [`RLSAUDIT.md`](./RLSAUDIT.md) refresh and migration review per that doc — **not** ad-hoc policy edits in prod.

---

## Explicit limitations (do not assume)

- **No in-repo automated MLCC order cancellation** is described as of this writing.
- **SAFE MODE** dry-run paths intentionally avoid submit/checkout/confirm; if a real order occurred, it was via a **different** or **manual** path — investigation must start from MLCC UI + your operational real-mode design (outside this doc).

---

## Code alignment (reality-check)

Artifact list in §3 matches `buildMlccSafeFlowRunSummaryPayload` / `writeMlccSafeFlowRunSummaryJson` (`mlcc-browser-evidence.js`) and worker milestone capture. **`execution_runs`** columns referenced (`status`, `error_message`, `failure_type`, `failure_details`, `evidence`) align with `finalizeRun` PATCH body in `execution-worker.js` — confirm your API route persists the same JSON shape. Canonical DONE / gap tracking: [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md).
