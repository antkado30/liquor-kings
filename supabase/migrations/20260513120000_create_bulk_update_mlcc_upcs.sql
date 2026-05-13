-- Bulk UPC enrichment function for the MLCC catalog.
--
-- The MLCC price book TXT publishes a GTIN/UPC column (xlsx version omits
-- it). After parsing the TXT we have ~13,800 {code, upc} pairs to write
-- back to mlcc_items.upc. Calling one HTTP UPDATE per row trips Kong's
-- connection limits (we saw cascading "fetch failed" errors in dev). This
-- function takes the whole batch as jsonb and does ONE SQL UPDATE FROM,
-- which means one round trip per chunk of 1,000.
--
-- Input shape:
--   [{"code": "61101", "upc": "858349004148"}, ...]
--
-- Returns:
--   {"submitted": N, "updated": M}
--
-- Where `submitted` is the input array length, `updated` is rows that
-- actually had a matching mlcc_items.code. Difference is codes in the
-- TXT that don't exist in our catalog (unusual but possible during
-- price-book sync windows).
--
-- Idempotent: re-running with the same data is a no-op (SET to the same
-- value).

create or replace function public.bulk_update_mlcc_upcs(items jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  total_updated integer;
begin
  with input as (
    select
      (elem->>'code') as code,
      (elem->>'upc') as upc
    from jsonb_array_elements(items) as elem
  ),
  updated as (
    update public.mlcc_items mi
    set upc = i.upc
    from input i
    where mi.code = i.code
    returning mi.id
  )
  select count(*) into total_updated from updated;

  return jsonb_build_object(
    'submitted', jsonb_array_length(items),
    'updated', total_updated
  );
end;
$$;

revoke all on function public.bulk_update_mlcc_upcs(jsonb) from public;
grant execute on function public.bulk_update_mlcc_upcs(jsonb) to service_role;
