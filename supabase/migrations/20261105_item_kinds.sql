-- Posters and audiophile equipment join the shop.
--
-- They share the records table rather than getting their own: the id space
-- is what holds, order_requests.record_ids, invoices, shipments, shop_visits
-- and record_events together, so a poster in a bundle flows through the
-- same request → invoice → pick → pack → ship path as an LP. A `kind`
-- column tells the two sites apart; kind-specific fields (venue, edition,
-- what's included with an amp…) live in one jsonb column so adding a field
-- is an admin-form change, not a migration.
--
-- Non-records keep media/sleeve/pressing as '' (never null): the TypeScript
-- helpers call .trim()/.match() on them and tolerate an empty string.

alter table public.records
  add column if not exists kind text not null default 'record',
  add column if not exists condition text,
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.records drop constraint if exists records_kind_check;
alter table public.records add constraint records_kind_check
  check (kind in ('record', 'poster', 'gear'));

-- Keep in sync with ITEM_CONDITIONS in lib/items.ts.
alter table public.records drop constraint if exists records_condition_check;
alter table public.records add constraint records_condition_check
  check (condition is null
         or condition in ('Mint', 'Excellent', 'Very Good', 'Good', 'Fair', 'For parts'));

alter table public.records
  alter column pressing set default '',
  alter column media set default '',
  alter column sleeve set default '';

comment on column public.records.kind is
  'record (vinyl, Discogs-backed) | poster (concert poster) | gear (audio equipment).';
comment on column public.records.condition is
  'Single-scale condition for posters and gear; records grade media/sleeve instead.';
comment on column public.records.details is
  'Kind-specific fields. poster: venue, city, show_date (YYYY-MM-DD), designer, edition, dimensions, print_method, condition_note. gear: category, working_note, included.';

create index if not exists records_kind_listed_idx on public.records (kind) where listed;

-- The shop selects these as anon; see 20260916_records_anon_column_grants.sql.
grant select (kind, condition, details) on table public.records to anon;

-- "N records sold" on the shop stays about records.
create or replace function public.shop_stats()
returns table (sold_count bigint, first_sale timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select count(*), min(sold_at)
  from public.records
  where sold and kind = 'record';
$$;

-- ---------------------------------------------------------------------
-- order_requests: shipping is summed per kind. Records keep the Media
-- Mail rule ($6 for 1-2, free on 3+); any number of posters ships in one
-- tube for a flat $12; equipment is quoted after the request ($0 here).
-- Keep in sync with shippingFor() in lib/items.ts.
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
  -- flood cap: at most 30 requests per trailing hour
  if (select count(*) from public.order_requests
      where created_at > now() - interval '1 hour') >= 30 then
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
