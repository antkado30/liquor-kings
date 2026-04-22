-- Authoritative UPC-to-MLCC mappings. When present, a row here overrides
-- scoring-based matching for that UPC (API checks this table first).

create table public.upc_mappings (
  id uuid primary key default gen_random_uuid(),
  upc text not null unique,
  mlcc_code text not null,
  -- No FK: mlcc_items.code is not unique (duplicate codes across ADA distributors).
  -- Orphan cleanup handled at application layer via deleteUpcMapping.
  confidence_source text not null,
  -- confidence_source values: 'user_confirmed', 'auto_high_score', 'bulk_seed', 'manual_admin'
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  scan_count integer not null default 0,
  flag_count integer not null default 0,
  last_scanned_at timestamptz,
  last_flagged_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index upc_mappings_upc_idx on public.upc_mappings (upc);
create index upc_mappings_mlcc_code_idx on public.upc_mappings (mlcc_code);
create index upc_mappings_confidence_source_idx on public.upc_mappings (confidence_source);

alter table public.upc_mappings enable row level security;

create policy "Service role can do everything"
  on public.upc_mappings
  for all
  to service_role
  using (true)
  with check (true);

-- Seed from legacy mlcc_items.upc cache (one-time backfill).
insert into public.upc_mappings (upc, mlcc_code, confidence_source, scan_count, notes)
select
  upc,
  code,
  'auto_high_score',
  coalesce(scan_count, 0),
  'Seeded from mlcc_items.upc at table creation'
from public.mlcc_items
where upc is not null
  and btrim(upc) <> ''
on conflict (upc) do nothing;
