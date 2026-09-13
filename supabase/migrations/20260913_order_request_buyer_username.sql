-- Capture the buyer's Reddit username on shop order requests, so /admin can
-- seed the sale-desk buyer field when a request is loaded instead of the
-- admin retyping it from the DM.
alter table public.order_requests
  add column if not exists buyer_username text;
comment on column public.order_requests.buyer_username is
  'Reddit username the buyer typed on the shop (optional, no u/ prefix). Normalized by validate_order_request; null when blank or malformed.';

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

  -- Optional Reddit username: strip a leading u/ or /u/, then keep it only
  -- if it looks like a real handle (Reddit allows 3-20 of [A-Za-z0-9_-]).
  new.buyer_username := nullif(
    regexp_replace(trim(coalesce(new.buyer_username, '')), '^/?u/', ''), '');
  if new.buyer_username is not null
     and new.buyer_username !~ '^[A-Za-z0-9_-]{1,20}$' then
    new.buyer_username := null;
  end if;

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
