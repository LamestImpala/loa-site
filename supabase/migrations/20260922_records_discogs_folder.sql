-- Re-add to Discogs: remember which collection folder a copy came out of.
--
-- A removal deletes the collection instance, and a record that goes back
-- on sale (refund, cancelled order) has to be added again. Discogs adds a
-- release to a named folder, so the removal route now reports the folder
-- and the admin saves it here; the re-add puts the copy back there.
-- Null = unknown (removed before this column, or removed by hand) — the
-- re-add falls back to Uncategorized (folder 1). Admin-only: anon's
-- column grants (20260916) don't include it.
alter table public.records
  add column if not exists discogs_folder_id integer;

comment on column public.records.discogs_folder_id is
  'Discogs collection folder the copy was removed from; the Re-add to Discogs button adds it back there. Null = Uncategorized.';
