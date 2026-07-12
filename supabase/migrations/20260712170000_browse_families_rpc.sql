-- Family-first catalog scrolling (2026-07-12) — browse_families RPC.
--
-- Tony's call after grouped SEARCH shipped (7/11): family cards "should
-- be everywhere." This makes pure Catalog SCROLLING family-first too:
-- one card per product line across the whole ~9.8k-family catalog, with
-- the browse filters and sorts applied at the FAMILY level, paginated by
-- offset over deterministic ordering.
--
-- Same pattern as browse_facets (20260610234500): one round-trip, all
-- aggregation in Postgres GROUP BYs (~13.8k rows = milliseconds), jsonb
-- out, and the API keeps the FLAT grid as an automatic fallback until
-- this function exists — DEPLOY ORDER SAFE either way.
--
-- Grouping identity (mirrors the family-tree wiring, 2026-07-11):
--   * combos are ALWAYS singleton cards ('combo:'||code) — folding a
--     gift pack into its base family would make it unreachable, since
--     the size tree only shows a combo when it's the anchor;
--   * families group by family_key + category (~20 keys legitimately
--     span two categories — same rule as the /items/:code/family
--     endpoint);
--   * rows with no family_key (pre-engine stragglers) become singleton
--     cards by code — never silently dropped.
--
-- Sorts map to family aggregates:
--   featured (default) → min(featured_sort): ANY photographed member
--     lifts its family; the representative is picked by the same order,
--     so the card shows the photo that lifted it.
--   price_asc → min(licensee_price) · price_desc → max(licensee_price)
--   newest → max(last_price_book_date) · proof_asc/desc → min/max(proof)
-- Trailing ORDER BY grp guarantees a deterministic total order, so
-- OFFSET pagination can never skip or duplicate a family.

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
    END                                             AS base_name,
    (array_agg(
      jsonb_build_object(
        'id', id, 'code', code, 'name', name, 'category', category,
        'ada_number', ada_number, 'ada_name', ada_name,
        'bottle_size_ml', bottle_size_ml, 'bottle_size_label', bottle_size_label,
        'licensee_price', licensee_price, 'proof', proof, 'container', container,
        'is_new_item', is_new_item, 'last_price_book_date', last_price_book_date,
        'image_url', image_url, 'image_thumb_url', image_thumb_url
      )
      ORDER BY featured_sort ASC NULLS LAST, code ASC
    ))[1]                                           AS representative
  FROM filtered
  GROUP BY grp
)
SELECT coalesce(jsonb_agg(card), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'groupId',         grp,
    'baseName',        base_name,
    'isCombo',         is_combo,
    'sizeCount',       size_count,
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
