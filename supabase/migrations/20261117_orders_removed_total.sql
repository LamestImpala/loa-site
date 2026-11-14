-- Items taken off a paid order because they couldn't be found.
--
-- A record can sell and then not be on the shelf when it's time to pull
-- it. The buyer gets that record's price back in PayPal and the rest of
-- the order ships. Until now the only way to say so was to delete the
-- record by hand on Stock, which left the numbers wrong: the record's
-- price left the sold total with the record, and then the PayPal refund
-- for it (orders.refunded_amount) came off the sold total a second time.
--
-- orders.removed_total: the sold prices of the items "Can't find it"
-- took off the order. The part of a refund that pays those back isn't
-- subtracted from the sold total again; while it is more than
-- refunded_amount, the order card says how much is still to refund.
-- Additive: every existing order reads 0.
alter table public.orders
  add column if not exists removed_total numeric not null default 0
    check (removed_total >= 0);

comment on column public.orders.removed_total is
  'Sold prices of items taken off this paid order because they could not be found (Can''t find it on /admin/ship/orders). A refund up to this amount pays those items back and is not subtracted from the sold total again.';
