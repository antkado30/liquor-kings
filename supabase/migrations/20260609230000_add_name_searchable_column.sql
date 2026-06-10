-- Space- AND punctuation-free generated column for combined-word search.
--
-- Problem (Tony, 2026-06-09): MLCC names are inconsistent about spacing —
-- e.g. the catalog stores "RumChata" as one word, so a search for
-- "Rum Chata" (with a space), or vice-versa, can miss. name_normalized
-- only strips punctuation but KEEPS spaces, so a single combined-word query
-- token can't substring-match a spaced catalog name (or the reverse).
--
-- Fix: a second generated column that removes EVERYTHING non-alphanumeric
-- (spaces included). The search adds this column to each token's match group,
-- so it's purely ADDITIVE — it can only surface more matches, never remove
-- any that work today. Generated + STORED means every existing row is
-- recomputed automatically the moment this runs; no backfill loop needed.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the API code that
-- references name_searchable, or the search query will error on a missing
-- column.

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS name_searchable text GENERATED ALWAYS AS (
    regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]', '', 'g')
  ) STORED;

-- btree for prefix/equality; trigram (pg_trgm already enabled) accelerates
-- the %substring% ilike the search uses.
CREATE INDEX IF NOT EXISTS mlcc_items_name_searchable_idx
  ON public.mlcc_items USING btree (name_searchable);

CREATE INDEX IF NOT EXISTS mlcc_items_name_searchable_trgm_idx
  ON public.mlcc_items USING gin (name_searchable gin_trgm_ops);

COMMENT ON COLUMN public.mlcc_items.name_searchable IS
  'Fully alphanumeric (no spaces/punctuation) lowercase name. Lets combined-word MLCC names match spaced queries and vice-versa. Auto-generated from name.';
