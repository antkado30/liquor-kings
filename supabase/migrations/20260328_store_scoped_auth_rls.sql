-- Store-scoped columns, backfills, and RLS for carts / cart_items / execution_runs.
-- Service role bypasses RLS; policies apply to anon + authenticated direct PostgREST access.

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS mlcc_item_id uuid REFERENCES public.mlcc_items (id);

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id);

UPDATE public.cart_items ci
SET
  store_id = c.store_id
FROM
  public.carts c
WHERE
  ci.cart_id = c.id
  AND ci.store_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cart_items_store_id ON public.cart_items USING btree (store_id);

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carts_select_by_store_membership ON public.carts;

DROP POLICY IF EXISTS carts_insert_by_store_membership ON public.carts;

DROP POLICY IF EXISTS carts_update_by_store_membership ON public.carts;

DROP POLICY IF EXISTS carts_delete_by_store_membership ON public.carts;

CREATE POLICY carts_select_by_store_membership ON public.carts FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = carts.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY carts_insert_by_store_membership ON public.carts FOR INSERT TO authenticated
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = carts.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY carts_update_by_store_membership ON public.carts FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = carts.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = carts.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY carts_delete_by_store_membership ON public.carts FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = carts.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

DROP POLICY IF EXISTS cart_items_select_by_store_membership ON public.cart_items;

DROP POLICY IF EXISTS cart_items_insert_by_store_membership ON public.cart_items;

DROP POLICY IF EXISTS cart_items_update_by_store_membership ON public.cart_items;

DROP POLICY IF EXISTS cart_items_delete_by_store_membership ON public.cart_items;

CREATE POLICY cart_items_select_by_store_membership ON public.cart_items FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = cart_items.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY cart_items_insert_by_store_membership ON public.cart_items FOR INSERT TO authenticated
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = cart_items.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY cart_items_update_by_store_membership ON public.cart_items FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = cart_items.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = cart_items.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY cart_items_delete_by_store_membership ON public.cart_items FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = cart_items.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

DROP POLICY IF EXISTS execution_runs_select_authenticated ON public.execution_runs;

DROP POLICY IF EXISTS execution_runs_insert_authenticated ON public.execution_runs;

DROP POLICY IF EXISTS execution_runs_update_authenticated ON public.execution_runs;

CREATE POLICY execution_runs_select_by_store_membership ON public.execution_runs FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = execution_runs.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY execution_runs_insert_by_store_membership ON public.execution_runs FOR INSERT TO authenticated
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = execution_runs.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY execution_runs_update_by_store_membership ON public.execution_runs FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = execution_runs.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = execution_runs.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS inventory_delete_by_store_membership ON public.inventory;

DROP POLICY IF EXISTS inventory_insert_by_store_membership ON public.inventory;

DROP POLICY IF EXISTS inventory_select_by_store_membership ON public.inventory;

DROP POLICY IF EXISTS inventory_update_by_store_membership ON public.inventory;

CREATE POLICY inventory_delete_by_store_membership ON public.inventory FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = inventory.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY inventory_insert_by_store_membership ON public.inventory FOR INSERT TO authenticated
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = inventory.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE POLICY inventory_select_by_store_membership ON public.inventory FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = inventory.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
);

CREATE POLICY inventory_update_by_store_membership ON public.inventory FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.store_users su
    WHERE
      su.store_id = inventory.store_id
      AND su.user_id = auth.uid ()
      AND su.is_active = TRUE
  )
)
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.store_users su
      WHERE
        su.store_id = inventory.store_id
        AND su.user_id = auth.uid ()
        AND su.is_active = TRUE
    )
  );

CREATE OR REPLACE FUNCTION public.cart_items_sync_store_id ()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT
    c.store_id INTO NEW.store_id
  FROM
    public.carts c
  WHERE
    c.id = NEW.cart_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cart_items_sync_store ON public.cart_items;

CREATE TRIGGER trg_cart_items_sync_store
  BEFORE INSERT OR UPDATE OF cart_id ON public.cart_items
  FOR EACH ROW
  EXECUTE FUNCTION public.cart_items_sync_store_id ();
