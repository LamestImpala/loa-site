-- Finished orders: when the seller marked the order done.
--
-- An order had no end: once its boxes were labeled it sat under
-- "completed" until it aged into the archive. The Orders page now shows
-- an after-sale checklist (review asked, off Discogs, trade confirmed)
-- on every order whose boxes have left, and "Mark done" stamps this
-- column. Additive: status values are untouched, and orders finished
-- before this existed stay null and age into the archive as before.
alter table public.orders
  add column if not exists completed_at timestamptz;

comment on column public.orders.completed_at is
  'When the seller marked the order done on /admin/ship/orders (after-sale checklist finished). Null = not marked; cleared by Reopen.';
