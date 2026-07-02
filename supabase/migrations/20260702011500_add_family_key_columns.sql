-- Family-key columns for MLCC catalog grouping (catalog-family-tree-plan.md).
-- ADDITIVE + INERT: nothing reads these until the /items/:code/family endpoint
-- swap ships (a separate, later deploy). Values are computed by
-- services/api/src/mlcc/family-key.js via scripts/backfill-family-key.mjs and,
-- in the wiring phase, by the price-book ingestor on every upsert.
--
-- family_key  normalized product-line identity (name minus size/container/pack
--             tokens, combo segments cut), uppercase. Same key = one family tree.
-- container   'glass' | 'plastic' (MLCC marks plastic with PL/PET/TRAV; absence
--             = glass). Displayed on size chips when a family mixes containers —
--             the "never order glass and receive plastic" rule.
-- pack_count  multipack count (12 for "12PK" SKUs), NULL for plain bottles.
-- is_combo    gift-combo SKU ("...W/50ML..." etc). Combos map to the base
--             family for scan resolution but are excluded from family listings.

alter table public.mlcc_items
  add column if not exists family_key text,
  add column if not exists container text,
  add column if not exists pack_count integer,
  add column if not exists is_combo boolean;

-- Family lookups are always "active rows for one key".
create index if not exists mlcc_items_family_key_active_idx
  on public.mlcc_items (family_key)
  where is_active;
