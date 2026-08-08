-- ORDER RE-SYNC (#36 Phase A, 2026-08-08)
--
-- Born on first-order night (2026-08-05): Tony edited the GW&L order in
-- MILO's UI (removed an accidental 150-unit party-bucket line, $5,209.14
-- net -> $2,029.14) and LK kept showing the placement-time numbers with
-- no way to know they were stale. The placement record is intentionally
-- immutable ("confirmation rows record the order AS PLACED" —
-- engine-orders.js); MILO's CURRENT truth gets its own columns instead.
--
-- The worker's idle-time sync loop (workers/order-sync-loop.js) reads
-- GET /users/orders via the node engine and fills synced_* on every
-- matching confirmation row. UI rule: synced_* is the number the store
-- owner sees first; placement stays visible as "placed" when they
-- differ. Penny doctrine applies to both.

ALTER TABLE public.milo_order_confirmations
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS synced_status text,
  ADD COLUMN IF NOT EXISTS synced_updated_by_ada boolean,
  ADD COLUMN IF NOT EXISTS synced_net_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS synced_gross_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS synced_delivery_date date,
  ADD COLUMN IF NOT EXISTS synced_line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS synced_line_item_count integer,
  ADD COLUMN IF NOT EXISTS origin text;

COMMENT ON COLUMN public.milo_order_confirmations.synced_at IS
  'Last time the worker sync loop refreshed this row from MILO GET /users/orders. NULL = never synced.';
COMMENT ON COLUMN public.milo_order_confirmations.synced_net_total IS
  'CURRENT net total in MILO (netTotalAmt) as of synced_at. Differs from net_total when the order was edited after placement (ADA or owner).';
COMMENT ON COLUMN public.milo_order_confirmations.synced_line_items IS
  'CURRENT line items in MILO as of synced_at, same shape as line_items. For rows whose placement lines were never captured (backfills), this is the only line data.';
COMMENT ON COLUMN public.milo_order_confirmations.origin IS
  'How the row was born: NULL = engine submit (legacy rows predate the column), ''milo_sync'' = imported from MILO order history by the sync loop (order not placed through LK).';

-- Sync scheduling state lives on the store: on-demand requests from the
-- Orders page set order_sync_requested_at; the worker stamps
-- last_order_sync_at after each successful sync (which also clears the
-- pending condition: requested_at <= last_sync_at = nothing pending).
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS order_sync_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_order_sync_at timestamptz;

COMMENT ON COLUMN public.stores.order_sync_requested_at IS
  'Set by POST /orders/sync (owner tapped Sync). Worker syncs when this is newer than last_order_sync_at.';
COMMENT ON COLUMN public.stores.last_order_sync_at IS
  'Stamped by the worker order-sync loop after each successful MILO order-history sync for this store.';
