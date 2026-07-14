-- browse_families: PAGE-SCOPED rewrite (2026-07-14).
--
-- WHY: the 20260712180000 version timed out through PostgREST even on a
-- QUIET database (proven 7/14: Tony's REST probe failed at rest while the
-- SQL editor returned correct results) — so the Catalog tab has been
-- silently riding its flat-grid fallback since the feature shipped. The
-- old shape materialized the FULL wide row set (SELECT *) and built a
-- representative jsonb + sorted array for EVERY one of ~9,800 families on
-- EVERY page request, then threw away all but ~31.
--
-- WHAT CHANGED (output shape is byte-compatible — same signature, same
-- card keys, same sort semantics; the client needs nothing):
--   1. `filtered` selects ONLY the columns the query uses — no tsvector
--      or other wide baggage rides the materialization.
--   2. `grouped` is pure cheap aggregates (counts/min/max) — no jsonb,
--      no arrays. One narrow scan of ~14k rows.
--   3. LIMIT/OFFSET applies to `grouped` FIRST (`page`), and only THEN
--      are the expensive parts — representative jsonb (DISTINCT ON) and
--      the size-label array — built, for ~31 groups instead of ~9,800.
--
-- Safety: CREATE OR REPLACE, instant, catalog-read-only. If anything is
-- wrong the API's existing timeout/fallback path keeps the flat grid —
-- worst case equals today. Apply in the SQL editor (verify project
-- eamoozfhqolshdztbrez), then re-run the REST timing probe.

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
  p_offset    integer DEFAULT 0
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
  -- Representative row per PAGED family only: first by featured order,
  -- code as the stable tiebreak — same winner the old array_agg[1] picked.
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
  -- Distinct size labels small→large per PAGED family (combos excluded —
  -- their label is the name), identical to the old `sizes` CTE semantics.
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
-- Final assembly re-states the page sort explicitly (the standard gives no
-- order guarantee through joins) — sorting ~31 rows twice is free;
-- a wrong order on the shelf is not.
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
