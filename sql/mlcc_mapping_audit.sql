-- Liquor Kings — read-only MLCC catalog / bottle linkage audit (SELECT only).
-- Note: runtime mappingconfidence (confirmed | inferred | unknown) lives on dry-run
-- execution payloads, not on public.mlcc_items. This query measures how completely
-- store bottles are linked to authoritative mlcc_items rows (a prerequisite layer).
--
-- Run:
--   psql "$STAGING_DATABASE_URL" -f sql/mlcc_mapping_audit.sql
-- CSV:
--   psql "$STAGING_DATABASE_URL" -f sql/mlcc_mapping_audit.sql --csv > mlcc_mapping_audit.csv

-- 1) Single-row summary: catalog size + bottle linkage coverage
WITH
  mi AS (
    SELECT COUNT(*)::bigint AS total_mlcc_items
    FROM public.mlcc_items
  ),
  bot AS (
    SELECT
      COUNT(*)::bigint AS total_bottles,
      COUNT(*) FILTER (WHERE mlcc_item_id IS NOT NULL)::bigint AS bottles_with_mlcc_item_id,
      COUNT(*) FILTER (
        WHERE mlcc_item_id IS NULL
          AND NULLIF(TRIM(mlcc_code), '') IS NOT NULL
      )::bigint AS bottles_code_only_no_fk
    FROM public.bottles
  ),
  join_ok AS (
    SELECT COUNT(*)::bigint AS bottles_with_valid_join
    FROM public.bottles b
    INNER JOIN public.mlcc_items i ON i.id = b.mlcc_item_id
  ),
  orphan_code AS (
    SELECT COUNT(*)::bigint AS bottles_code_not_in_catalog
    FROM public.bottles b
    WHERE b.mlcc_item_id IS NULL
      AND NULLIF(TRIM(b.mlcc_code), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.mlcc_items i
        WHERE i.code = b.mlcc_code
      )
  )
SELECT
  mi.total_mlcc_items,
  bot.total_bottles,
  bot.bottles_with_mlcc_item_id,
  bot.bottles_code_only_no_fk,
  j.bottles_with_valid_join,
  o.bottles_code_not_in_catalog,
  CASE
    WHEN bot.total_bottles > 0 THEN
      round(100.0 * bot.bottles_with_mlcc_item_id::numeric / bot.total_bottles::numeric, 2)
  END AS pct_bottles_with_mlcc_item_id,
  CASE
    WHEN bot.total_bottles > 0 THEN
      round(100.0 * j.bottles_with_valid_join::numeric / bot.total_bottles::numeric, 2)
  END AS pct_bottles_valid_join_to_mlcc_items
FROM
  mi
  CROSS JOIN bot
  CROSS JOIN join_ok j
  CROSS JOIN orphan_code o;

-- 2) Bucket-style row counts (DB-side “mapping readiness”, not mappingconfidence enum)
SELECT
  x.bucket,
  x.cnt
FROM (
  SELECT
    'bottle_linked_mlcc_item_id'::text AS bucket,
    COUNT(*)::bigint AS cnt
  FROM public.bottles
  WHERE mlcc_item_id IS NOT NULL

  UNION ALL
  SELECT
    'bottle_code_only_no_fk'::text,
    COUNT(*)::bigint
  FROM public.bottles
  WHERE mlcc_item_id IS NULL
    AND NULLIF(TRIM(mlcc_code), '') IS NOT NULL

  UNION ALL
  SELECT
    'bottle_no_code_and_no_fk'::text,
    COUNT(*)::bigint
  FROM public.bottles
  WHERE mlcc_item_id IS NULL
    AND NULLIF(TRIM(mlcc_code), '') IS NULL

  UNION ALL
  SELECT
    'mlcc_items_catalog_rows'::text,
    (SELECT COUNT(*)::bigint FROM public.mlcc_items)
) x
ORDER BY x.bucket;
