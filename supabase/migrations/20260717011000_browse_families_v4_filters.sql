-- browse_families v4: advanced filters (2026-07-15 spec, APPLY FRIDAY 7/17
-- after order day — pairs with 20260717010000).
--
-- Adds three OPTIONAL params to the page-scoped v3 (20260714230000):
--   p_container     'glass' | 'plastic' — container material filter
--   p_packs         'singles' | 'packs' — single bottles vs multi-packs
--                   (combos count as packs; they're multi-bottle)
--   p_ordered_store uuid — only families this store has actually ordered
--                   (store_item_order_stats, the "Ordered before" filter)
--
-- POSTGRES TRAP handled here: CREATE OR REPLACE with MORE parameters does
-- NOT replace — it creates an OVERLOAD, and then a caller passing only
-- p_limit is ambiguous between the two and PostgREST errors. So: DROP the
-- old 10-arg signature explicitly, then CREATE the 13-arg one. Deploy
-- order stays safe: the already-deployed API calls with the old named
-- args → they match the new function and the new params take their NULL
-- defaults (= no filter), byte-identical behavior until the client sends
-- the new filters.

DROP FUNCTION IF EXISTS public.browse_families(
  text, text, numeric, numeric, numeric, numeric, boolean, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.browse_families(
  p_category  text    DEFAULT NULL,
  p_ada_number text   DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_min_proof numeric DEFAULT NULL,
  p_max_proof numeric DEFAULT NULL,
  p_new_only  boolean DEFAULT false,
  p_sort      text    DEFAULT 'featured',
  p_limit     integer DEFAULT 30,
  p_offset    integer DEFAULT 0,
  p_container text    DEFAULT NULL,
  p_packs     text    DEFAULT NULL,
  p_ordered_store uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH filtered AS (
  SELECT
    id, code, name, category, ada_number, ada_name,
    bottle_size_ml, bottle_size_label, licensee_price, proof, container,
    is_new_item, last_price_book_date, image_url, image_thumb_url,
    featured_sort, is_combo, family_key,
    CASE
      WHEN is_combo IS TRUE THEN 'combo:' || code
      WHEN coalesce(btrim(family_key), '') <> ''
        THEN 'fam:' || family_key || '|' || coalesce(btrim(category), '')
      ELSE 'code:' || code
    END AS grp
  FROM public.mlcc_items
  WHERE is_active
    AND (p_category  IS NULL OR category   = p_category)
    AND (p_ada_number IS NULL OR ada_number = p_ada_number)
    AND (p_min_price IS NULL OR licensee_price >= p_min_price)
    AND (p_max_price IS NULL OR licensee_price <= p_max_price)
    AND (p_min_proof IS NULL OR proof >= p_min_proof)
    AND (p_max_proof IS NULL OR proof <= p_max_proof)
    AND (NOT p_new_only OR is_new_item IS TRUE)
    AND (p_container IS NULL
         OR coalesce(nullif(btrim(container), ''), 'glass') = p_container)
    AND (p_packs IS NULL
         OR (p_packs = 'singles' AND coalesce(pack_count, 1) < 2 AND is_combo IS NOT TRUE)
         OR (p_packs = 'packs'   AND (coalesce(pack_count, 0) >= 2 OR is_combo IS TRUE)))
    AND (p_ordered_store IS NULL OR EXISTS (
          SELECT 1 FROM public.store_item_order_stats st
          WHERE st.store_id = p_ordered_store AND st.code = mlcc_items.code))
),
grouped AS (
  SELECT
    grp,
    bool_or(is_combo IS TRUE)                       AS is_combo,
    count(DISTINCT code)                            AS size_count,
    min(licensee_price)                             AS min_price,
    max(licensee_price)                             AS max_price,
    max(last_price_book_date)                       AS newest_date,
    min(proof)                                      AS min_proof_v,
    max(proof)                                      AS max_proof_v,
    min(featured_sort)                              AS featured_rank,
    count(DISTINCT coalesce(nullif(btrim(container), ''), 'glass')) > 1
                                                    AS mixed_containers,
    CASE
      WHEN bool_or(is_combo IS TRUE) THEN max(name)
      WHEN max(coalesce(btrim(family_key), '')) <> '' THEN max(family_key)
      ELSE max(name)
    END                                             AS base_name
  FROM filtered
  GROUP BY grp
),
page AS (
  SELECT *
  FROM grouped
  ORDER BY
    CASE WHEN p_sort = 'price_asc'  THEN min_price   END ASC  NULLS LAST,
    CASE WHEN p_sort = 'price_desc' THEN max_price   END DESC NULLS LAST,
    CASE WHEN p_sort = 'newest'     THEN newest_date END DESC NULLS LAST,
    CASE WHEN p_sort = 'proof_asc'  THEN min_proof_v END ASC  NULLS LAST,
    CASE WHEN p_sort = 'proof_desc' THEN max_proof_v END DESC NULLS LAST,
    featured_rank ASC NULLS LAST,
    grp ASC
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 61)
  OFFSET greatest(coalesce(p_offset, 0), 0)
),
reps AS (
  SELECT DISTINCT ON (f.grp)
    f.grp,
    jsonb_build_object(
      'id', f.id, 'code', f.code, 'name', f.name, 'category', f.category,
      'ada_number', f.ada_number, 'ada_name', f.ada_name,
      'bottle_size_ml', f.bottle_size_ml, 'bottle_size_label', f.bottle_size_label,
      'licensee_price', f.licensee_price, 'proof', f.proof, 'container', f.container,
      'is_new_item', f.is_new_item, 'last_price_book_date', f.last_price_book_date,
      'image_url', f.image_url, 'image_thumb_url', f.image_thumb_url
    ) AS representative
  FROM filtered f
  JOIN page p USING (grp)
  ORDER BY f.grp, f.featured_sort ASC NULLS LAST, f.code ASC
),
page_sizes AS (
  SELECT grp, array_agg(lbl ORDER BY ml NULLS LAST) AS size_labels
  FROM (
    SELECT DISTINCT
      f.grp,
      f.bottle_size_ml AS ml,
      coalesce(nullif(btrim(f.bottle_size_label), ''), f.bottle_size_ml::text || ' ML') AS lbl
    FROM filtered f
    JOIN page p USING (grp)
    WHERE NOT (f.is_combo IS TRUE)
  ) d
  GROUP BY grp
)
SELECT coalesce(
  jsonb_agg(
    jsonb_build_object(
      'groupId',         p.grp,
      'baseName',        p.base_name,
      'isCombo',         p.is_combo,
      'sizeCount',       p.size_count,
      'sizes',           to_jsonb(coalesce(s.size_labels, ARRAY[]::text[])),
      'minPrice',        p.min_price,
      'maxPrice',        p.max_price,
      'mixedContainers', p.mixed_containers,
      'representative',  r.representative
    )
    ORDER BY
      CASE WHEN p_sort = 'price_asc'  THEN p.min_price   END ASC  NULLS LAST,
      CASE WHEN p_sort = 'price_desc' THEN p.max_price   END DESC NULLS LAST,
      CASE WHEN p_sort = 'newest'     THEN p.newest_date END DESC NULLS LAST,
      CASE WHEN p_sort = 'proof_asc'  THEN p.min_proof_v END ASC  NULLS LAST,
      CASE WHEN p_sort = 'proof_desc' THEN p.max_proof_v END DESC NULLS LAST,
      p.featured_rank ASC NULLS LAST,
      p.grp ASC
  ),
  '[]'::jsonb
)
FROM page p
LEFT JOIN reps r USING (grp)
LEFT JOIN page_sizes s USING (grp);
$$;
