-- Audit trail for UPC → MLCC matching (scanner + API scoring decisions).

create table public.upc_match_audit (
  id uuid primary key default gen_random_uuid(),
  upc text not null,
  upc_brand text,
  upc_product_name text,
  upc_product_name_raw text,
  matched_mlcc_code text,
  match_mode text not null,
  confidence_score integer,
  confidence_warning text,
  scoring_breakdown jsonb,
  all_candidate_scores jsonb,
  cached boolean default false,
  flagged_incorrect boolean default false,
  flagged_at timestamptz,
  flagged_reason text,
  created_at timestamptz not null default now()
);

create index idx_upc_match_audit_upc on public.upc_match_audit (upc);
create index idx_upc_match_audit_created_at on public.upc_match_audit (created_at desc);
create index idx_upc_match_audit_flagged on public.upc_match_audit (flagged_incorrect) where flagged_incorrect = true;

alter table public.upc_match_audit enable row level security;

create policy "service role full access upc_match_audit"
  on public.upc_match_audit
  for all
  to service_role
  using (true)
  with check (true);
