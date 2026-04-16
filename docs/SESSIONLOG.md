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

