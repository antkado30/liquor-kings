-- OPS HEARTBEATS (2026-08-13, launch-readiness sweep).
--
-- One tiny table the /health/deep endpoint reads to answer "is the
-- WORKER alive?" from either API machine. The worker polls
-- /execution-runs/claim-next every few seconds; claim-next upserts its
-- row here AT MOST once a minute (throttled, fail-soft) so the hot
-- claim path stays hot. A stale `at` (> 5 min) = worker down → deep
-- health goes 503 → the uptime monitor emails Tony.

create table if not exists public.ops_heartbeats (
  key text primary key,
  at timestamptz not null default now(),
  note text
);

alter table public.ops_heartbeats enable row level security;
