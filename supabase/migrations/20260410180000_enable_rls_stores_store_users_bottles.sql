-- Enable RLS + store-membership policies on foundational RED tables (RLS audit).
-- Tables: public.store_users (first), public.stores, public.bottles
-- Pattern: same EXISTS(store_users … store_id … auth.uid() … is_active) as carts/inventory.
-- Intentionally excludes public.mlcc_items (global catalog; no store_id — separate policy design if needed).
-- Service role bypasses RLS; policies target authenticated PostgREST/API access.

-- ---------------------------------------------------------------------------
-- public.store_users — own row always visible; teammates via same-store membership.
-- (Applied before stores so non-superuser replays never evaluate stores policies
--  against an unrestricted store_users.)
-- ---------------------------------------------------------------------------

ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_users_select_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_insert_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_update_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_delete_by_store_membership ON public.store_users;

CREATE POLICY store_users_select_by_store_membership ON public.store_users FOR SELECT TO authenticated USING (
  store_users.user_id = auth.uid ()
  OR EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = store_users.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY store_users_insert_by_store_membership ON public.store_users FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = store_users.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY store_users_update_by_store_membership ON public.store_users FOR UPDATE TO authenticated USING (
  store_users.user_id = auth.uid ()
  OR EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = store_users.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH CHECK (
  store_users.user_id = auth.uid ()
  OR EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = store_users.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY store_users_delete_by_store_membership ON public.store_users FOR DELETE TO authenticated USING (
  store_users.user_id = auth.uid ()
  OR EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = store_users.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

-- ---------------------------------------------------------------------------
-- public.stores — one row per store; members may read/update/delete their store only.
-- ---------------------------------------------------------------------------

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select_by_store_membership ON public.stores;
DROP POLICY IF EXISTS stores_update_by_store_membership ON public.stores;
DROP POLICY IF EXISTS stores_delete_by_store_membership ON public.stores;

CREATE POLICY stores_select_by_store_membership ON public.stores FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = stores.id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY stores_update_by_store_membership ON public.stores FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = stores.id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = stores.id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY stores_delete_by_store_membership ON public.stores FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = stores.id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

-- INSERT: no authenticated policy (bootstrap / new stores via service_role only).

-- ---------------------------------------------------------------------------
-- public.bottles — store-scoped inventory rows; mirror inventory policy shape.
-- ---------------------------------------------------------------------------

ALTER TABLE public.bottles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bottles_select_by_store_membership ON public.bottles;
DROP POLICY IF EXISTS bottles_insert_by_store_membership ON public.bottles;
DROP POLICY IF EXISTS bottles_update_by_store_membership ON public.bottles;
DROP POLICY IF EXISTS bottles_delete_by_store_membership ON public.bottles;

CREATE POLICY bottles_select_by_store_membership ON public.bottles FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = bottles.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY bottles_insert_by_store_membership ON public.bottles FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = bottles.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY bottles_update_by_store_membership ON public.bottles FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = bottles.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = bottles.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY bottles_delete_by_store_membership ON public.bottles FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.store_users su
    WHERE su.store_id = bottles.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

-- ROLLBACK (manual — run only if reverting this migration):
-- DROP POLICY IF EXISTS bottles_delete_by_store_membership ON public.bottles;
-- DROP POLICY IF EXISTS bottles_update_by_store_membership ON public.bottles;
-- DROP POLICY IF EXISTS bottles_insert_by_store_membership ON public.bottles;
-- DROP POLICY IF EXISTS bottles_select_by_store_membership ON public.bottles;
-- ALTER TABLE public.bottles DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS stores_delete_by_store_membership ON public.stores;
-- DROP POLICY IF EXISTS stores_update_by_store_membership ON public.stores;
-- DROP POLICY IF EXISTS stores_select_by_store_membership ON public.stores;
-- ALTER TABLE public.stores DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS store_users_delete_by_store_membership ON public.store_users;
-- DROP POLICY IF EXISTS store_users_update_by_store_membership ON public.store_users;
-- DROP POLICY IF EXISTS store_users_insert_by_store_membership ON public.store_users;
-- DROP POLICY IF EXISTS store_users_select_by_store_membership ON public.store_users;
-- ALTER TABLE public.store_users DISABLE ROW LEVEL SECURITY;
