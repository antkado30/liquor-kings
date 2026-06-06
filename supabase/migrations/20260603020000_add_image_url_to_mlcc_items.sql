-- Bottle images on the catalog table (task #65, 2026-06-03).
--
-- Tony's Browse page demands product imagery for the Amazon-style
-- experience: "I need pictures matching the name for the browsing
-- cards I need them for every single bottle we have ... we cannot
-- have random pictures to random bottles like imagine putting a
-- fifth of Tito's picture on a pint of Hennessy code."
--
-- The `bottles` table (per-store) already has image_url. The catalog
-- table mlcc_items did NOT — which means images we already source via
-- the scanner's UPCitemdb integration aren't available to Browse.
-- This migration adds the column. Backfill is a separate script
-- (services/api/scripts/backfill-mlcc-item-images.mjs) that walks
-- upc_mappings + UPCitemdb to populate it.

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS image_url text;

-- Track where the image came from for auditability + future re-sourcing.
-- Values: 'upcitemdb' | 'mlcc_scrape' | 'manual' | 'ai_generated' | NULL.
ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS image_source text;

-- When was this image last fetched / verified. Cleared on column update
-- by the trigger so a re-fetch always updates the timestamp.
ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS image_updated_at timestamptz;

-- Index lets us efficiently find SKUs MISSING images for the backfill
-- script ("WHERE image_url IS NULL"). Partial index because almost
-- every row will eventually have an image; the index only holds the
-- shrinking unimaged minority.
CREATE INDEX IF NOT EXISTS idx_mlcc_items_missing_image
  ON public.mlcc_items (code)
  WHERE image_url IS NULL;

COMMENT ON COLUMN public.mlcc_items.image_url IS
  'Canonical product image URL. Sourced via UPCitemdb (scanner path) + backfill scripts. Browse page (#64) uses this; falls back to a category placeholder when null.';
COMMENT ON COLUMN public.mlcc_items.image_source IS
  'Provenance of the current image_url: upcitemdb | mlcc_scrape | manual | ai_generated.';
