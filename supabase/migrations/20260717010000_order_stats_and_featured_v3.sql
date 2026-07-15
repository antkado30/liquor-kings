-- Order-history relevance: stats tables + featured_sort v3 (2026-07-15,
-- Tony's decision locked on order-day eve; APPLY FRIDAY 7/17 — nothing
-- moves in prod before the 7/16 order).
--
-- Tony: "why is there the pickle shots on top? I want the most relevant
-- bottles at the top." featured v2 ranked photos → most-SCANNED → name;
-- scans measure register curiosity (price checks, minis), not what a
-- store owner buying stock cares about. DECIDED: relevance = what stores
-- actually ORDER. Ordering is the truth signal in an ordering tool — and
-- as more stores place orders, the catalog's default order becomes
-- "what Michigan actually buys" (the acquisition-story dataset, growing
-- for free).
--
-- Pieces:
--   1. mlcc_items.ordered_count — GLOBAL per-code order frequency
--      (distinct submitted orders containing the code). Feeds the shared
--      featured_sort generated column.
--   2. store_item_order_stats — PER-STORE rollup. Powers the "Ordered
--      before" catalog filter today and per-store ranking later.
--   3. featured_sort v3 — photos first → most-ORDERED first →
--      most-scanned first → name. Same in-place drop/re-add pattern as
--      v2 (20260611001000): column name unchanged, deployed API needs no
--      code change. NOTE: flat-browse cursors embed featured_sort values;
--      in-flight cursors die at apply time — the client just restarts
--      its scroll on next fetch (cheap, one-time).
--
-- Data flows in via scripts/backfill-order-stats.mjs (history) and the
-- confirmation-persist hook (each new order). Both fail-open: stats are
-- derived truth and NEVER allowed to fail an order write.

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS ordered_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.mlcc_items.ordered_count IS
  'Distinct submitted MILO orders (all stores) whose cart contained this code. Derived: backfill-order-stats.mjs + confirmation hook. Feeds featured_sort v3.';

CREATE TABLE IF NOT EXISTS public.store_item_order_stats (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  order_count integer NOT NULL DEFAULT 0,
  total_quantity integer NOT NULL DEFAULT 0,
  last_ordered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, code)
);

COMMENT ON TABLE public.store_item_order_stats IS
  'Per-store order-history rollup by MLCC code. Powers the "Ordered before" catalog filter; later, per-store relevance ranking. Derived data — rebuildable any time from execution_runs snapshots via backfill-order-stats.mjs.';

CREATE INDEX IF NOT EXISTS store_item_order_stats_store_recency_idx
  ON public.store_item_order_stats (store_id, last_ordered_at DESC);

-- Zero-trust default: RLS on, NO policies — only the service role (the
-- API) touches this. Client access goes through the API like everything.
ALTER TABLE public.store_item_order_stats ENABLE ROW LEVEL SECURITY;

-- featured_sort v3 (in-place regenerate, v2's proven pattern).
ALTER TABLE public.mlcc_items DROP COLUMN IF EXISTS featured_sort;

ALTER TABLE public.mlcc_items
  ADD COLUMN featured_sort text GENERATED ALWAYS AS (
    (CASE WHEN image_url IS NULL THEN '1~' ELSE '0~' END) ||
    lpad((1000000 - least(coalesce(ordered_count, 0), 999999))::text, 7, '0') ||
    '~' ||
    lpad((1000000 - least(coalesce(scan_count, 0), 999999))::text, 7, '0') ||
    '~' ||
    lower(coalesce(name, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS mlcc_items_featured_sort_idx
  ON public.mlcc_items USING btree (featured_sort);

COMMENT ON COLUMN public.mlcc_items.featured_sort IS
  'Generated sort key v3: image-presence rank → inverted ordered_count (most-ordered first) → inverted scan_count → lowercase name. Drives the catalog''s default "Featured" ordering; self-reranks as orders and scans accumulate.';

-- Atomic per-order stats bump (called fire-and-forget by the API after a
-- confirmation persists; PostgREST has no relative UPDATE, and counter
-- math scattered across JS is how counters drift). One call, one
-- transaction: per-store rollup upsert + global ordered_count increments.
-- p_lines: jsonb array of {"code": text, "qty": number}. Idempotency is
-- deliberately NOT enforced here — stats are DERIVED data; a rare
-- double-bump from a worker retry self-heals on the next full rebuild
-- (backfill-order-stats.mjs recomputes from scratch).
CREATE OR REPLACE FUNCTION public.bump_order_stats(
  p_store_id uuid,
  p_placed_at timestamptz,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line record;
BEGIN
  FOR line IN
    SELECT
      btrim(x.value ->> 'code') AS code,
      greatest(coalesce((x.value ->> 'qty')::integer, 0), 0) AS qty
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) AS x(value)
  LOOP
    CONTINUE WHEN line.code IS NULL OR line.code = '';

    INSERT INTO public.store_item_order_stats AS s
      (store_id, code, order_count, total_quantity, last_ordered_at, updated_at)
    VALUES
      (p_store_id, line.code, 1, line.qty, coalesce(p_placed_at, now()), now())
    ON CONFLICT (store_id, code) DO UPDATE SET
      order_count     = s.order_count + 1,
      total_quantity  = s.total_quantity + excluded.total_quantity,
      last_ordered_at = greatest(coalesce(s.last_ordered_at, excluded.last_ordered_at), excluded.last_ordered_at),
      updated_at      = now();

    UPDATE public.mlcc_items
    SET ordered_count = ordered_count + 1
    WHERE code = line.code;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.bump_order_stats(uuid, timestamptz, jsonb) IS
  'Atomic order-stats increment for one submitted order: per-store rollup + global mlcc_items.ordered_count. Derived data — rebuildable via backfill-order-stats.mjs.';
