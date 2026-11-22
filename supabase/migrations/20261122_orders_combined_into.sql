-- Combined orders: two (or more) orders from one buyer, treated as one sale.
--
-- A buyer who pays on two PayPal invoices makes two orders, and each got
-- its own "Ask for a review" row, its own review link and its own
-- scheduled email. "Combine" on the Reviews page or the order card ties
-- them together: combined_into points at the sale's first order, and the
-- review logic counts every order that points there as one sale (one row,
-- one link, one review). Nothing else moves — each order keeps its own
-- invoice, boxes, tracking and money, and "Split" clears the column.
-- Additive: null everywhere until an order is combined. Chains are never
-- stored; every member points straight at the first order.
alter table public.orders
  add column if not exists combined_into bigint
    references public.orders(id) on delete set null
    check (combined_into <> id);

create index if not exists orders_combined_into_idx
  on public.orders (combined_into)
  where combined_into is not null;

comment on column public.orders.combined_into is
  'The first order of the sale this order was combined into (Combine on /admin/reviews or the order card). Null = its own sale; cleared by Split. Review requests and reviews count the whole sale as one.';
