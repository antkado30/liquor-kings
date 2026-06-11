-- Photos-first "Featured" catalog ordering (Tony, 2026-06-10).
--
-- Tony: "any bottle that has a photo, push it to the top of the catalog —
-- scroll far enough and you see the ones without pictures, until we have
-- all the pictures figured out."
--
-- The browse cursor pagination is single-sort-column + id, so the rank
-- and the name are fused into ONE generated text column:
--   '0~' || lower(name)   when the row has an image
--   '1~' || lower(name)   when it doesn't
-- Sorting ascending gives: photographed bottles A-Z, then placeholder
-- bottles A-Z. The column recomputes automatically whenever image_url
-- changes (backfill writes, in-store captures, wrong-photo reports), so
-- the catalog reorders itself as coverage grows — no maintenance.
--
-- DEPLOY ORDER: apply BEFORE deploying API code that references
-- featured_sort.

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS featured_sort text GENERATED ALWAYS AS (
    (CASE WHEN image_url IS NULL THEN '1~' ELSE '0~' END) ||
    lower(coalesce(name, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS mlcc_items_featured_sort_idx
  ON public.mlcc_items USING btree (featured_sort);

COMMENT ON COLUMN public.mlcc_items.featured_sort IS
  'Generated sort key: image-presence rank (0=has photo, 1=placeholder) + lowercase name. Drives the catalog''s default "Featured" ordering — photographed bottles first, A-Z within each group.';
