-- MILO product-ID cache columns for the direct-API ordering engine.
-- ADDITIVE + INERT until the engine reads them (ships same deploy) — pure speed,
-- no behavior change for any code that isn't cached yet.
--
-- WHY: the engine's slow step is resolving each cart code to MILO's internal
-- productId + distributor via POST /products/code/<code> — ONE network call PER
-- BOTTLE (~1.3s each; the first is ~5.5s). Those values are stable global-catalog
-- facts, so we cache them on our own rows and skip the per-code round-trip at
-- order time. A code that is NOT yet cached still resolves live (byte-identical
-- to the original path). A fully-cached cart makes ZERO /products/code calls —
-- this is the per-bottle bottleneck the 2hr→minutes plan removes.
--
-- Populated by services/api/scripts/backfill-milo-product-ids.mjs (PACED + run
-- deliberately — hammering /products/code is what got us rate-limited before).
--
-- milo_product_id       MILO's internal productId (STRING — 14-digit int, kept as
--                       text to avoid float precision loss). Feeds the bulk
--                       cart-add + inventory-check payloads.
-- milo_distributor      {id, referenceNumber, name} — the supplying ADA, required
--                       by the bulk-add payload. referenceNumber CAN drift on an
--                       MLCC ADA change, so the backfill re-resolves (--refresh).
-- milo_ids_resolved_at  when we last resolved from MILO (staleness / refresh).

alter table public.mlcc_items
  add column if not exists milo_product_id text,
  add column if not exists milo_distributor jsonb,
  add column if not exists milo_ids_resolved_at timestamptz;

-- Lookups are by `code` (already covered by mlcc_items_code_unique). No new
-- index needed. This partial index only helps the backfill find un-cached rows
-- quickly ("what's left to resolve").
create index if not exists mlcc_items_milo_unmapped_idx
  on public.mlcc_items (code)
  where milo_product_id is null and is_active;
