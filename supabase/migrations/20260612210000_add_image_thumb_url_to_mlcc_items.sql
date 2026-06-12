-- Quality mandate (2026-06-12): grid-sized thumbnails for catalog photos.
--
-- The serper backfill stored ORIGINAL retailer images (often 1-3 MB) and
-- the Browse grid was decoding them down to ~150px tiles — network + CPU
-- + GPU burn on every scroll (the phone-overheating class). The grid and
-- candidate pickers now render a ~360px WebP thumb (~10-25 KB) instead;
-- the full image stays on the ProductCard detail view.
--
-- Additive + nullable: code treats a NULL thumb as "fall back to
-- image_url", so this migration is safe in either deploy order.

alter table public.mlcc_items
  add column if not exists image_thumb_url text;

comment on column public.mlcc_items.image_thumb_url is
  'Grid-sized (~360px WebP) thumbnail URL. NULL = fall back to image_url. Set by scripts/build-image-thumbs.mjs, the serper backfill, and in-store capture.';
