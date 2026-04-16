# Pilot Ops Runbook (Internal)

## Purpose

Pilot Ops exists to keep no-submit RPA pilot runs safe, reviewed, and moving. Use it to spot risky stores early, assign review state, and follow up before issues age out.

## Health Status in Practice

- `healthy`: recent runs look stable; no immediate action needed.
- `degraded`: warnings exist; schedule review soon and watch trend direction.
- `needs_attention`: immediate review required; treat as active operational risk.

## Follow-Up and Overdue

- `attention_overdue.requires_follow_up=true` means the store is still unresolved and should be actively tracked.
- `attention_overdue.is_overdue=true` means the store exceeded SLA for its workflow state:
  - `unreviewed`: 24h
  - `watching`: 12h
  - `escalated`: 6h
- `reason_code` explains why follow-up is (or is not) active.

## Workflow Status Guide

- `unreviewed`: no operator has triaged this store yet.
- `watching`: operator is monitoring and expects to re-check soon.
- `escalated`: needs stronger intervention, coordination, or engineering help.
- `resolved`: current pilot risk has been handled; return to monitoring.

Use `operator_note` for short factual context (what was checked, what is pending, next check time).

## Workflow History

Workflow history shows who changed status/note, when, and what changed. Use it to avoid duplicate work and to hand off context between operators.

## Notifications (Transition-Based)

Notifications emit only on transitions to reduce noise:

- `newly_needs_attention`
- `newly_attention_overdue`

No repeated notifications are emitted while state stays unchanged. Use notifications as an inbox signal, then confirm current state in store drill-down before acting.

## Quality trend (time windows)

`GET /operator-review/api/pilot-ops/quality-summary` includes `time_comparison`: default **last 7 days** vs the **previous 7 days** (override with `window_days`). It compares notification and workflow-history counts in each window, and approximates overdue follow-up quality using **pairing** (resolution in the window vs the latest prior `newly_attention_overdue` notification for that store). The point-in-time `quality_summary` block still reflects **current** store health and workflow.

## Daily Operating Loop

1. Open Pilot Ops list and start with `needs_attention` stores, overdue first.
2. Open store drill-down and review health, recent failed runs, workflow history, and notifications.
3. Update workflow status and note with concise next-action context.
4. Re-check overdue stores until moved to `resolved` or back to stable monitoring.
