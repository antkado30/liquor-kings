-- CONTEXTUAL BROWSE FACETS (2026-08-15, Tony's full-renovation mandate:
-- "make the filtering system advanced and actually work and make sense").
--
-- The old /browse/facets returns GLOBAL counts: pick Vodka and the size
-- list still shows whole-catalog numbers, so users walk into dead ends
-- ("No bottles match these filters"). World-class filtering shows, for
-- every option, how many results YOU'D GET given everything else you've
-- already picked — and never offers a zero-result choice unlabeled.
--
-- THE FACETING RULE (industry standard): each dimension's counts apply
-- every active filter EXCEPT that dimension's own. (With Vodka picked,
-- the category list still shows counts for Tequila etc. — so you can
-- SWITCH category, not just narrow into a wall.)
--
-- Filter semantics mirror /catalog/browse EXACTLY (browse.routes.js):
--   container glass  = container is null/''/'glass'
--   container plastic= container = 'plastic'
--   packs singles    = (pack_count null or < 2) and is_combo is not true
--   packs packs      = (pack_count >= 2 or is_combo is true)
--   ordered_only     = exists in store_item_order_stats for p_store_id
--   q                = name ilike OR name_searchable ilike (stripped)
--
-- One round trip, ~6 aggregate scans over ≤14k rows — single-digit ms
-- territory with the existing indexes.

create or replace function public.browse_facets_contextual(
  p_category text default null,
  p_ada_number text default null,
  p_bottle_size_ml int default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_proof numeric default null,
  p_max_proof numeric default null,
  p_new_only boolean default false,
  p_container text default null,
  p_packs text default null,
  p_ordered_only boolean default false,
  p_store_id uuid default null,
  p_q text default null
) returns jsonb
language sql
stable
as $$
with params as (
  select
    nullif(trim(coalesce(p_q, '')), '') as q,
    regexp_replace(lower(coalesce(p_q, '')), '[^a-z0-9]', '', 'g') as q_stripped
),
-- Every filter as a reusable boolean per row, computed once.
flags as (
  select
    i.*,
    (p_category is null or i.category = p_category) as f_category,
    (p_ada_number is null or i.ada_number = p_ada_number) as f_ada,
    (p_bottle_size_ml is null or i.bottle_size_ml = p_bottle_size_ml) as f_size,
    ((p_min_price is null or i.licensee_price >= p_min_price)
      and (p_max_price is null or i.licensee_price <= p_max_price)) as f_price,
    ((p_min_proof is null or i.proof >= p_min_proof)
      and (p_max_proof is null or i.proof <= p_max_proof)) as f_proof,
    (not p_new_only or i.is_new_item is true) as f_new,
    (p_container is null
      or (p_container = 'glass' and (i.container is null or i.container in ('', 'glass')))
      or (p_container = 'plastic' and i.container = 'plastic')) as f_container,
    (p_packs is null
      or (p_packs = 'singles' and (i.pack_count is null or i.pack_count < 2) and i.is_combo is not true)
      or (p_packs = 'packs' and (i.pack_count >= 2 or i.is_combo is true))) as f_packs,
    (not p_ordered_only or exists (
      select 1 from public.store_item_order_stats s
      where s.store_id = p_store_id and s.code = i.code
    )) as f_ordered,
    ((select q from params) is null
      or i.name ilike '%' || (select q from params) || '%'
      or i.name_searchable ilike '%' || (select q_stripped from params) || '%') as f_q
  from public.mlcc_items i
  where i.is_active = true
)
select jsonb_build_object(
  'total', (
    select count(*) from flags
    where f_category and f_ada and f_size and f_price and f_proof
      and f_new and f_container and f_packs and f_ordered and f_q
  ),
  'categories', coalesce((
    select jsonb_agg(jsonb_build_object('name', category, 'count', n) order by n desc, category)
    from (
      select category, count(*) as n from flags
      where category is not null
        and f_ada and f_size and f_price and f_proof
        and f_new and f_container and f_packs and f_ordered and f_q
      group by category
    ) c
  ), '[]'::jsonb),
  'adas', coalesce((
    select jsonb_agg(jsonb_build_object('number', ada_number, 'name', ada_name, 'count', n) order by n desc)
    from (
      select ada_number, min(ada_name) as ada_name, count(*) as n from flags
      where ada_number is not null
        and f_category and f_size and f_price and f_proof
        and f_new and f_container and f_packs and f_ordered and f_q
      group by ada_number
    ) a
  ), '[]'::jsonb),
  'sizes', coalesce((
    select jsonb_agg(jsonb_build_object('ml', bottle_size_ml, 'label', label, 'count', n) order by bottle_size_ml)
    from (
      select bottle_size_ml, min(bottle_size_label) as label, count(*) as n from flags
      where bottle_size_ml is not null
        and f_category and f_ada and f_price and f_proof
        and f_new and f_container and f_packs and f_ordered and f_q
      group by bottle_size_ml
    ) s
  ), '[]'::jsonb),
  'price', (
    select jsonb_build_object('min', min(licensee_price), 'max', max(licensee_price))
    from flags
    where licensee_price is not null
      and f_category and f_ada and f_size and f_proof
      and f_new and f_container and f_packs and f_ordered and f_q
  ),
  'proof', (
    select jsonb_build_object('min', min(proof), 'max', max(proof))
    from flags
    where proof is not null
      and f_category and f_ada and f_size and f_price
      and f_new and f_container and f_packs and f_ordered and f_q
  )
)
$$;
