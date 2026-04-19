CREATE TABLE public.mlcc_brand_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  common_name TEXT NOT NULL,
  mlcc_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mlcc_brand_aliases_unique
  ON public.mlcc_brand_aliases (lower(common_name), lower(mlcc_name));

ALTER TABLE public.mlcc_brand_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mlcc_brand_aliases_select_authenticated"
  ON public.mlcc_brand_aliases FOR SELECT TO authenticated USING (true);

INSERT INTO public.mlcc_brand_aliases (common_name, mlcc_name) VALUES
  ('jack daniels', 'j daniels'),
  ('jack daniels', 'j daniel'),
  ('jack daniels', 'jack daniel'),
  ('jim beam', 'j beam'),
  ('evan williams', 'evan william'),
  ('crown royal', 'crown roy'),
  ('hennessy', 'hennesy'),
  ('hennessy', 'henn'),
  ('johnnie walker', 'johnie walker'),
  ('johnnie walker', 'johnnie walk'),
  ('makers mark', 'maker mark'),
  ('makers mark', 'mkrs mark'),
  ('fireball', 'fire ball'),
  ('grey goose', 'gray goose'),
  ('patron', 'patrón'),
  ('jose cuervo', 'j cuervo'),
  ('jose cuervo', 'jose cuerv'),
  ('1800 tequila', '1800'),
  ('don julio', 'don jul'),
  ('buffalo trace', 'buffalo tr'),
  ('woodford reserve', 'woodford res'),
  ('wild turkey', 'wild turk'),
  ('jameson', 'jamesons'),
  ('captain morgan', 'capt morgan'),
  ('captain morgan', 'captain morg'),
  ('malibu', 'malibu rum'),
  ('bacardi', 'bacard'),
  ('smirnoff', 'smirnov'),
  ('absolut', 'absolut vodka'),
  ('ciroc', 'cîroc'),
  ('belvedere', 'belvedr');

COMMENT ON TABLE public.mlcc_brand_aliases IS
  'Maps common brand names to MLCC abbreviations for fuzzy search.';
