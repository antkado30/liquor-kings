-- Migration: enable RLS on mlcc_items and add access policies
-- mlcc_items is a public product catalog. Read access is granted to all
-- authenticated users. Write access (INSERT, UPDATE, DELETE) is restricted
-- to service role only — no application user may modify the product catalog.

ALTER TABLE public.mlcc_items ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read the product catalog
CREATE POLICY "mlcc_items_select_authenticated"
  ON public.mlcc_items
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT policy for authenticated users — service role only
-- No UPDATE policy for authenticated users — service role only  
-- No DELETE policy for authenticated users — service role only

COMMENT ON TABLE public.mlcc_items IS
  'MLCC product catalog. RLS enabled. Read: authenticated users. Write: service role only.';
