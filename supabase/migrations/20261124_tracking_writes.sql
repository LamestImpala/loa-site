-- Close anonymous writes to the tracking tables (security slice 3).
--
-- Apply AFTER the code that makes /api/track write with the service role
-- is live. From then on that route is the only writer; this migration
-- closes the direct path from the public key. Applied before that deploy,
-- visits and clicks would stop being recorded until it (the old route
-- inserts with the public key).

-- ---------------------------------------------------------------------
-- 1. The per-visitor counter (lib/rate-limit.ts, hitAllowed).
--
--    One row per visitor per window: `visitor` is the keyed hash of an IP
--    (never the address), `bucket` is the start of the fixed window, and
--    `hits` is how many were let through in it. The tracking rows
--    themselves carry no hash. Server-only: RLS is on with no policy and
--    the public roles hold no grant, so only the service role reaches it.
--
--    Tiny and self-cleaning: a visitor's first hit in a new window
--    deletes that scope's finished windows, so the table holds roughly
--    the visitors of the current window.
-- ---------------------------------------------------------------------
create table if not exists public.rate_hits (
  scope text not null check (char_length(scope) between 1 and 40),
  visitor text not null check (char_length(visitor) between 1 and 64),
  bucket timestamptz not null,
  hits integer not null default 1,
  primary key (scope, visitor, bucket)
);

comment on table public.rate_hits is
  'Per-visitor hit counters for public endpoints written too often to count by their own rows (/api/track). Written only by rate_hit(); finished windows are deleted as new ones start.';
comment on column public.rate_hits.visitor is
  'Keyed hash of the caller''s IP (lib/rate-limit.ts). Not reversible without the server secret.';

create index if not exists rate_hits_scope_bucket_idx
  on public.rate_hits (scope, bucket);

alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;
grant select, insert, update, delete on public.rate_hits to service_role;

-- Counts one hit and answers whether it is within the limit: true for the
-- first p_max hits of a visitor in the current window, false after. One
-- statement does the counting, so parallel requests can't all read "under
-- the limit" at once. Past the limit nothing is written at all.
create or replace function public.rate_hit(
  p_scope text,
  p_visitor text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  w integer := greatest(coalesce(p_window_seconds, 600), 1);
  b timestamptz := to_timestamp(floor(extract(epoch from now()) / w) * w);
  n integer;
begin
  if p_scope is null or p_visitor is null or coalesce(p_max, 0) < 1 then
    return false;
  end if;

  insert into public.rate_hits as h (scope, visitor, bucket)
  values (p_scope, p_visitor, b)
  on conflict (scope, visitor, bucket)
    do update set hits = h.hits + 1 where h.hits < p_max
  returning h.hits into n;

  if n is null then return false; end if;  -- already at the limit

  -- first hit of this window: clear the windows that have finished
  if n = 1 then
    delete from public.rate_hits where scope = p_scope and bucket < b;
  end if;
  return true;
end;
$function$;

revoke all on function public.rate_hit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_hit(text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------
-- 2. Backstop: a shop-wide hourly total per table, held in the database.
--
--    The route limits each visitor; this bounds everyone together, so
--    many addresses at once, or a leaked server path, still can't grow
--    the tables without limit. A row past the cap is dropped silently
--    (the insert succeeds and saves nothing): tracking must never raise
--    an error at a shopper.
--
--    Caps: 2,000 page visits and 1,000 clicks per trailing hour. The
--    busiest hour so far held 127 visits and 33 clicks.
--
--    created_at is always set here, so a writer can't backdate rows to
--    step around the trailing-hour count.
-- ---------------------------------------------------------------------
create or replace function public.tracking_backstop()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  cap integer := tg_argv[0]::integer;
  n integer;
begin
  new.created_at := now();
  execute format(
    'select count(*) from (select 1 from public.%I
       where created_at > now() - interval ''1 hour'' limit %s) recent',
    tg_table_name, cap
  ) into n;
  if n >= cap then return null; end if;
  return new;
end;
$function$;

revoke all on function public.tracking_backstop() from public, anon, authenticated;

drop trigger if exists shop_visits_backstop on public.shop_visits;
create trigger shop_visits_backstop
  before insert on public.shop_visits
  for each row execute function public.tracking_backstop('2000');

drop trigger if exists record_events_backstop on public.record_events;
create trigger record_events_backstop
  before insert on public.record_events
  for each row execute function public.tracking_backstop('1000');

-- ---------------------------------------------------------------------
-- 3. Close the direct path. Nobody inserts with the public key or as a
--    signed-in user any more (no admin page writes to these tables); the
--    route writes with the service role, which bypasses RLS. The admin's
--    read policies are untouched.
-- ---------------------------------------------------------------------
drop policy if exists "anon can log events" on public.record_events;
drop policy if exists "anon can log visits" on public.shop_visits;

revoke insert on public.record_events from anon, authenticated;
revoke insert on public.shop_visits from anon, authenticated;
