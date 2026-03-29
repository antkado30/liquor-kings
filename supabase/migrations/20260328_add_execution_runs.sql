-- gen_random_uuid(): ensure pgcrypto exists (safe if already present)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  payload_snapshot jsonb NOT NULL,
  worker_notes text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_runs_status_check CHECK (
    status = ANY (
      ARRAY[
        'queued'::text,
        'running'::text,
        'succeeded'::text,
        'failed'::text,
        'canceled'::text
      ]
    )
  )
);

CREATE INDEX idx_execution_runs_cart_id ON public.execution_runs USING btree (cart_id);

CREATE INDEX idx_execution_runs_store_id ON public.execution_runs USING btree (store_id);

CREATE INDEX idx_execution_runs_created_at ON public.execution_runs USING btree (created_at DESC);

CREATE UNIQUE INDEX execution_runs_one_active_per_cart_idx ON public.execution_runs (cart_id)
WHERE
  status = ANY (ARRAY['queued'::text, 'running'::text]);

ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY execution_runs_select_authenticated ON public.execution_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY execution_runs_insert_authenticated ON public.execution_runs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY execution_runs_update_authenticated ON public.execution_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.execution_runs TO anon;

GRANT ALL ON TABLE public.execution_runs TO authenticated;

GRANT ALL ON TABLE public.execution_runs TO service_role;
