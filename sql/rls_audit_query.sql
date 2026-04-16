-- Liquor Kings — read-only RLS audit (SELECT only).
-- Lists every ordinary table in schema `public` with row-level security flags
-- and rolled-up policy metadata from pg_policies.
--
-- Run (read-only connection recommended):
--   psql "$STAGING_DATABASE_URL" -f sql/rls_audit_query.sql
-- CSV:
--   psql "$STAGING_DATABASE_URL" -f sql/rls_audit_query.sql --csv > rls_audit_output.csv

WITH tbl AS (
  SELECT
    c.oid,
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_force
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
),
pol AS (
  SELECT
    tablename,
    COUNT(*)::bigint AS policy_count,
    string_agg(
      quote_ident(policyname) || ' [' || cmd || ']',
      ', '
      ORDER BY policyname
    ) AS policy_summary
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
)
SELECT
  t.schema_name,
  t.table_name,
  t.rls_enabled,
  t.rls_force AS rls_forced,
  COALESCE(p.policy_count, 0::bigint) AS policy_count,
  COALESCE(p.policy_summary, '(no policies in pg_policies)') AS policy_summary,
  CASE
    WHEN NOT t.rls_enabled THEN 'RED'
    WHEN t.rls_enabled AND COALESCE(p.policy_count, 0::bigint) = 0 THEN 'ORANGE'
    ELSE 'GREEN'
  END AS risk_band
FROM tbl t
LEFT JOIN pol p ON p.tablename = t.table_name
ORDER BY t.table_name;
