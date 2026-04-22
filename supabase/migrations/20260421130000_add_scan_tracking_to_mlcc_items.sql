-- Scan frequency for search ranking (Part 5).

alter table public.mlcc_items
  add column if not exists scan_count integer not null default 0,
  add column if not exists last_scanned_at timestamptz;

create index if not exists idx_mlcc_items_scan_count on public.mlcc_items (scan_count desc);
