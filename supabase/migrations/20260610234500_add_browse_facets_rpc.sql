-- DB-side facet aggregation for /catalog/browse/facets (2026-06-10).
--
-- The facets endpoint previously pulled ~13.8k rows THREE times per cold
-- load (categories, ADAs, sizes) and counted them in JS, plus 4 more
-- min/max queries. One RPC now returns the whole facet payload as a
-- single jsonb blob computed by Postgres GROUP BYs — one round-trip,
-- ~100x less data over the cross-region hop. Scale prep for hundreds of
-- stores cold-loading the catalog.
--
-- Output shape EXACTLY mirrors the JS implementation (which remains in
-- the route as a fallback if this function is missing):
--   categories: [{name, count}]           count desc
--   adas:       [{number, name, count}]   count desc, name falls back to 'ADA <number>'
--   sizes:      [{ml, label, count}]      ml asc, label falls back to '<ml> ML'
--   priceRange: {min, max}                floor/ceil ints
--   proofRange: {min, max}                floor/ceil ints
--
-- DEPLOY ORDER: safe in any order — the API falls back to the JS path
-- until this exists. Run it to turn the speedup on.

CREATE OR REPLACE FUNCTION public.browse_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'categories', (
      SELECT coalesce(
        jsonb_agg(jsonb_build_object('name', name, 'count', cnt) ORDER BY cnt DESC),
        '[]'::jsonb
      )
      FROM (
        SELECT btrim(category) AS name, count(*) AS cnt
        FROM public.mlcc_items
        WHERE is_active AND category IS NOT NULL AND btrim(category) <> ''
        GROUP BY btrim(category)
      ) c
    ),
    'adas', (
      SELECT coalesce(
        jsonb_agg(jsonb_build_object('number', number, 'name', name, 'count', cnt) ORDER BY cnt DESC),
        '[]'::jsonb
      )
      FROM (
        SELECT
          btrim(ada_number) AS number,
          coalesce(max(nullif(btrim(ada_name), '')), 'ADA ' || btrim(ada_number)) AS name,
          count(*) AS cnt
        FROM public.mlcc_items
        WHERE is_active AND ada_number IS NOT NULL AND btrim(ada_number) <> ''
        GROUP BY btrim(ada_number)
      ) a
    ),
    'sizes', (
      SELECT coalesce(
        jsonb_agg(jsonb_build_object('ml', ml, 'label', label, 'count', cnt) ORDER BY ml ASC),
        '[]'::jsonb
      )
      FROM (
        SELECT
          bottle_size_ml AS ml,
          coalesce(max(nullif(btrim(bottle_size_label), '')), bottle_size_ml::text || ' ML') AS label,
          count(*) AS cnt
        FROM public.mlcc_items
        WHERE is_active AND bottle_size_ml IS NOT NULL AND bottle_size_ml > 0
        GROUP BY bottle_size_ml
      ) s
    ),
    'priceRange', (
      SELECT jsonb_build_object(
        'min', coalesce(floor(min(licensee_price)), 0),
        'max', coalesce(ceil(max(licensee_price)), 0)
      )
      FROM public.mlcc_items
      WHERE is_active AND licensee_price IS NOT NULL
    ),
    'proofRange', (
      SELECT jsonb_build_object(
        'min', coalesce(floor(min(proof)), 0),
        'max', coalesce(ceil(max(proof)), 0)
      )
      FROM public.mlcc_items
      WHERE is_active AND proof IS NOT NULL
    )
  );
$$;

COMMENT ON FUNCTION public.browse_facets() IS
  'Single-call facet aggregation for the catalog Browse filters. Replaces 7 row-shipping queries with one GROUP BY pass. API falls back to the JS implementation when absent.';
