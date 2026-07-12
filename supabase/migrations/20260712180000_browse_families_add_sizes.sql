-- browse_families: add the per-family SIZE LABEL list (2026-07-12).
--
-- The premium catalog card (Tony's design pass) shows a family's actual
-- sizes as chips — "750 mL · 1.75 L · +4" — not just a count. The
-- 20260712170000 version returned sizeCount but not the labels, so this
-- CREATE OR REPLACE adds a `sizes` array (distinct size labels ordered
-- small→large) to every card. Additive: same signature, one new jsonb
-- key; the client reads it when present and falls back to the count
-- otherwise. Re-run this in the SQL editor over the prior version.

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
    *,
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
sizes AS (
  SELECT grp, array_agg(lbl ORDER BY ml NULLS LAST) AS size_labels
  FROM (
    SELECT DISTINCT
      grp,
      bottle_size_ml AS ml,
      coalesce(nullif(btrim(bottle_size_label), ''), bottle_size_ml::text || ' ML') AS lbl
    FROM filtered
    WHERE NOT (is_combo IS TRUE)  -- combos are singletons; their label is the name
  ) d
  GROUP BY grp
),
grouped AS (
  SELECT
    f.grp,
    bool_or(f.is_combo IS TRUE)                     AS is_combo,
    count(DISTINCT f.code)                          AS size_count,
    min(f.licensee_price)                           AS min_price,
    max(f.licensee_price)                           AS max_price,
    max(f.last_price_book_date)                     AS newest_date,
    min(f.proof)                                    AS min_proof_v,
    max(f.proof)                                    AS max_proof_v,
    min(f.featured_sort)                            AS featured_rank,
    count(DISTINCT coalesce(nullif(btrim(f.container), ''), 'glass')) > 1
                                                    AS mixed_containers,
    coalesce(s.size_labels, ARRAY[]::text[])        AS size_labels,
    CASE
      WHEN bool_or(f.is_combo IS TRUE) THEN max(f.name)
      WHEN max(coalesce(btrim(f.family_key), '')) <> '' THEN max(f.family_key)
      ELSE max(f.name)
    END                                             AS base_name,
    (array_agg(
      jsonb_build_object(
        'id', f.id, 'code', f.code, 'name', f.name, 'category', f.category,
        'ada_number', f.ada_number, 'ada_name', f.ada_name,
        'bottle_size_ml', f.bottle_size_ml, 'bottle_size_label', f.bottle_size_label,
        'licensee_price', f.licensee_price, 'proof', f.proof, 'container', f.container,
        'is_new_item', f.is_new_item, 'last_price_book_date', f.last_price_book_date,
        'image_url', f.image_url, 'image_thumb_url', f.image_thumb_url
      )
      ORDER BY f.featured_sort ASC NULLS LAST, f.code ASC
    ))[1]                                           AS representative
  FROM filtered f
  LEFT JOIN sizes s USING (grp)
  GROUP BY f.grp, s.size_labels
)
SELECT coalesce(jsonb_agg(card), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'groupId',         grp,
    'baseName',        base_name,
    'isCombo',         is_combo,
    'sizeCount',       size_count,
    'sizes',           to_jsonb(size_labels),
    'minPrice',        min_price,
    'maxPrice',        max_price,
    'mixedContainers', mixed_containers,
    'representative',  representative
  ) AS card
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
) page;
$$;
