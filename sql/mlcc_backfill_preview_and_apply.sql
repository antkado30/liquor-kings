-- =============================================================================
-- MLCC FK backfill: bottles.mlcc_item_id from mlcc_items (exact code match)
-- =============================================================================
--
-- SAFETY READ ME FIRST
-- ---------------------
-- 1. Run the PREVIEW section ONLY first. Inspect counts and optional detail.
-- 2. APPLY updates ONLY rows where there is exactly ONE mlcc_items row with the
--    same code as bottles.mlcc_code (unique match). Ambiguous and no_match rows
--    are never updated.
-- 3. APPLY does NOT overwrite existing bottles.mlcc_item_id (only NULL targets).
-- 4. This file is DML-only when APPLY runs; it does NOT change schema. There is
--    no migration here—review in staging, then run APPLY only when satisfied.
--
-- Join rule (exact):
--   bottles.mlcc_code = mlcc_items.code
--
-- Candidate bottles (both PREVIEW and APPLY use the same logic):
--   - bottles.mlcc_item_id IS NULL
--   - bottles.mlcc_code IS NOT NULL
--   - TRIM(bottles.mlcc_code) <> ''   (exclude blank / whitespace-only codes)
--
-- =============================================================================

-- PREVIEW_START
-- -----------------------------------------------------------------------------
-- PREVIEW: classify candidate bottles (run this first; read-only SELECTs)
-- -----------------------------------------------------------------------------

-- Summary: one row per bucket with counts.
-- Buckets:
--   can_backfill  — exactly one mlcc_items row matches this bottle's code
--   ambiguous     — more than one mlcc_items row shares that code
--   no_match      — no mlcc_items row has that code
WITH candidates AS (
  SELECT
    b.id AS bottle_id,
    b.mlcc_code AS bottle_mlcc_code,
    b.mlcc_item_id
  FROM public.bottles b
  WHERE b.mlcc_item_id IS NULL
    AND b.mlcc_code IS NOT NULL
    AND TRIM(b.mlcc_code) <> ''
),
match_counts AS (
  SELECT
    c.bottle_id,
    c.bottle_mlcc_code,
    COUNT(mi.id) AS match_count
  FROM candidates c
  LEFT JOIN public.mlcc_items mi
    ON mi.code = c.bottle_mlcc_code
  GROUP BY c.bottle_id, c.bottle_mlcc_code
),
classified AS (
  SELECT
    bottle_id,
    bottle_mlcc_code,
    match_count,
    CASE
      WHEN match_count = 1 THEN 'can_backfill'
      WHEN match_count > 1 THEN 'ambiguous'
      ELSE 'no_match'
    END AS bucket
  FROM match_counts
)
SELECT
  bucket,
  COUNT(*) AS bottle_count
FROM classified
GROUP BY bucket
ORDER BY
  CASE bucket
    WHEN 'can_backfill' THEN 1
    WHEN 'ambiguous' THEN 2
    WHEN 'no_match' THEN 3
    ELSE 4
  END;

-- -----------------------------------------------------------------------------
-- OPTIONAL PREVIEW DETAIL (second query): ambiguous + no_match rows only.
-- Run after the summary when you need bottle_id / code / match_count for triage.
-- -----------------------------------------------------------------------------
WITH candidates AS (
  SELECT
    b.id AS bottle_id,
    b.mlcc_code AS bottle_mlcc_code
  FROM public.bottles b
  WHERE b.mlcc_item_id IS NULL
    AND b.mlcc_code IS NOT NULL
    AND TRIM(b.mlcc_code) <> ''
),
match_counts AS (
  SELECT
    c.bottle_id,
    c.bottle_mlcc_code,
    COUNT(mi.id) AS match_count
  FROM candidates c
  LEFT JOIN public.mlcc_items mi
    ON mi.code = c.bottle_mlcc_code
  GROUP BY c.bottle_id, c.bottle_mlcc_code
)
SELECT
  bottle_id,
  bottle_mlcc_code,
  match_count,
  CASE
    WHEN match_count > 1 THEN 'ambiguous'
    WHEN match_count = 0 THEN 'no_match'
    ELSE 'can_backfill'
  END AS bucket
FROM match_counts
WHERE match_count <> 1
ORDER BY match_count DESC, bottle_mlcc_code, bottle_id;

-- PREVIEW_END

-- APPLY_START
-- -----------------------------------------------------------------------------
-- APPLY: backfill mlcc_item_id ONLY for unique code matches (recomputes matches)
-- -----------------------------------------------------------------------------
--
-- Recomputes the unique-match set here (does not read preview temp tables).
-- Conditions for each UPDATE target:
--   - bottles.mlcc_item_id IS NULL
--   - bottles.mlcc_code IS NOT NULL AND TRIM(bottles.mlcc_code) <> ''
--   - EXISTS exactly one mlcc_items row with mlcc_items.code = bottles.mlcc_code
--
-- Rows with 0 or 2+ catalog matches are not touched.
--
-- Implementation: subquery groups by bottle (id + code). HAVING COUNT(mi.id) = 1
-- guarantees exactly one catalog row joined for that code; MIN(mi.id) is that row’s id.

UPDATE public.bottles b
SET mlcc_item_id = src.mlcc_item_id
FROM (
  SELECT
    b_inner.id AS bottle_id,
    MIN(mi.id) AS mlcc_item_id
  FROM public.bottles b_inner
  INNER JOIN public.mlcc_items mi
    ON mi.code = b_inner.mlcc_code
  WHERE b_inner.mlcc_item_id IS NULL
    AND b_inner.mlcc_code IS NOT NULL
    AND TRIM(b_inner.mlcc_code) <> ''
  GROUP BY b_inner.id, b_inner.mlcc_code
  HAVING COUNT(mi.id) = 1
) AS src
WHERE b.id = src.bottle_id
  AND b.mlcc_item_id IS NULL;

-- psql / clients typically print: UPDATE <n>  (n = number of rows updated).
-- Ambiguous codes (2+ mlcc_items rows) and no_match codes (0 rows) produce n = 0 for those bottles.

-- APPLY_END

-- Post-apply check (optional): re-run the PREVIEW summary SELECT; can_backfill
-- should drop to 0 if all unique matches were applied, unless new candidates appeared.
