-- Durable workflow state for internal Pilot Ops per store.
-- Keeps operator workflow metadata out of process memory.

CREATE TABLE IF NOT EXISTS public.pilot_ops_workflow_states (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  pilot_ops_status text NOT NULL DEFAULT 'unreviewed' CHECK (
    pilot_ops_status IN ('unreviewed', 'watching', 'escalated', 'resolved')
  ),
  last_reviewed_at timestamptz,
  last_reviewed_by text,
  operator_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_ops_workflow_states_status
  ON public.pilot_ops_workflow_states USING btree (pilot_ops_status);

ALTER TABLE public.pilot_ops_workflow_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_ops_workflow_states_select_by_store_membership ON public.pilot_ops_workflow_states;
DROP POLICY IF EXISTS pilot_ops_workflow_states_insert_by_store_membership ON public.pilot_ops_workflow_states;
DROP POLICY IF EXISTS pilot_ops_workflow_states_update_by_store_membership ON public.pilot_ops_workflow_states;

CREATE POLICY pilot_ops_workflow_states_select_by_store_membership
ON public.pilot_ops_workflow_states
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_states.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_workflow_states_insert_by_store_membership
ON public.pilot_ops_workflow_states
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_states.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_workflow_states_update_by_store_membership
ON public.pilot_ops_workflow_states
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_states.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_states.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);
