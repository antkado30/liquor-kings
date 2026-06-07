-- Order templates (task #72, 2026-06-04 afternoon).
--
-- Per-store reusable cart snapshots. Dad's biggest weekly pain: he
-- builds his Thursday MLCC order from scratch every week even though
-- it's 80% the same staples — Tito's 750ml × 12, Crown × 6, Captain
-- × 6, Hennessy VS × 3, etc. Templates let him save the "weekly
-- staples" cart once, then load-and-edit each subsequent week.
--
-- Schema is intentionally minimal: name + items array + audit. We can
-- add scheduling, push notifications, or auto-submit later without
-- breaking compat.

CREATE TABLE IF NOT EXISTS public.order_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- items: [{ mlcc_code: "2980", quantity: 12, name?: "TITO'S...", bottle_size_ml?: 750 }]
  -- Stored as JSON so adding fields (price snapshots, ADA hints) doesn't
  -- require schema changes.
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Last time the template was loaded into a cart. Lets the UI show
  -- "last used 3 days ago" hints + lets the scheduler skip a template
  -- if user manually loaded it today already.
  last_loaded_at timestamptz,
  -- Soft-delete: hide template without losing audit trail. Templates
  -- are valuable history we don't want to truly delete.
  is_archived boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_order_templates_store
  ON public.order_templates (store_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_order_templates_last_loaded
  ON public.order_templates (store_id, last_loaded_at DESC NULLS LAST);

ALTER TABLE public.order_templates ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (worker / admin scripts).
CREATE POLICY "service role full access"
  ON public.order_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read/write templates for their own store(s).
CREATE POLICY "users read own store templates"
  ON public.order_templates
  FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT su.store_id
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
    )
  );

CREATE POLICY "users insert own store templates"
  ON public.order_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    store_id IN (
      SELECT su.store_id
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
    )
  );

CREATE POLICY "users update own store templates"
  ON public.order_templates
  FOR UPDATE
  TO authenticated
  USING (
    store_id IN (
      SELECT su.store_id
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
    )
  );

COMMENT ON TABLE public.order_templates IS
  'Per-store reusable cart snapshots. Used to save weekly recurring orders so dad doesnt rebuild from scratch every Thursday. Loading a template adds its items to the active cart; user then adjusts before validating and submitting.';
