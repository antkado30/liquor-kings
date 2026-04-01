-- Real per-attempt history for execution runs (initial try, automatic retries, operator retries).
-- attempt_number is monotonic per run (max+1 on each claim), independent of retry_count.

CREATE TABLE IF NOT EXISTS public.execution_run_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.execution_runs (id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'canceled')),
  failure_type text,
  failure_message text,
  progress_stage text,
  progress_message text,
  evidence_metadata jsonb,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_run_attempts_run_attempt_unique UNIQUE (run_id, attempt_number),
  CONSTRAINT execution_run_attempts_failure_type_check CHECK (
    failure_type IS NULL OR failure_type = ANY (
      ARRAY[
        'CODE_MISMATCH'::text,
        'OUT_OF_STOCK'::text,
        'QUANTITY_RULE_VIOLATION'::text,
        'MLCC_UI_CHANGE'::text,
        'NETWORK_ERROR'::text,
        'UNKNOWN'::text
      ]
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_execution_run_attempts_run_attempt
  ON public.execution_run_attempts USING btree (run_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_execution_run_attempts_store_run
  ON public.execution_run_attempts USING btree (store_id, run_id);

ALTER TABLE public.execution_run_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_run_attempts_select_by_store_membership ON public.execution_run_attempts;
DROP POLICY IF EXISTS execution_run_attempts_insert_by_store_membership ON public.execution_run_attempts;
DROP POLICY IF EXISTS execution_run_attempts_update_by_store_membership ON public.execution_run_attempts;

CREATE POLICY execution_run_attempts_select_by_store_membership
  ON public.execution_run_attempts FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.store_id = execution_run_attempts.store_id
    )
  );

CREATE POLICY execution_run_attempts_insert_by_store_membership
  ON public.execution_run_attempts FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.store_id = execution_run_attempts.store_id
    )
  );

CREATE POLICY execution_run_attempts_update_by_store_membership
  ON public.execution_run_attempts FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.store_id = execution_run_attempts.store_id
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE su.user_id = auth.uid()
        AND su.store_id = execution_run_attempts.store_id
    )
  );

GRANT ALL ON TABLE public.execution_run_attempts TO anon;
GRANT ALL ON TABLE public.execution_run_attempts TO authenticated;
GRANT ALL ON TABLE public.execution_run_attempts TO service_role;
