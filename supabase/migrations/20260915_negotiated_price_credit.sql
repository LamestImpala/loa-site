-- Negotiated prices and order credits.
--
-- records.negotiated_price: the price agreed for the current sale when it
-- differs from the listed price. The listed price stays intact (and the
-- daily price run keeps working from it); the invoice shows the listed
-- price with the difference as a line-item discount. Set while a record
-- is held or invoiced, cleared when the hold is released or the record is
-- un-sold, and folded into sold_price when the sale lands.
--
-- orders.credit: money taken off the whole order — a make-good for an
-- unavailable record on an earlier order, or a bundle deal. Shows on the
-- PayPal invoice as an invoice-level discount, with credit_note in the
-- note to the buyer. The stats tiles subtract paid orders' credits from
-- the sold total, since the records' sold prices don't carry it.
alter table public.records
  add column if not exists negotiated_price numeric
    check (negotiated_price is null or negotiated_price >= 0);
comment on column public.records.negotiated_price is
  'Price agreed for the current sale when it differs from price. Cleared when a hold is released or the record is un-sold; becomes sold_price on sale.';

alter table public.orders
  add column if not exists credit numeric not null default 0 check (credit >= 0),
  add column if not exists credit_note text not null default '';
comment on column public.orders.credit is
  'Amount taken off the whole order (make-good or deal). An invoice-level discount on PayPal; subtracted from the sold total in stats.';
comment on column public.orders.credit_note is
  'Why the credit was given — goes in the invoice note to the buyer.';
