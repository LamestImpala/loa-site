-- The Discogs collection copies the hourly import (/api/discogs-import) has
-- already dealt with. A record only knows its release id, so this is what
-- lets the import tell copies apart: a copy listed here is never imported
-- again, even after its draft is deleted from Stock. record_id is the draft
-- the import created; null means the copy was matched to a record that was
-- already in Stock. The import does nothing until this table exists.
create table if not exists public.discogs_imports (
  instance_id bigint primary key,
  release_id bigint not null,
  record_id bigint references public.records(id) on delete set null,
  seen_at timestamptz not null default now()
);

create index if not exists discogs_imports_release_id_idx
  on public.discogs_imports (release_id);

comment on table public.discogs_imports is
  'Discogs collection instances already imported into records as drafts, or matched to an existing record. Written by /api/discogs-import with the service role.';

alter table public.discogs_imports enable row level security;
drop policy if exists "admin reads discogs imports" on public.discogs_imports;
create policy "admin reads discogs imports" on public.discogs_imports
  for select
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
