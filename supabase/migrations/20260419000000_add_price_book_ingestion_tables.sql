-- Price book ingestion: extended mlcc_items fields and run tracking for MLCC Excel imports.

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS upc text;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS proof numeric;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS bottle_size_ml integer;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS bottle_size_label text;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS case_size integer;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS base_price numeric(10, 2);

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS licensee_price numeric(10, 2);

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS min_shelf_price numeric(10, 2);

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS ada_number text;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS ada_name text;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS brand_family text;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS last_price_book_date date;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS price_changed_at timestamptz;

ALTER TABLE public.mlcc_items
  ADD COLUMN IF NOT EXISTS is_new_item boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.mlcc_price_book_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_date date NOT NULL,
  source_url text,
  total_items integer,
  new_items integer,
  updated_items integer,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mlcc_price_book_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mlcc_price_book_runs_select_authenticated ON public.mlcc_price_book_runs;

CREATE POLICY mlcc_price_book_runs_select_authenticated ON public.mlcc_price_book_runs FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.mlcc_price_book_runs IS
  'Audit trail for automated or manual MLCC spirits price book Excel downloads and ingestion runs (counts, status, source URL).';
