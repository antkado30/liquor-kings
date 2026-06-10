-- Space- AND punctuation-free generated column for bottles — the Tito's
-- class swept system-wide (Tony, 2026-06-10).
--
-- Problem: mlcc_items got name_searchable on 2026-06-09, but `bottles`
-- (per-store inventory) did not. The Inventory page search and the
-- assistant's query_inventory tool still missed "Titos" → "TITO'S
-- HANDMADE VODKA" (apostrophes), curly-apostrophe iOS input, and
-- RumChata-style spacing.
--
-- Mirrors 20260609230000 exactly: generated STORED column, btree +
-- trigram indexes (pg_trgm already enabled). Purely additive.
--
-- DEPLOY ORDER: apply this migration in the prod Supabase SQL editor
-- BEFORE deploying API code that references bottles.name_searchable.

ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS name_searchable text GENERATED ALWAYS AS (
    regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g')
  ) STORED;

CREATE INDEX IF NOT EXISTS bottles_name_searchable_idx
  ON public.bottles USING btree (name_searchable);

CREATE INDEX IF NOT EXISTS bottles_name_searchable_trgm_idx
  ON public.bottles USING gin (name_searchable gin_trgm_ops);

COMMENT ON COLUMN public.bottles.name_searchable IS
  'Fully alphanumeric (no spaces/punctuation) lowercase name. Lets the Inventory search and assistant inventory tool match punctuation/spacing-variant queries. Auto-generated from name.';
