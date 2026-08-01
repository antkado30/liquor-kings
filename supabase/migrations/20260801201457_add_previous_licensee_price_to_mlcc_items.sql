-- Price memory (2026-08-01): remember what a bottle cost LAST book.
--
-- The price-book ingestor upserts base/licensee/min-shelf prices in
-- place — the old licensee price was destroyed the moment a new book
-- landed, and price_changed_at (a bare timestamp) was the only trace.
-- The store's whole job on book week is "what moved, and by how much?"
-- — this column is the "how much".
--
-- Written by the ingestor on every upsert (src/mlcc/
-- mlcc-price-book-ingestor.js → nextPreviousLicenseePrice): set to the
-- outgoing licensee_price when that price MOVED, carried forward when a
-- later book doesn't touch it, NULL for brand-new items. Additive +
-- nullable: the client treats NULL as "no history" and shows nothing,
-- so this migration is safe in either deploy order.

alter table public.mlcc_items
  add column if not exists previous_licensee_price numeric;

comment on column public.mlcc_items.previous_licensee_price is
  'Licensee price from the last price book where it differed. Set by the price-book ingestor (carried forward across books that do not move it). NULL = no history. Drives the "was $X" chip in the scanner.';
