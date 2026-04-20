-- UPC lookup audit trail and fast mlcc_items.upc lookups for price-book scanner flow.

CREATE TABLE public.upc_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc TEXT NOT NULL,
  matched_mlcc_code TEXT,
  matched_product_name TEXT,
  source TEXT NOT NULL,
  raw_api_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX upc_lookups_upc_idx ON public.upc_lookups (upc);

CREATE INDEX upc_lookups_created_at_idx ON public.upc_lookups (created_at DESC);

ALTER TABLE public.upc_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upc_lookups_select_authenticated"
  ON public.upc_lookups FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS mlcc_items_upc_idx ON public.mlcc_items (upc) WHERE upc IS NOT NULL;

COMMENT ON TABLE public.upc_lookups IS
  'Audit log of price-book UPC lookups (cache hit, UPCitemdb, Open Food Facts, misses) for analytics and debugging.';
