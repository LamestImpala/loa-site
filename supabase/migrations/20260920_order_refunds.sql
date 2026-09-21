-- Refunded orders.
--
-- Until now a refund in PayPal had nowhere to land: "Sync from PayPal"
-- refused a REFUNDED invoice as "not paid yet", so the order sat in
-- fulfillment forever, its records stayed sold and the stats kept
-- counting the money.
--
-- orders.status 'refunded': the whole payment went back to the buyer. It
-- ends a paid order the way cancelled ends an open one — the order leaves
-- fulfillment, the pick and pack lists and the stats. Records that never
-- shipped go back up for sale; ones already in a tracked parcel stay sold
-- (a lost or damaged parcel doesn't come back).
--
-- orders.refunded_amount / refunded_at: what PayPal reports as refunded
-- on the invoice. On a refunded order it's the whole payment; on a paid
-- order it's a partial refund (a grading make-good, one record of three),
-- which the stats subtract from the sold total like a credit.
alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
    check (status in ('held', 'invoiced', 'paid', 'cancelled', 'refunded'));

alter table public.orders
  add column if not exists refunded_amount numeric not null default 0
    check (refunded_amount >= 0),
  add column if not exists refunded_at timestamptz;
comment on column public.orders.refunded_amount is
  'What PayPal reports as refunded on the invoice. The whole payment on a refunded order; a partial refund on a paid one, subtracted from the sold total in stats.';
comment on column public.orders.refunded_at is
  'When PayPal says the (latest) refund went out.';
