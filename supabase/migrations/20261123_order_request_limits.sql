-- Protect the order form (security slice 2).
--
-- Apply AFTER the code that sends both "Request to buy" channels through
-- /api/order-request is live. From then on the route's service role is the
-- only writer; this migration closes the direct path from the public key.
-- Applied before that deploy, every Reddit-channel request would fail to
-- save (the old page inserts from the browser).

-- ---------------------------------------------------------------------
-- 1. Who sent it, for the per-visitor limit: a keyed hash of the IP
--    (lib/rate-limit.ts). Never the address itself. Null on rows from
--    before this migration and on the admin's pasted DMs.
-- ---------------------------------------------------------------------
alter table public.order_requests
  add column if not exists ip_hash text;

comment on column public.order_requests.ip_hash is
  'Keyed hash of the sender''s IP, set by /api/order-request for its per-visitor hourly limit. Not reversible without the server secret.';

create index if not exists order_requests_ip_hash_created_idx
  on public.order_requests (ip_hash, created_at desc)
  where ip_hash is not null;

-- The per-email daily limit counts by address.
create index if not exists order_requests_buyer_email_created_idx
  on public.order_requests (buyer_email, created_at desc)
  where buyer_email is not null;

-- ---------------------------------------------------------------------
-- 2. validate_order_request. Three changes; every other check is as it
--    was in 20261105_item_kinds.sql.
--
--    a. The shop-wide cap becomes a backstop: 30 -> 120 an hour. Each
--       visitor is now limited on their own, so one sender can no longer
--       use up the whole shop's allowance.
--    b. The per-visitor (5 an hour per ip_hash) and per-email (3 a day)
--       limits are enforced here as well as in the route. The route's
--       check reads then writes, so a burst of parallel requests would
--       all read "under the limit" before any of them saved.
--    c. An advisory lock makes requests save one at a time, so none of
--       these counts can be raced. Held only for the insert itself.
--
--    Keep 5 and 3 in sync with lib/order-request-db.ts.
-- ---------------------------------------------------------------------
create or replace function public.validate_order_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  valid_ids bigint[];
  snap jsonb; sub numeric; n int;
  n_records int; n_posters int;
begin
  -- one request at a time: the counts below must see every earlier one
  perform pg_advisory_xact_lock(hashtext('public.order_requests insert'));

  -- flood backstop: at most 120 requests per trailing hour, shop-wide
  if (select count(*) from public.order_requests
      where created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate limited';
  end if;

  -- per visitor: at most 5 per trailing hour for one hashed IP. Rows
  -- without a hash (the admin's pasted DMs) are not counted.
  if new.ip_hash is not null
     and (select count(*) from public.order_requests
          where ip_hash = new.ip_hash
            and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate limited';
  end if;

  select array_agg(distinct id) into valid_ids from unnest(new.record_ids) as id;
  if array_length(valid_ids, 1) > 40 then raise exception 'too many records'; end if;

  -- keep only ids that exist, are listed, and not sold (holds do NOT block);
  -- records first, then posters, then gear, the order bundleBreakdown prints
  select array_agg(r.id order by
           case r.kind when 'record' then 0 when 'poster' then 1 else 2 end, r.artist, r.title),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'artist', r.artist, 'title', r.title,
           'media', r.media, 'sleeve', r.sleeve, 'condition', r.condition, 'price', r.price
         ) order by
           case r.kind when 'record' then 0 when 'poster' then 1 else 2 end, r.artist, r.title),
           '[]'::jsonb),
         coalesce(sum(r.price), 0), count(*),
         count(*) filter (where r.kind = 'record'),
         count(*) filter (where r.kind = 'poster')
    into valid_ids, snap, sub, n, n_records, n_posters
  from public.records r
  where r.id = any(valid_ids) and r.listed and not r.sold;

  if n = 0 then raise exception 'no valid records'; end if;

  -- Channel: the shop form sets email; everything else is a Reddit DM.
  new.channel := coalesce(nullif(trim(new.channel), ''), 'reddit');
  if new.channel not in ('reddit', 'email') then new.channel := 'reddit'; end if;

  -- Optional Reddit username: strip a leading u/ or /u/, then keep it only
  -- if it looks like a real handle (Reddit allows 3-20 of [A-Za-z0-9_-]).
  new.buyer_username := nullif(
    regexp_replace(trim(coalesce(new.buyer_username, '')), '^/?u/', ''), '');
  if new.buyer_username is not null
     and new.buyer_username !~ '^[A-Za-z0-9_-]{1,20}$' then
    new.buyer_username := null;
  end if;

  -- Email-form contact details: trimmed, bounded, email lowercased and
  -- shape-checked. An email request without a usable address is refused.
  new.buyer_name := nullif(left(trim(coalesce(new.buyer_name, '')), 80), '');
  new.buyer_email := nullif(lower(trim(coalesce(new.buyer_email, ''))), '');
  if new.buyer_email is not null
     and new.buyer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    new.buyer_email := null;
  end if;
  if new.channel = 'email' and new.buyer_email is null then
    raise exception 'email required';
  end if;
  -- per address: at most 3 per trailing day, so the confirmation email
  -- can't be used to pester one inbox
  if new.buyer_email is not null
     and (select count(*) from public.order_requests
          where buyer_email = new.buyer_email
            and created_at > now() - interval '1 day') >= 3 then
    raise exception 'rate limited';
  end if;
  new.message := nullif(left(trim(coalesce(new.message, '')), 1000), '');

  new.record_ids := valid_ids;
  new.items      := snap;
  new.subtotal   := sub;
  -- keep in sync with lib/items.ts shippingFor(): records $6 for 1-2, free
  -- on 3+; posters a flat $12 tube for any number; gear quoted separately.
  new.shipping   := (case when n_records = 0 or n_records >= 3 then 0 else 6 end)
                  + (case when n_posters > 0 then 12 else 0 end);
  new.total      := new.subtotal + new.shipping;
  new.status     := 'new';
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Close the direct path. Nobody inserts with the public key any more;
--    the route writes with the service role, which bypasses RLS.
--
--    The admin still inserts as a signed-in user (Sell page, "paste a
--    DM": app/admin/_sell/paste-dm.tsx), so `authenticated` keeps its
--    INSERT grant and gets an admin-only policy in place of the open one.
--    Any other signed-in user (a pick'em player) is refused by RLS.
-- ---------------------------------------------------------------------
drop policy if exists "anyone submits order requests" on public.order_requests;

drop policy if exists "admin adds order requests" on public.order_requests;
create policy "admin adds order requests" on public.order_requests
  for insert
  to authenticated
  with check ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');

revoke insert on public.order_requests from anon;
