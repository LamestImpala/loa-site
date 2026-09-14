-- Pick list: when the owner pulled this record off the shelf for its paid
-- order. Set and cleared from /admin/pick; cleared again when a record is
-- un-sold. No index — the admin loads every record and derives the list in
-- memory; nothing filters on it.
alter table public.records
  add column if not exists picked_at timestamptz;

comment on column public.records.picked_at is
  'When the record was pulled from the shelf for its paid order (admin pick list). Null = not pulled yet. Cleared when the record is un-sold.';
