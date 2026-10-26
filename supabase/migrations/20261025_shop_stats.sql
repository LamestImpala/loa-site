-- Public seller track record for the shop ("45 records sold since Aug 2026").
--
-- Sold records are unlisted once they ship, and anon can only read listed
-- rows, so the shop can't count sales itself. This function returns just the
-- two aggregates — no buyer, price or order data — and runs as its owner so
-- it can see unlisted rows.

create or replace function public.shop_stats()
returns table (sold_count bigint, first_sale timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select count(*), min(sold_at)
  from public.records
  where sold;
$$;

revoke all on function public.shop_stats() from public;
grant execute on function public.shop_stats() to anon, authenticated;
