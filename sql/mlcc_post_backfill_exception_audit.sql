-- sql/mlcc_post_backfill_exception_audit.sql
--
-- Purpose:
--   Read-only staging audit that lists bottles still missing mlcc_item_id
--   after the guarded backfill flow. It classifies each remaining row into a
--   small exception bucket so operators can quickly see why it did not resolve.
--
-- Safety:
--   - SELECT-only
--   - no writes
--   - safe to run in staging
--
-- Notes:
--   - This audit assumes the bottle display column is public.bottles.name.
--   - If the repo uses a different human-readable bottle column, substitute
--     that column only; keep the rest of the logic unchanged.

WITH bottle_base AS (
  SELECT
    b.id AS bottle_id,
    b.name AS bottle_name,
    b.mlcc_code,
    b.mlcc_item_id,
    trim(coalesce(b.mlcc_code, '')) AS trimmed_mlcc_code,
    regexp_replace(trim(coalesce(b.mlcc_code, '')), '\s+', '', 'g') AS normalized_mlcc_code
  FROM public.bottles b
  WHERE b.mlcc_item_id IS NULL
),
match_counts AS (
  SELECT
    bb.bottle_id,
    COUNT(mi.id) AS exact_match_count_in_mlcc_items
  FROM bottle_base bb
  LEFT JOIN public.mlcc_items mi
    ON mi.code = bb.trimmed_mlcc_code
  GROUP BY bb.bottle_id
),
classified AS (
  SELECT
    bb.bottle_id,
    bb.bottle_name,
    bb.mlcc_code,
    bb.normalized_mlcc_code,
    mc.exact_match_count_in_mlcc_items,
    CASE
      WHEN bb.trimmed_mlcc_code = '' THEN 'blank_code'
      WHEN bb.normalized_mlcc_code !~ '^[0-9]+$' THEN 'bad_code_format'
      WHEN mc.exact_match_count_in_mlcc_items = 1 THEN 'exact_match_available'
      WHEN mc.exact_match_count_in_mlcc_items > 1 THEN 'ambiguous_code'
      ELSE 'code_not_found'
    END AS status_bucket
  FROM bottle_base bb
  JOIN match_counts mc
    ON mc.bottle_id = bb.bottle_id
)
SELECT
  bottle_id,
  bottle_name,
  mlcc_code,
  normalized_mlcc_code,
  exact_match_count_in_mlcc_items,
  status_bucket
FROM classified
ORDER BY
  CASE status_bucket
    WHEN 'exact_match_available' THEN 1
    WHEN 'ambiguous_code' THEN 2
    WHEN 'code_not_found' THEN 3
    WHEN 'bad_code_format' THEN 4
    WHEN 'blank_code' THEN 5
    ELSE 99
  END,
  bottle_name NULLS LAST,
  bottle_id;
