-- Clear known-bad UPC to MLCC mappings discovered during foundation testing.
-- UPC 082184090442 is Jack Daniel's Old No. 7 1L but was incorrectly cached
-- against code 36429 (JACK DANIELS NO. 27 GOLD 750ml).
update public.mlcc_items
set upc = null
where code = '36429' and upc = '082184090442';

-- Also log the correction in audit table for traceability
insert into public.upc_match_audit (
  upc, upc_product_name, matched_mlcc_code, match_mode,
  confidence_score, confidence_warning, flagged_incorrect,
  flagged_reason, created_at
) values (
  '082184090442',
  'Jack Daniel''s Old No. 7 Tennessee Whiskey',
  '36429',
  'manual_correction',
  0,
  'bad_cache_cleared',
  true,
  'systemic_wrong_match_during_testing',
  now()
);
