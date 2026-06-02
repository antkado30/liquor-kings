-- MILO Order Confirmations
--
-- Persistent record of every order Liquor Kings successfully submitted via
-- the RPA pipeline (Stage 5). One row per ADA per execution run because
-- MLCC issues a separate confirmation number for each distributor on a
-- multi-ADA order (NWS Michigan and General Wine each get their own #).
--
-- Source of truth: services/api/src/rpa/stages/checkout.js — the
-- `historyOrders` array parsed from /milo/account/orders. Currently this
-- data only lives in execution_runs.evidence (jsonb), which is opaque to
-- everything except eyeball debugging. This table makes order history
-- queryable: "what did I order last Thursday?", "show me Tito's by week",
-- "what's my running spend with NWS Michigan?"
--
-- Why a new table instead of joining off evidence:
--   1. Evidence is unstructured jsonb and changes shape as we evolve
--      the RPA. A first-class table with columns is the right interface
--      for the Orders page + assistant tools.
--   2. We want to backfill from past evidence — a clean target table
--      makes the backfill safe to re-run.
--   3. Future: surface in the AI assistant's query_order_history tool
--      (currently queries execution_runs which is too coarse).
--
-- Task #41 (Liquor Kings V1 roadmap). Triggered by Tony's 2026-05-28 first
-- real Colony order (NWS #30765405 + Gen #5654920, $5,462.80 net) — the
-- numbers exist but are buried in a jsonb evidence dump.

CREATE TABLE IF NOT EXISTS public.milo_order_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which store + which execution run. execution_run_id is nullable so we
  -- can backfill rows from historic data where the source run no longer
  -- exists (or to record manual entries later).
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  execution_run_id uuid REFERENCES public.execution_runs(id) ON DELETE SET NULL,

  -- ADA identification. Both fields nullable because some MILO responses
  -- can't be confidently mapped to an ADA (e.g. an unrecognized distributor
  -- name) — we still want to record the confirmation rather than drop it.
  ada_number text,
  ada_name text,

  -- The confirmation # is the load-bearing field — it's what the operator
  -- references when talking to MLCC support, what gets printed on the
  -- receipt, what survives in physical records. Required.
  confirmation_number text NOT NULL,

  -- MILO's internal order_number — separate identifier MLCC uses
  -- internally. Useful for cross-referencing in MILO's UI later.
  order_number text,

  -- Timing
  placed_at timestamptz,  -- when MLCC recorded the order (from history feed)
  delivery_date date,     -- promised delivery date
  submitted_at timestamptz NOT NULL DEFAULT now(),  -- when WE recorded it

  -- Money. Numerics so we never lose cents to floating-point math.
  net_total numeric(12,2),
  gross_total numeric(12,2),
  liquor_tax numeric(12,2),
  discount numeric(12,2),

  -- Full line-item audit trail. Array of
  -- { liquorCode, productName, quantity, unitPrice, lineTotal, bottleSizeMl }.
  -- Same shape as the historyOrders[].lineItems we parse from MILO.
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  line_item_count integer NOT NULL DEFAULT 0,

  -- Raw fields we save for debugging / future re-parsing without rerunning
  -- the RPA. distributor_raw is MILO's exact string ("NWS Michigan, Inc.")
  -- because the ada_name normalization can lose info.
  distributor_raw text,
  status_at_placement text,  -- e.g. "Submitted", "Processing"

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hot path: list a store's most recent orders.
CREATE INDEX IF NOT EXISTS idx_milo_confirmations_store_placed
  ON public.milo_order_confirmations (store_id, placed_at DESC NULLS LAST);

-- Join helper for execution_runs ↔ confirmations.
CREATE INDEX IF NOT EXISTS idx_milo_confirmations_execution_run
  ON public.milo_order_confirmations (execution_run_id)
  WHERE execution_run_id IS NOT NULL;

-- Confirmation # lookup (operator search by "what was #30765405?").
CREATE INDEX IF NOT EXISTS idx_milo_confirmations_confirmation_number
  ON public.milo_order_confirmations (confirmation_number);

-- Dedup guard: if the worker re-finalizes a run for some reason, the
-- second insert noops via the unique key (one (run, ada) pair = one row).
-- Backfill / manual entries (NULL execution_run_id) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_milo_confirmations_run_ada_unique
  ON public.milo_order_confirmations (execution_run_id, ada_number)
  WHERE execution_run_id IS NOT NULL AND ada_number IS NOT NULL;

-- updated_at trigger using the existing project pattern.
CREATE OR REPLACE FUNCTION public.touch_milo_order_confirmations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milo_confirmations_updated_at ON public.milo_order_confirmations;
CREATE TRIGGER trg_milo_confirmations_updated_at
  BEFORE UPDATE ON public.milo_order_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.touch_milo_order_confirmations_updated_at();

-- RLS — only members of the store can read their own confirmations. The
-- worker writes via the service-role key which bypasses RLS, so policy
-- design just needs to cover the operator-side read path.
ALTER TABLE public.milo_order_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_users_can_read_milo_confirmations"
  ON public.milo_order_confirmations;
CREATE POLICY "store_users_can_read_milo_confirmations"
  ON public.milo_order_confirmations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE su.store_id = milo_order_confirmations.store_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
    )
  );

-- Comments for self-documentation (these show up in supabase studio).
COMMENT ON TABLE public.milo_order_confirmations IS
  'One row per (execution_run, ADA) for every successful Stage 5 RPA order. Source: services/api/src/rpa/stages/checkout.js historyOrders.';
COMMENT ON COLUMN public.milo_order_confirmations.confirmation_number IS
  'MLCC confirmation # shown on MILO order history. Load-bearing — what the operator quotes to MLCC support.';
COMMENT ON COLUMN public.milo_order_confirmations.line_items IS
  'Array of { liquorCode, productName, quantity, unitPrice, lineTotal, bottleSizeMl } parsed from MILO order detail.';
