-- Release details for the shop's per-record pages.
--
-- The admin import used to keep only label/catno, year, format descriptions,
-- the primary image and genres from the Discogs release. Record pages show
-- more: the tracklist (by side, with durations), pressing country, barcode
-- and Discogs styles. New records get these at import; the daily price run
-- backfills existing ones that have a discogs_release_id.
--
-- tracklist is [{ "position": "A1", "title": "…", "duration": "3:41" }].
-- All four are nullable: null = not fetched yet, which is what the backfill
-- looks for. An empty array/string means fetched but Discogs had nothing.

alter table public.records
  add column if not exists tracklist jsonb,
  add column if not exists country text,
  add column if not exists barcode text,
  add column if not exists styles text[];

-- The shop selects these as anon; see 20260916_records_anon_column_grants.sql.
grant select (tracklist, country, barcode, styles) on table public.records to anon;
