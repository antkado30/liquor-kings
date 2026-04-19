-- Replace single-column uniqueness on mlcc_items.code with composite (code, ada_number).

DROP INDEX IF EXISTS public.mlcc_items_code_unique;

ALTER TABLE public.mlcc_items DROP CONSTRAINT IF EXISTS mlcc_items_code_unique;

ALTER TABLE public.mlcc_items
  ADD CONSTRAINT mlcc_items_code_ada_unique UNIQUE (code, ada_number);

COMMENT ON CONSTRAINT mlcc_items_code_ada_unique ON public.mlcc_items IS
  'Same MLCC product code can be carried by multiple ADAs at different prices. Unique per code+ADA combination.';
