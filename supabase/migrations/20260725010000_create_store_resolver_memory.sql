-- Store resolver memory — THE MOAT, Phase A (2026-07-24).
--
-- Tony's law (RULEBOOK #27 pillar 3, decided 2026-07-23, built 2026-07-24):
-- the AI should LEARN each store's vocabulary instead of shipping Tony's
-- slang hardcoded (FLAGSHIP_ALIASES / BRAND_SYNONYMS graduate here over
-- time). Every swap on the resolve card teaches it silently ("olive cherry"
-- → THREE OLIVES CHERRY, once, forever); the chat can teach it explicitly
-- later (Phase B). On the next resolve, a remembered phrase PINS its bottle:
-- green badge + "★ remembered", alternates one tap away.
--
-- Shape notes:
--   phrase    normalized via tokenizeName().join(" ") — the same tokenizer
--             the resolver uses, so lookup keys are stable across casing/
--             punctuation ("Olive Cherry Vodka" ≡ "olive cherry vodka").
--   size_ml   the size the phrase resolved AT (from the chosen bottle).
--             "stoli vanilla" at 750 and at 1750 are different memories —
--             NULL means the phrase carried no size.
--   source    card_swap | chat | seed — provenance so a bad learning can be
--             found and deleted; times_used/last_used_at make the memory
--             auditable ("this alias fired 41 times").
--
-- The deterministic resolver remains the authority for everything NOT
-- remembered; memory can only pin a store's own explicit choice, never
-- invent one. Memory never touches the cart directly.

CREATE TABLE IF NOT EXISTS public.store_resolver_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  phrase text NOT NULL,
  size_ml integer,
  mlcc_code text NOT NULL,
  source text NOT NULL DEFAULT 'card_swap'
    CHECK (source IN ('card_swap', 'chat', 'seed')),
  times_used integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One memory per (store, phrase, size). COALESCE folds NULL size into the
-- key so "no size" is one slot, not infinitely many.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_resolver_memory_key
  ON public.store_resolver_memory (store_id, phrase, COALESCE(size_ml, -1));

CREATE INDEX IF NOT EXISTS idx_store_resolver_memory_store
  ON public.store_resolver_memory (store_id);

ALTER TABLE public.store_resolver_memory ENABLE ROW LEVEL SECURITY;

-- Service role full access (API server / worker / scripts).
CREATE POLICY "service role full access"
  ON public.store_resolver_memory
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read/write ONLY their own store's memory
-- (same pattern as order_templates).
CREATE POLICY "users read own store memory"
  ON public.store_resolver_memory
  FOR SELECT
  TO authenticated
  USING (
    store_id IN (
      SELECT su.store_id FROM public.store_users su
      WHERE su.user_id = auth.uid() AND su.is_active = true
    )
  );

CREATE POLICY "users insert own store memory"
  ON public.store_resolver_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (
    store_id IN (
      SELECT su.store_id FROM public.store_users su
      WHERE su.user_id = auth.uid() AND su.is_active = true
    )
  );

CREATE POLICY "users update own store memory"
  ON public.store_resolver_memory
  FOR UPDATE
  TO authenticated
  USING (
    store_id IN (
      SELECT su.store_id FROM public.store_users su
      WHERE su.user_id = auth.uid() AND su.is_active = true
    )
  );

COMMENT ON TABLE public.store_resolver_memory IS
  'Per-store learned vocabulary for the AI resolver (the moat). A swap on the resolve card upserts (phrase,size)->mlcc_code; the next resolve of that phrase pins the remembered bottle with a green ★ remembered badge. Provenance + usage counters keep every learning auditable and deletable.';
