# What’s next — near-term snapshot

Short, **honest** list of active safety/correctness themes. Update this file when priorities shift, a major item ships, or a blocker appears. **Do not** paste the whole 90-day plan here.

**Plan anchor (context, not duplicated):** [Strategic architecture](../lk/architecture/strategic-architecture.md) · [RPA safety rules](../lk/architecture/rpa-safety-rules.md) · [RPA rebuild phases](../lk/architecture/rpa-rebuild-phases.md) · [Developer anti-drift](../lk/DEVELOPER_ANTI_DRIFT.md)

---

## 90-day plan “gates” (loose mapping)

Use these as **checklist labels**, not as a full roadmap:

| Gate (concept) | Near-term artifact / action |
|----------------|-----------------------------|
| **G1 — Visibility** | Keep safety/mapping/RLS/selector docs **current** with reality; rollup: [`RPA_SUBSYSTEM_DONE.md`](./RPA_SUBSYSTEM_DONE.md) (`docs/SAFETY_INVARIANTS.md`, `docs/SELECTORS.md`, `docs/MLCC_MAPPING.md`, `docs/RLS_AUDIT.md`). |
| **G2 — Measurable posture** | Run read-only SQL audits on **staging** (or prod-read-only); refresh snapshot tables in `docs/RLS_AUDIT.md` and `docs/MLCC_MAPPING.md`. |
| **G3 — Automation trust** | After doc/sql refresh, run `npm run safety:lk:rpa-local` (or CI-equivalent) before merging RPA-adjacent work. |
| **G4 — Operator continuity** | Use [`SESSIONLOG.md`](./SESSIONLOG.md) every burst; trim or update **this** file when themes complete. |

---

## Current focus (edit as needed)

1. **RLS audit** — Execute `sql/rls_audit_query.sql`; align `docs/RLS_AUDIT.md` table with output; track RED tables for future hardening tasks (no policy edits in this lane).
2. **MLCC mapping audit** — Execute `sql/mlcc_mapping_audit.sql`; refresh `docs/MLCC_MAPPING.md` snapshot; remember **runtime** `mappingconfidence` is enforced in dry-run code paths (see that doc).
3. **Selector audit** — `docs/SELECTORS.md` is the inventory + **pilot disposition** for remaining RED; expand to GREEN only in scoped tasks.
4. **Session continuity** — End each burst with a new `SESSIONLOG.md` entry; start each burst with last 2–3 entries + this file.

---

## Explicitly not listed here

- Day-to-day product features unrelated to safety/correctness.
- Full MILO vs browser lane strategy (see strategic architecture doc).
- Anything that belongs in a ticket tracker — link tickets in SESSIONLOG instead of duplicating here.
