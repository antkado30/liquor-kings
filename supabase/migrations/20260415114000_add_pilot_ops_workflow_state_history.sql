-- Audit trail for Pilot Ops workflow-state changes.
-- Internal-only: captures previous/new values per change.

CREATE TABLE IF NOT EXISTS public.pilot_ops_workflow_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL,
  previous_pilot_ops_status text,
  new_pilot_ops_status text NOT NULL CHECK (
    new_pilot_ops_status IN ('unreviewed', 'watching', 'escalated', 'resolved')
  ),
  previous_operator_note text,
  new_operator_note text
);

CREATE INDEX IF NOT EXISTS idx_pilot_ops_workflow_state_history_store_changed_at
  ON public.pilot_ops_workflow_state_history USING btree (store_id, changed_at DESC);

ALTER TABLE public.pilot_ops_workflow_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_ops_workflow_state_history_select_by_store_membership ON public.pilot_ops_workflow_state_history;
DROP POLICY IF EXISTS pilot_ops_workflow_state_history_insert_by_store_membership ON public.pilot_ops_workflow_state_history;

CREATE POLICY pilot_ops_workflow_state_history_select_by_store_membership
ON public.pilot_ops_workflow_state_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_state_history.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_workflow_state_history_insert_by_store_membership
ON public.pilot_ops_workflow_state_history
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_workflow_state_history.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);
