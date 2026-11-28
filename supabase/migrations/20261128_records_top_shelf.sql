-- Top Shelf: records the owner loves and has priced at what it would take to
-- let them go, not at market.
--
-- The shop shows a "Top Shelf" tag and a short note on these, so a price
-- well over Discogs reads as the owner's choice rather than a mistake. They
-- are kept out of the weekly Reddit post (lib/admin/reddit.ts offerable),
-- and ticking Top Shelf in admin also sets manual_price, so the daily price
-- run never moves them.
--
-- Additive, and the shop reads it in a separate query that tolerates the
-- column being absent, so the code can ship before or after this is applied.
-- Until it is applied, ticking the admin box shows an error.
alter table public.records
  add column if not exists top_shelf boolean not null default false;

comment on column public.records.top_shelf is
  'Owner''s Top Shelf pick: priced at what it would take to let it go, not at market. Shop shows a Top Shelf tag + note; left out of Reddit posts; admin also sets manual_price.';

-- The shop selects it as anon; see 20260916_records_anon_column_grants.sql.
grant select (top_shelf) on table public.records to anon;
