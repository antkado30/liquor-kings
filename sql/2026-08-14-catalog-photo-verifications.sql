-- CATALOG PHOTO VERIFICATIONS (2026-08-14, Tony's green light: "make
-- sure it is 100% accurate have it double triple check").
--
-- Verdict ledger for the overnight photo-verify pass
-- (scripts/verify-catalog-photos.mjs). One row per checked code; the
-- script upserts, so re-runs refresh. --apply reads CONFIRMED_WRONG
-- rows and clears those images (image_source='verify_failed') so the
-- app shows the honest placeholder and the re-source lane can queue.
--
-- verdict values:
--   match           — both passes agree the photo shows this product
--   confirmed_wrong — pass 1 said wrong AND the independent pass 2
--                     (different prompt, prove-it-right framing) agreed
--   overruled       — pass 1 said wrong but pass 2 disagreed → photo
--                     KEPT (one model's word is never enough to clear)
--   unsure          — model could not judge (bad image, ambiguous) →
--                     kept, listed for human eyes
--   error           — fetch/API failure for this code (retry next run)

create table if not exists public.catalog_photo_verifications (
  code text primary key,
  verdict text not null,
  reason text,
  image_url_checked text,
  model text,
  confidence numeric,
  checked_at timestamptz not null default now(),
  applied_at timestamptz
);

alter table public.catalog_photo_verifications enable row level security;
