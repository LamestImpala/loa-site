-- Drafts: items added in the admin that aren't on the shop yet.
--
-- A new record used to go live the moment it was added, even at $0 while
-- it waited for the daily price run. Items are now added as drafts
-- (listed = false, draft = true): the price run gives a $0 draft record
-- its first price and publishes it, and everything else is published by
-- hand from the Catalog once it has a price.
--
-- Additive: the shop reads only listed = true, so a draft is invisible
-- there without any policy change, and every existing row defaults to
-- false. `draft` is deliberately not granted to anon.
alter table public.records
  add column if not exists draft boolean not null default false;

comment on column public.records.draft is
  'True while an item added in the admin has never been put on the shop (listed is false). Cleared when it is published, by hand or by the daily price run.';
