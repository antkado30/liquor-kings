-- AUDIT #26 (P1, §4 schema-vs-code drift, 2026-06-13)
--
-- mlcc_code_map and mlcc_item_codes are read by
-- services/api/src/services/bottle-identity.service.js — the identity/
-- fingerprint-verification path used on every add-to-cart and during
-- checkout (cart.routes.js, execution-run.service.js). NEITHER table has
-- ever had a migration in supabase/migrations/. They exist in prod only
-- because they were created by hand back in March 2026 (captured once in
-- the now-stale supabase/schema.sql dump, which itself is missing ~15
-- tables added since and should not be trusted as "the schema").
--
-- Disaster-recovery / fresh-environment gap this closes: if prod were ever
-- restored from supabase/migrations/* alone, or a new dev/staging DB
-- bootstrapped the same way, these two tables would be MISSING. Every
-- add-to-cart that misses the direct mlcc_items.code lookup and falls into
-- the code-rotation fallback (fetchMlccItemByPrimaryCode's mlcc_item_codes
-- query) would error and resolveAndVerifyBottleIdentity would return
-- CODE_MISMATCH("mlcc_resolve_failed") for that item.
--
-- `create table if not exists` makes this a no-op against prod (tables
-- already exist there) — it only matters for fresh environments. The RLS +
-- policy + index statements below are NOT guarded by table-existence and
-- WILL apply to prod's existing tables too (enabling RLS is idempotent and
-- safe to re-run).
--
-- Deliberate omission: the March dump's mlcc_code_map also had
-- `source_snapshot_id uuid references mlcc_pricebook_snapshots(id)`.
-- mlcc_pricebook_snapshots is itself a dead prototype-era table with no
-- migration and zero current code references, so it is NOT recreated here,
-- and source_snapshot_id is omitted — bottle-identity.service.js never
-- reads it. Reconciling prod's literal leftover column set (if any) is a
-- follow-up, not a blocker for fresh-environment parity.

create table if not exists public.mlcc_code_map (
  id uuid primary key default gen_random_uuid(),
  liquor_code text not null,
  bottle_id uuid references public.bottles(id) on delete set null,
  fingerprint text,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now()
);

create index if not exists mlcc_code_map_liquor_code_idx
  on public.mlcc_code_map (liquor_code);

create table if not exists public.mlcc_item_codes (
  id uuid primary key default gen_random_uuid(),
  mlcc_item_id uuid not null references public.mlcc_items(id) on delete cascade,
  mlcc_code text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  source text,
  created_at timestamptz not null default now(),
  constraint mlcc_code_nonempty check (length(trim(mlcc_code)) > 0)
);

create index if not exists mlcc_item_codes_mlcc_code_idx
  on public.mlcc_item_codes (mlcc_code);

create index if not exists mlcc_item_codes_mlcc_item_id_idx
  on public.mlcc_item_codes (mlcc_item_id);

-- Defense-in-depth: close the RLS gap on prod's existing tables too.
-- services/api always uses the service-role key (bypasses RLS), and
-- apps/scanner never queries these tables directly — so this is pure
-- upside, same "global catalog" pattern as mlcc_items / mlcc_brand_aliases
-- / upc_lookups / mlcc_rules / mlcc_price_book_runs.
alter table public.mlcc_code_map enable row level security;
alter table public.mlcc_item_codes enable row level security;

drop policy if exists mlcc_code_map_select_authenticated on public.mlcc_code_map;
create policy mlcc_code_map_select_authenticated
  on public.mlcc_code_map
  for select
  to authenticated
  using (true);

drop policy if exists mlcc_item_codes_select_authenticated on public.mlcc_item_codes;
create policy mlcc_item_codes_select_authenticated
  on public.mlcc_item_codes
  for select
  to authenticated
  using (true);
