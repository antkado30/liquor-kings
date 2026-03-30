-- gen_random_uuid(): ensure pgcrypto exists (safe if already present)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL,
  store_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload_snapshot jsonb NOT NULL,
  worker_notes text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS cart_id uuid;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'queued';
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS payload_snapshot jsonb;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS worker_notes text;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.execution_runs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_runs_pkey'
      AND conrelid = 'public.execution_runs'::regclass
  ) THEN
    ALTER TABLE public.execution_runs
      ADD CONSTRAINT execution_runs_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_runs_cart_id_fkey'
      AND conrelid = 'public.execution_runs'::regclass
  ) THEN
    ALTER TABLE public.execution_runs
      ADD CONSTRAINT execution_runs_cart_id_fkey
      FOREIGN KEY (cart_id) REFERENCES public.carts (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_runs_store_id_fkey'
      AND conrelid = 'public.execution_runs'::regclass
  ) THEN
    ALTER TABLE public.execution_runs
      ADD CONSTRAINT execution_runs_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_runs_status_check'
      AND conrelid = 'public.execution_runs'::regclass
  ) THEN
    ALTER TABLE public.execution_runs
      ADD CONSTRAINT execution_runs_status_check CHECK (
        status = ANY (
          ARRAY[
            'queued'::text,
            'running'::text,
            'succeeded'::text,
            'failed'::text,
            'canceled'::text
          ]
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_execution_runs_cart_id
  ON public.execution_runs USING btree (cart_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_store_id
  ON public.execution_runs USING btree (store_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_created_at
  ON public.execution_runs USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS execution_runs_one_active_per_cart_idx
  ON public.execution_runs (cart_id)
  WHERE status = ANY (ARRAY['queued'::text, 'running'::text]);

ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_runs_select_authenticated ON public.execution_runs;
DROP POLICY IF EXISTS execution_runs_insert_authenticated ON public.execution_runs;
DROP POLICY IF EXISTS execution_runs_update_authenticated ON public.execution_runs;

CREATE POLICY execution_runs_select_authenticated
  ON public.execution_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY execution_runs_insert_authenticated
  ON public.execution_runs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY execution_runs_update_authenticated
  ON public.execution_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.execution_runs TO anon;
GRANT ALL ON TABLE public.execution_runs TO authenticated;
GRANT ALL ON TABLE public.execution_runs TO service_role;
