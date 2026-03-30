CREATE TABLE IF NOT EXISTS public.execution_run_operator_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.execution_runs (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  action text NOT NULL,
  reason text,
  note text,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_run_operator_actions_action_check CHECK (
    action = ANY (
      ARRAY[
        'acknowledge'::text,
        'mark_for_manual_review'::text,
        'retry_now'::text,
        'cancel'::text,
        'resolve_without_retry'::text
      ]
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_execution_run_operator_actions_run_created
  ON public.execution_run_operator_actions USING btree (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_run_operator_actions_store_created
  ON public.execution_run_operator_actions USING btree (store_id, created_at DESC);

ALTER TABLE public.execution_run_operator_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_run_operator_actions_select_by_store_membership ON public.execution_run_operator_actions;
DROP POLICY IF EXISTS execution_run_operator_actions_insert_by_store_membership ON public.execution_run_operator_actions;

CREATE POLICY execution_run_operator_actions_select_by_store_membership
  ON public.execution_run_operator_actions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE
        su.store_id = execution_run_operator_actions.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY execution_run_operator_actions_insert_by_store_membership
  ON public.execution_run_operator_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.store_users su
      WHERE
        su.store_id = execution_run_operator_actions.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

GRANT ALL ON TABLE public.execution_run_operator_actions TO anon;
GRANT ALL ON TABLE public.execution_run_operator_actions TO authenticated;
GRANT ALL ON TABLE public.execution_run_operator_actions TO service_role;
