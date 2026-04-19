CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS mlcc_items_name_normalized_trgm_idx
  ON public.mlcc_items
  USING gin (name_normalized gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_mlcc_items_fuzzy(
  search_query TEXT,
  match_threshold REAL DEFAULT 0.15,
  result_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.mlcc_items
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.*
  FROM public.mlcc_items m
  CROSS JOIN LATERAL (
    SELECT
      trim(
        regexp_replace(
          lower(regexp_replace(search_query, '[^a-z0-9 ]', '', 'g')),
          '\s+',
          ' ',
          'g'
        )
      ) AS nq
  ) q
  WHERE m.is_active = true
    AND m.name_normalized IS NOT NULL
    AND length(q.nq) > 0
    AND GREATEST(
      similarity(m.name_normalized, q.nq),
      word_similarity(q.nq, m.name_normalized)
    ) > match_threshold
  ORDER BY GREATEST(
    similarity(m.name_normalized, q.nq),
    word_similarity(q.nq, m.name_normalized)
  ) DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_mlcc_items_fuzzy(TEXT, REAL, INTEGER)
  TO authenticated, anon;
