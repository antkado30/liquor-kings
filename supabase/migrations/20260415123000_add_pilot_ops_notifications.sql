-- Internal Pilot Ops transition-based notifications.
-- Emits durable records only when state transitions occur to avoid alert spam.

CREATE TABLE IF NOT EXISTS public.pilot_ops_notification_state (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  last_health_status text,
  last_attention_overdue boolean NOT NULL DEFAULT FALSE,
  last_checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_ops_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  notification_kind text NOT NULL CHECK (
    notification_kind IN ('newly_needs_attention', 'newly_attention_overdue')
  ),
  reason_code text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pilot_ops_notifications_store_triggered_at
  ON public.pilot_ops_notifications USING btree (store_id, triggered_at DESC);

ALTER TABLE public.pilot_ops_notification_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_ops_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_ops_notification_state_select_by_store_membership ON public.pilot_ops_notification_state;
DROP POLICY IF EXISTS pilot_ops_notification_state_insert_by_store_membership ON public.pilot_ops_notification_state;
DROP POLICY IF EXISTS pilot_ops_notification_state_update_by_store_membership ON public.pilot_ops_notification_state;
DROP POLICY IF EXISTS pilot_ops_notifications_select_by_store_membership ON public.pilot_ops_notifications;
DROP POLICY IF EXISTS pilot_ops_notifications_insert_by_store_membership ON public.pilot_ops_notifications;

CREATE POLICY pilot_ops_notification_state_select_by_store_membership
ON public.pilot_ops_notification_state
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notification_state.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_notification_state_insert_by_store_membership
ON public.pilot_ops_notification_state
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notification_state.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_notification_state_update_by_store_membership
ON public.pilot_ops_notification_state
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notification_state.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notification_state.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_notifications_select_by_store_membership
ON public.pilot_ops_notifications
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notifications.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);

CREATE POLICY pilot_ops_notifications_insert_by_store_membership
ON public.pilot_ops_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = pilot_ops_notifications.store_id
      AND su.user_id = auth.uid()
      AND su.is_active = TRUE
  )
);
