ALTER TABLE IF EXISTS public.execution_runs
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_execution_runs_evidence_exists
  ON public.execution_runs USING btree (id)
  WHERE jsonb_array_length(evidence) > 0;
