-- BRAND FLAGSHIPS knowledge table (2026-08-12, Tony's law: flagship
-- resolution "has to work for EVERY bottle").
--
-- Derived by scripts/build-brand-flagships.mjs from the catalog's own
-- size-ladder signal; read by the resolver (src/lib/brand-flagships.js,
-- 5-minute cache). source values:
--   'heuristic' — written by the build script; re-runs may update it
--   'curated'   — hand-set (Tony/operator); build script NEVER touches it
--
-- Fixing a wrong flagship = one UPDATE with source='curated', no deploy:
--   update brand_flagships set alias_terms = '{capt,morgan,spiced,rum}',
--     source = 'curated' where brand_key = 'captain morgan';

create table if not exists public.brand_flagships (
  brand_key text primary key,
  alias_terms text[] not null,
  flagship_code text,
  flagship_name text,
  source text not null default 'heuristic',
  confident boolean not null default true,
  score numeric,
  runner_up text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.brand_flagships is
  'Bare-brand -> flagship alias terms, derived from catalog size ladders. Read by resolve-order-lines; built by scripts/build-brand-flagships.mjs.';

-- Service-role only (same posture as other internal tables): RLS on,
-- no policies — anon/authenticated cannot touch it; the API uses the
-- service key.
alter table public.brand_flagships enable row level security;
