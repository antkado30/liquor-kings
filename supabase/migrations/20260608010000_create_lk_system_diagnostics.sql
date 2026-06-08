-- Create lk_system_diagnostics (2026-06-08).
--
-- This table was referenced by code (services/api/src/services/diagnostics.service.js
-- writes to it; operator-diagnostics.service.js reads it) but never had a
-- migration, so prod was missing it — the Overview + Diagnostics pages showed
-- "Could not find the table 'public.lk_system_diagnostics' in the schema cache"
-- and every diagnostic log write was silently failing.
--
-- Columns match the exact insert shape (store_id, run_by_user_id, source,
-- payload) and the read select (id, store_id, run_by_user_id, source, payload,
-- created_at, filtered by store_id with NULL = global, ordered by created_at).

create extension if not exists pgcrypto;

create table if not exists public.lk_system_diagnostics (
  id uuid primary key default gen_random_uuid(),
  store_id uuid,                                   -- NULL = global / not store-scoped
  run_by_user_id uuid,                             -- NULL = system
  source text,
  payload jsonb not null default '{}'::jsonb,      -- { kind, ...event fields, recorded_at }
  created_at timestamptz not null default now()
);

-- Reads order by created_at desc and filter by store (or global NULL).
create index if not exists idx_lk_system_diagnostics_created_at
  on public.lk_system_diagnostics (created_at desc);
create index if not exists idx_lk_system_diagnostics_store_created
  on public.lk_system_diagnostics (store_id, created_at desc);

-- RLS on, no policies: only the service-role API (which bypasses RLS) touches
-- this table. Anon/authenticated clients get no direct access. Matches LK's
-- "RLS on, server-mediated" security posture.
alter table public.lk_system_diagnostics enable row level security;
