-- Generated column for punctuation-insensitive product name search (aligned with API normalizeSearchTerm).

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS name_normalized text GENERATED ALWAYS AS (
    lower(
      trim(
        both ' ' FROM regexp_replace(regexp_replace(coalesce(name, ''), '[^a-zA-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')
      )
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS mlcc_items_name_normalized_idx ON public.mlcc_items USING btree (name_normalized);

COMMENT ON COLUMN public.mlcc_items.name_normalized IS
  'Punctuation-stripped lowercase name for fuzzy search. Auto-generated from name column.';
