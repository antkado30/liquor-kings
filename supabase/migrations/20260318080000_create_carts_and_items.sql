-- Carts table
CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',

  validation_status text,
  execution_status text,

  placed_at timestamptz,
  external_order_ref text,
  execution_notes text,
  receipt_snapshot jsonb,

  validation_requested_at timestamptz,
  validation_completed_at timestamptz,
  validation_error text,

  execution_requested_at timestamptz,
  execution_completed_at timestamptz,
  execution_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cart items table
CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL,
  bottle_id uuid NOT NULL,
  mlcc_item_id uuid,
  quantity integer NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Relationships
ALTER TABLE public.carts
  ADD CONSTRAINT carts_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.stores (id)
  ON DELETE CASCADE;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_cart_id_fkey
  FOREIGN KEY (cart_id) REFERENCES public.carts (id)
  ON DELETE CASCADE;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_bottle_id_fkey
  FOREIGN KEY (bottle_id) REFERENCES public.bottles (id)
  ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carts_store_id ON public.carts(store_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON public.cart_items(cart_id);

-- RLS
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;