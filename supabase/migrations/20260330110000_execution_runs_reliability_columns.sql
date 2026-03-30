ALTER TABLE IF EXISTS public.execution_runs
  ADD COLUMN IF NOT EXISTS queued_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS failure_type text,
  ADD COLUMN IF NOT EXISTS failure_details jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_runs_failure_type_check'
      AND conrelid = 'public.execution_runs'::regclass
  ) THEN
    ALTER TABLE public.execution_runs
      ADD CONSTRAINT execution_runs_failure_type_check
      CHECK (
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
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_execution_runs_status_retry
  ON public.execution_runs USING btree (status, retry_count, created_at DESC);
