# Contract: MLCC safe-flow run summary (on-disk JSON)

**Type:** Non-runtime documentation mirror of the current worker payload shape.  
**Code source:** `buildMlccSafeFlowRunSummaryPayload` and `writeMlccSafeFlowRunSummaryJson` in `services/api/src/workers/mlcc-browser-evidence.js`; filename `MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME` (`mlcc_run_summary.json`).

**When written:** Only when the MLCC browser worker has a resolved per-run output directory (`buildMlccSafeFlowRunOutputDir(env.MLCC_SAFE_FLOW_SCREENSHOT_DIR, run.id)` returns a path). Written at run completion (`outcome` success or failure).

**Reality-check:** If this contract ever disagrees with code, **`mlcc-browser-evidence.js`** is authoritative. Monitoring rollup: [`RPA_MONITORING_SPEC.md`](../RPA_MONITORING_SPEC.md). DONE / gates: [`RPA_SUBSYSTEM_DONE.md`](../RPA_SUBSYSTEM_DONE.md).

---

## File location

```
${MLCC_SAFE_FLOW_SCREENSHOT_DIR}/${run_id}/mlcc_run_summary.json
```

---

## JSON fields (schema version 1)

| JSON key | Type | Description |
|----------|------|-------------|
| `schema_version` | integer | Schema version; default `1`. |
| `run_id` | string | Execution run identifier. |
| `store_id` | string | Store identifier. |
| `worker_id` | string \| null | Worker id if supplied. |
| `outcome` | string | `"success"` or `"failure"` (worker-defined). |
| `started_at_iso` | string | ISO-8601 timestamp when run tracking started. |
| `finished_at_iso` | string | ISO-8601 when summary was finalized. |
| `error_message` | string \| null | Human-readable error on failure; `null` on success. |
| `final_page_url` | string \| null | Last captured browser URL when summary was built. |
| `mlcc_dry_run_safe_mode` | boolean | Dry-run SAFE MODE flag from worker (`MLCC_BROWSER_DRY_RUN_SAFE_MODE`). |
| `add_by_code_probe_enabled` | boolean | Whether add-by-code probe was enabled. |
| `network_guard_blocked_request_count` | integer \| null | Count from guard stats when present. |
| `evidence_entry_count` | integer | Number of evidence entries collected in the run. |
| `evidence_kinds_tally` | object | Keys are evidence `kind` strings; values are occurrence counts. |
| `milestone_screenshot_evidence_entries` | integer | Count of milestone screenshot evidence rows. |
| `run_summary_basename` | string | Always `mlcc_run_summary.json` (same as basename on disk). |

---

## Example (illustrative only)

```json
{
  "schema_version": 1,
  "run_id": "00000000-0000-4000-8000-000000000001",
  "store_id": "00000000-0000-4000-8000-000000000002",
  "worker_id": "worker-local-1",
  "outcome": "success",
  "started_at_iso": "2026-04-10T12:00:00.000Z",
  "finished_at_iso": "2026-04-10T12:05:30.000Z",
  "error_message": null,
  "final_page_url": "https://example.invalid/milo/products/bycode",
  "mlcc_dry_run_safe_mode": true,
  "add_by_code_probe_enabled": true,
  "network_guard_blocked_request_count": 0,
  "evidence_entry_count": 42,
  "evidence_kinds_tally": {
    "mlcc_add_by_code_probe": 20,
    "mlcc_safe_flow_milestone_screenshot": 3
  },
  "milestone_screenshot_evidence_entries": 3,
  "run_summary_basename": "mlcc_run_summary.json"
}
```

---

## Non-goals

- This file does **not** define API authentication, webhook delivery, or retention policy.
- **Item-level** or **mappingconfidence** rollups are **not** in this payload today; see [`RPA_MONITORING_SPEC.md`](../RPA_MONITORING_SPEC.md) for recommended extensions.
