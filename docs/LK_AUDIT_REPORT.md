# Liquor Kings — diagnostic audit snapshot

_Generated: 2026-03-30T20:16:31.864Z_

## Summary

| Area | Notes |
|------|-------|
| Repository | partial / thin |
| Supabase (data plane) | reachable |
| RLS / policies | UNVERIFIED |
| Edge functions | UNVERIFIED |

## What looks complete

- Repo scan + `services/api` route wiring inventory (see `repo_summary.subsystems`).
- Supabase table probes for the curated LK list (see `db_summary.tables`).

## What is partially complete

- Index parity (live vs migrations): **UNVERIFIED** without direct SQL.
- Edge Function deployment list: **CLI-dependent** (see `db_summary.edge_functions`).

## What is missing

- `apps/web`, `apps/admin`, `packages/*` if not present (expected for a backend-only checkout).
- Dedicated auth/membership API routes in `services/api` (not found in this repo snapshot).

## What is broken / risky

- (No structural ESM breakage detected by this audit.)

- **medium:** Expected top-level paths are missing (monorepo may be intentionally thin).
- **medium:** RLS and policies were not verified against anon/authenticated roles in this run.
- **low:** Deployed Edge Functions could not be listed via Supabase CLI (see edge_functions.raw).

## Blockers

- (No hard blockers beyond environment/DB issues above.)

## Recommended single next lane

Stand up missing client apps (apps/web, apps/admin) or document intentional scope; add CI running `npm run audit:lk` on main.

---

_This file is overwritten on each `npm run audit:lk`. Persisted rows live in `public.lk_system_diagnostics` (payload JSON)._
