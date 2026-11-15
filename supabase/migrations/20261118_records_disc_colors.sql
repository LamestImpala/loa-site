-- The owner's own words for a disc's colours.
--
-- disc_formats (20261116) keeps what Discogs says about a pressing, and
-- lib/disc-style.ts reads the colour out of it. Some pressings go by a
-- nickname with no colour in it ("Volcanic Splash", "Rx Splatter"), so the
-- shop drew them as plain black. disc_colors holds a plain description typed
-- in admin ("Red & Orange with Black Splatter"); when it is set it decides
-- how the disc is drawn, and the buyer still reads Discogs' name.
--
-- Nullable: null = nothing typed, read Discogs as before.
--
-- Additive, and the shop reads it in a separate query that tolerates the
-- column being absent, so the code can ship before or after this is applied.
-- Until it is applied, saving the admin box shows an error.
alter table public.records
  add column if not exists disc_colors text;

comment on column public.records.disc_colors is
  'The owner''s plain-words description of the disc''s colours, typed in admin. Wins over disc_formats in lib/disc-style.ts. null = read Discogs.';

-- The shop selects it as anon; see 20260916_records_anon_column_grants.sql.
grant select (disc_colors) on table public.records to anon;
