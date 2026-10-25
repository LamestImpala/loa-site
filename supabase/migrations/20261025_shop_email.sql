-- Email ordering. Buyers without a Reddit account can send a request from
-- the shop by email: the request row records the channel and contact
-- details, orders carry the buyer's email, and mail sent to
-- orders@curiouserrecords.com (received by Resend, delivered to
-- /api/email-inbound) lands in shop_messages for the admin Inbox.

-- ---------------------------------------------------------------------
-- order_requests: which channel the buyer used and how to reach them.
-- ---------------------------------------------------------------------
alter table public.order_requests
  add column if not exists channel text not null default 'reddit',
  add column if not exists buyer_name text,
  add column if not exists buyer_email text,
  add column if not exists message text;

alter table public.order_requests
  drop constraint if exists order_requests_channel_check;
alter table public.order_requests
  add constraint order_requests_channel_check
  check (channel in ('reddit', 'email'));

comment on column public.order_requests.channel is
  'How the buyer sent the request: reddit (pre-filled DM) or email (the shop form; the site emails the admin and the buyer).';
comment on column public.order_requests.buyer_name is
  'Name the buyer typed on the email form (optional, ≤80 chars).';
comment on column public.order_requests.buyer_email is
  'Buyer email from the email form, lowercased; required when channel = email.';
comment on column public.order_requests.message is
  'Optional note the buyer typed on the email form (≤1000 chars).';

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
  -- keep in sync with lib/records.ts combinedShipping: $6 for 1-2 records, free on 3+
  new.shipping   := case when n >= 3 then 0 else 6 end;
  new.total      := new.subtotal + new.shipping;
  new.status     := 'new';
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- orders: the email buyer's address rides with the order.
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists buyer_email text;
comment on column public.orders.buyer_email is
  'Email of a buyer who ordered through the shop form; null for Reddit buyers. buyer_username holds their name instead of a Reddit handle.';

-- ---------------------------------------------------------------------
-- shop_messages: mail to and from orders@curiouserrecords.com.
-- Inbound rows are written by /api/email-inbound (Resend webhook, service
-- role); outbound rows by /api/email-reply under the admin's token.
-- ---------------------------------------------------------------------
create table if not exists public.shop_messages (
  id bigint generated by default as identity primary key,
  direction text not null check (direction in ('in', 'out')),
  resend_email_id text unique,          -- Resend's id; dedupes webhook retries
  message_id text,                      -- RFC 5322 Message-ID
  in_reply_to text,                     -- Message-ID this one answers
  from_email text not null,
  from_name text,
  to_email text not null,
  subject text,
  text_body text,
  html_body text,
  ref_code text,                        -- CR-XXXX found in the subject or body
  request_id bigint references public.order_requests(id) on delete set null,
  order_id bigint references public.orders(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'read', 'replied', 'archived')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shop_messages_status_received_idx
  on public.shop_messages (status, received_at desc);
create index if not exists shop_messages_request_id_idx
  on public.shop_messages (request_id);

alter table public.shop_messages enable row level security;
drop policy if exists "admin full access to shop_messages" on public.shop_messages;
create policy "admin full access to shop_messages" on public.shop_messages
  for all
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
