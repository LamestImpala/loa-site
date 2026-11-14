-- Disc colour for the 3D crate view.
--
-- Discogs notes a pressing's colour in the release's vinyl format text
-- ("Blue Translucent", "Clear With Red Splatter"). The pressing line built
-- at import keeps only the format tags (Reissue, Limited Edition, …), so
-- that text was never stored. disc_formats keeps the release's Vinyl
-- entries as Discogs wrote them:
--   [{ "qty": "2", "text": "Blue Marble", "descriptions": ["LP", "Album"] }]
-- and lib/disc-style.ts reads the colour out of them when the shop renders.
--
-- Nullable: null = not fetched yet, which is what the daily price run's
-- backfill looks for. An empty array means fetched, nothing there.
--
-- Additive, and the shop reads it in a separate query that tolerates the
-- column being absent, so the code can ship before or after this is applied.
alter table public.records
  add column if not exists disc_formats jsonb;

comment on column public.records.disc_formats is
  'Vinyl entries of the Discogs release''s formats (qty, text, descriptions). null = not fetched yet. Read by lib/disc-style.ts for the crate view''s disc colour.';

-- The shop selects it as anon; see 20260916_records_anon_column_grants.sql.
grant select (disc_formats) on table public.records to anon;
