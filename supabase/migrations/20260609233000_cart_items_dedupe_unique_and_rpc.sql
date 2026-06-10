-- Kill the cart_items duplicate-row bug at the source.
--
-- Problem: POST /cart/:store/items did select-then-insert/update with no DB
-- constraint, so two fast "add" taps could both see "no existing row" and
-- each insert — leaving duplicate (cart_id, bottle_id) rows that later 500'd
-- a .maybeSingle(). (Flagged 2026-06-09.)
--
-- Fix, in order:
--   1. Merge any existing duplicates (sum quantity into the earliest row).
--   2. Add a UNIQUE (cart_id, bottle_id) constraint so dups can't recur.
--   3. Add an atomic add_cart_item() RPC (INSERT ... ON CONFLICT DO UPDATE)
--      so the API does insert-or-increment in ONE race-safe statement.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the API code that calls
-- the add_cart_item RPC.

-- 1. Merge duplicate quantities into the earliest row per (cart_id, bottle_id).
UPDATE public.cart_items keep
SET quantity = agg.total_qty,
    updated_at = now()
FROM (
  SELECT cart_id,
         bottle_id,
         sum(quantity) AS total_qty,
         (array_agg(id ORDER BY created_at ASC, id ASC))[1] AS keep_id
  FROM public.cart_items
  GROUP BY cart_id, bottle_id
  HAVING count(*) > 1
) agg
WHERE keep.id = agg.keep_id;

-- 2. Delete the now-merged duplicate rows (everything but the kept earliest row).
DELETE FROM public.cart_items ci
USING (
  SELECT cart_id,
         bottle_id,
         (array_agg(id ORDER BY created_at ASC, id ASC))[1] AS keep_id
  FROM public.cart_items
  GROUP BY cart_id, bottle_id
  HAVING count(*) > 1
) agg
WHERE ci.cart_id = agg.cart_id
  AND ci.bottle_id = agg.bottle_id
  AND ci.id <> agg.keep_id;

-- 3. Enforce uniqueness (guarded so re-running is safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_cart_bottle_unique'
  ) THEN
    ALTER TABLE public.cart_items
      ADD CONSTRAINT cart_items_cart_bottle_unique UNIQUE (cart_id, bottle_id);
  END IF;
END$$;

-- 4. Atomic insert-or-increment. Race-safe: ON CONFLICT folds a concurrent
--    second add into a single +quantity update instead of a dup or a 500.
CREATE OR REPLACE FUNCTION public.add_cart_item(
  p_cart_id uuid,
  p_bottle_id uuid,
  p_mlcc_item_id uuid,
  p_store_id uuid,
  p_qty integer
) RETURNS public.cart_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.cart_items;
BEGIN
  INSERT INTO public.cart_items (cart_id, bottle_id, mlcc_item_id, store_id, quantity)
  VALUES (p_cart_id, p_bottle_id, p_mlcc_item_id, p_store_id, GREATEST(coalesce(p_qty, 1), 1))
  ON CONFLICT (cart_id, bottle_id)
  DO UPDATE SET
    quantity = public.cart_items.quantity + EXCLUDED.quantity,
    mlcc_item_id = EXCLUDED.mlcc_item_id,
    store_id = EXCLUDED.store_id,
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;
