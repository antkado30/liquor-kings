-- Featured sort v2: photos first, POPULAR first within photos
-- (Tony, 2026-06-10 smoke test: "the photos at the top are literally the
-- most random bottles ever — put the popular ones at top, the ones
-- people actually know").
--
-- v1 sorted photographed bottles A-Z, so the catalog opened on
-- "1887 GRAND BOURBON" instead of Tito's. v2 key:
--   <image-rank>~<inverted zero-padded scan_count>~<name>
-- → photographed bottles first, most-scanned first within them, name as
-- the tiebreak. scan_count rises as stores scan, so the catalog keeps
-- re-ranking itself toward what people actually buy. (Generated STORED
-- column recomputes on row update — scan-count bumps already update the
-- row, so this is free.)
--
-- Replaces 20260610233000's column in place: same name, so the deployed
-- API needs NO code change. Safe to run on prod any time.

ALTER TABLE public.mlcc_items DROP COLUMN IF EXISTS featured_sort;

ALTER TABLE public.mlcc_items
  ADD COLUMN featured_sort text GENERATED ALWAYS AS (
    (CASE WHEN image_url IS NULL THEN '1~' ELSE '0~' END) ||
    lpad((1000000 - least(coalesce(scan_count, 0), 999999))::text, 7, '0') ||
    '~' ||
    lower(coalesce(name, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS mlcc_items_featured_sort_idx
  ON public.mlcc_items USING btree (featured_sort);

COMMENT ON COLUMN public.mlcc_items.featured_sort IS
  'Generated sort key: image-presence rank, then inverted scan_count (popular first), then lowercase name. Drives the catalog''s default "Featured" ordering and self-reranks as scans accumulate.';
