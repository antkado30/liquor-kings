-- Foundational Liquor Kings tables required by later migrations.
-- This migration intentionally establishes only the core schema relied on by
-- current API usage and subsequent migration files.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  store_name text,
  liquor_license text,
  mlcc_store_number text,
  mlcc_username text,
  mlcc_password_encrypted text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  timezone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_users_store_id_fkey'
      AND conrelid = 'public.store_users'::regclass
  ) THEN
    ALTER TABLE public.store_users
      ADD CONSTRAINT store_users_store_id_fkey
      FOREIGN KEY (store_id)
      REFERENCES public.stores (id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS store_users_store_user_unique
  ON public.store_users USING btree (store_id, user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_user_id
  ON public.store_users USING btree (user_id);

CREATE TABLE IF NOT EXISTS public.mlcc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  size_ml integer,
  category text,
  subcategory text,
  abv numeric,
  state_min_price numeric,
  mlcc_item_no text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mlcc_items_code_unique
  ON public.mlcc_items USING btree (code);

CREATE TABLE IF NOT EXISTS public.bottles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mlcc_code text NOT NULL,
  upc text,
  image_url text,
  size text,
  size_ml integer,
  category text,
  subcategory text,
  abv numeric,
  state_min_price numeric,
  shelf_price numeric(10,2),
  is_active boolean NOT NULL DEFAULT true,
  mlcc_item_id uuid,
  store_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bottles_mlcc_item_id_fkey'
      AND conrelid = 'public.bottles'::regclass
  ) THEN
    ALTER TABLE public.bottles
      ADD CONSTRAINT bottles_mlcc_item_id_fkey
      FOREIGN KEY (mlcc_item_id)
      REFERENCES public.mlcc_items (id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bottles_store_id_fkey'
      AND conrelid = 'public.bottles'::regclass
  ) THEN
    ALTER TABLE public.bottles
      ADD CONSTRAINT bottles_store_id_fkey
      FOREIGN KEY (store_id)
      REFERENCES public.stores (id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bottles_store_id
  ON public.bottles USING btree (store_id);
CREATE INDEX IF NOT EXISTS idx_bottles_mlcc_item_id
  ON public.bottles USING btree (mlcc_item_id);
CREATE INDEX IF NOT EXISTS idx_bottles_mlcc_code
  ON public.bottles USING btree (mlcc_code);
CREATE INDEX IF NOT EXISTS idx_bottles_upc
  ON public.bottles USING btree (upc);

CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid,
  bottle_id uuid,
  quantity integer DEFAULT 0,
  low_stock_threshold integer DEFAULT 5,
  shelf_price numeric,
  cost numeric,
  par_level integer,
  location_note text,
  is_active boolean NOT NULL DEFAULT true,
  reorder_point integer,
  reorder_quantity integer,
  last_counted_at timestamptz,
  location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_store_fk'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_store_fk
      FOREIGN KEY (store_id)
      REFERENCES public.stores (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_bottle_fk'
      AND conrelid = 'public.inventory'::regclass
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_bottle_fk
      FOREIGN KEY (bottle_id)
      REFERENCES public.bottles (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_store_id_idx
  ON public.inventory USING btree (store_id);
CREATE INDEX IF NOT EXISTS inventory_bottle_id_idx
  ON public.inventory USING btree (bottle_id);
CREATE INDEX IF NOT EXISTS inventory_store_bottle_idx
  ON public.inventory USING btree (store_id, bottle_id);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
