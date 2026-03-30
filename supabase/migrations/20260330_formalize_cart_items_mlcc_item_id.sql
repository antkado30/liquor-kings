-- Formalize cart_items.mlcc_item_id as durable schema.
-- Intentionally nullable for transitional compatibility with legacy rows and
-- rolling deployments. New writes should set this to the authoritative item id.

ALTER TABLE IF EXISTS public.cart_items
  ADD COLUMN IF NOT EXISTS mlcc_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cart_items_mlcc_item_id_fkey'
  ) THEN
    ALTER TABLE public.cart_items
      ADD CONSTRAINT cart_items_mlcc_item_id_fkey
      FOREIGN KEY (mlcc_item_id)
      REFERENCES public.mlcc_items (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cart_items_mlcc_item_id
  ON public.cart_items USING btree (mlcc_item_id);

COMMENT ON COLUMN public.cart_items.mlcc_item_id IS
  'Authoritative resolved MLCC item id for cart identity safety; nullable during migration rollout.';
