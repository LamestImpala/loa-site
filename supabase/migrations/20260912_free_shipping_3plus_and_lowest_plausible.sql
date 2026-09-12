-- Apply in the Supabase SQL editor (project spmbjuurarlpyqcqxyyz).
-- 1. Shipping: $6 for 1-2 records, free on 3 or more — mirrors
--    lib/records.ts combinedShipping(). The trigger recomputes order_requests
--    totals server-side, so the two must agree.
create or replace function public.validate_order_request()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  valid_ids bigint[];
  snap jsonb; sub numeric; n int;
begin
  -- flood cap: at most 30 requests per trailing hour
  if (select count(*) from public.order_requests
      where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate limited';
  end if;

  select array_agg(distinct id) into valid_ids from unnest(new.record_ids) as id;
  if array_length(valid_ids, 1) > 40 then raise exception 'too many records'; end if;

  -- keep only ids that exist, are listed, and not sold (holds do NOT block)
  select array_agg(r.id order by r.artist, r.title),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'artist', r.artist, 'title', r.title,
           'media', r.media, 'sleeve', r.sleeve, 'price', r.price
         ) order by r.artist, r.title), '[]'::jsonb),
         coalesce(sum(r.price), 0), count(*)
    into valid_ids, snap, sub, n
  from public.records r
  where r.id = any(valid_ids) and r.listed and not r.sold;

  if n = 0 then raise exception 'no valid records'; end if;

  new.record_ids := valid_ids;
  new.items      := snap;
  new.subtotal   := sub;
  -- keep in sync with lib/records.ts combinedShipping: $6 for 1-2 records, free on 3+
  new.shipping   := case when n >= 3 then 0 else 6 end;
  new.total      := new.subtotal + new.shipping;
  new.status     := 'new';
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$function$;

-- 2. Whether the daily price run treated Discogs' condition-blind
--    lowest_price as a comparable listing (at or above the Fair-grade
--    suggestion). Until this column exists the run and the admin fall back
--    to writing/reading snapshots without it.
alter table public.market_snapshots
  add column if not exists lowest_plausible boolean;
comment on column public.market_snapshots.lowest_plausible is
  'True when lowest sat at or above the Fair-grade price suggestion at snapshot time; false = ignored for pricing (junk grade, non-US seller, or FX-converted foreign listing).';
