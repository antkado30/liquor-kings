-- Persisted Tier 2 ambiguous NRS matches awaiting operator review.
-- One row per UPC. When operator picks a candidate, we INSERT into
-- upc_mappings (confidence_source='operator_review') and update this
-- row's status to 'resolved'. When operator skips, status='skipped'.

create table public.nrs_ambiguous_review (
  id uuid primary key default gen_random_uuid(),
  upc text not null unique,
  nrs_name text not null,
  size_ml integer,
  top_candidates jsonb not null,
  -- top_candidates shape: [{ code: string, name: string, score: number }, ...]
  status text not null default 'pending',
  -- status values: 'pending' | 'resolved' | 'skipped'
  resolved_to_mlcc_code text,
  resolved_by text,
  resolved_at timestamptz,
  skipped_reason text,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nrs_ambiguous_review_status_idx on public.nrs_ambiguous_review (status);
create index nrs_ambiguous_review_created_at_idx on public.nrs_ambiguous_review (created_at desc);

alter table public.nrs_ambiguous_review enable row level security;

create policy "service role full access nrs_ambiguous_review"
  on public.nrs_ambiguous_review
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.nrs_ambiguous_review is
  'Tier 2 NRS import matches where the auto-scorer couldn''t pick a single MLCC code. Operator clears these via the admin review UI; resolved picks write to upc_mappings.';
