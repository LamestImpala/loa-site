-- Slip import: a player uploads a screenshot of a sportsbook bet slip, Claude
-- reads it, and the bets are saved against the player. Apply in the Supabase
-- SQL editor.
--
-- pickem_user_parlays  a player's own parlay, graded as one ticket.
-- pickem_wagers        the dollar stake and book behind a pick or a parlay.
--                      Private to its owner: picks become public at kickoff
--                      and RLS cannot hide a column, so it is its own table.
-- pickem_slip_imports  one row per screenshot read, for the daily cap.
-- pickem_import_bet()  saves one bet from a slip in a single transaction.

create table public.pickem_user_parlays (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  league text not null check (league in ('ncaaf', 'nfl')),
  season int not null,
  week int not null,
  -- Same shape as pickem_parlays.legs: game_id, market, selection, line, price, label.
  legs jsonb not null,
  leg_count int generated always as (jsonb_array_length(legs)) stored,
  american_odds int not null,
  locks_at timestamptz not null, -- earliest leg kickoff
  -- Sorted legs joined, so the same slip uploaded twice is one ticket.
  signature text not null,
  created_at timestamptz not null default now(),
  unique (user_id, signature)
);
create index pickem_user_parlays_week_idx on public.pickem_user_parlays (season, week);

create table public.pickem_wagers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pick_id bigint unique references public.pickem_picks (id) on delete cascade,
  user_parlay_id bigint unique references public.pickem_user_parlays (id) on delete cascade,
  book text,
  stake numeric not null check (stake > 0),
  created_at timestamptz not null default now(),
  check ((pick_id is null) <> (user_parlay_id is null))
);
create index pickem_wagers_user_idx on public.pickem_wagers (user_id);

create table public.pickem_slip_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index pickem_slip_imports_user_idx on public.pickem_slip_imports (user_id, created_at);

alter table public.pickem_user_parlays enable row level security;
alter table public.pickem_wagers enable row level security;
alter table public.pickem_slip_imports enable row level security;

-- Same visibility as picks: yours always, everyone's once the first leg kicks
-- off. Rows are only written by pickem_import_bet.
create policy "read own parlays or locked parlays" on public.pickem_user_parlays
  for select to anon, authenticated using (user_id = (select auth.uid()) or locks_at <= now());
create policy "users delete own parlays before lock" on public.pickem_user_parlays
  for delete to authenticated using (user_id = (select auth.uid()) and locks_at > now());

create policy "users read own wagers" on public.pickem_wagers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users delete own wagers" on public.pickem_wagers
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "users read own slip imports" on public.pickem_slip_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users log own slip imports" on public.pickem_slip_imports
  for insert to authenticated with check (user_id = (select auth.uid()));

-- A stake belongs to the bet as it was placed. When the pick under it changes
-- (the player re-taps the board), the stake no longer describes it.
create function public.pickem_pick_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pickem_wagers where pick_id = new.id;
  return null;
end;
$$;
create trigger pickem_picks_drop_stale_wager
  after update on public.pickem_picks
  for each row
  when (old.selection is distinct from new.selection or old.line is distinct from new.line or old.price is distinct from new.price)
  execute function public.pickem_pick_changed();

-- Save one bet read off a slip. p_bet:
--   { kind: 'straight' | 'parlay', book, stake, american_odds, leg_count,
--     legs: [{ game_id, market, selection, line, price, label }] }
-- Every leg on a game that has not kicked off becomes a pick at the slip's
-- line and price, replacing any pick the player had on that game and market.
-- A parlay is also saved as one ticket, but only when every leg on the slip
-- (leg_count) was saved: a ticket with a leg we cannot grade is not a ticket.
-- The stake goes on the ticket for a parlay and on the pick for a straight
-- bet. Runs as definer because players have no insert policy on parlays or
-- wagers; the checks RLS would make on picks are made here.
create function public.pickem_import_bet(p_bet jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := p_bet ->> 'kind';
  v_book text := nullif(left(coalesce(p_bet ->> 'book', ''), 40), '');
  v_stake numeric := (p_bet ->> 'stake')::numeric;
  v_odds int := (p_bet ->> 'american_odds')::int;
  v_count int;
  v_leg jsonb;
  v_game public.pickem_games%rowtype;
  v_first public.pickem_games%rowtype;
  v_market text;
  v_sel text;
  v_line numeric;
  v_price int;
  v_reason text;
  v_pick_id bigint;
  v_results jsonb := '[]'::jsonb;
  v_saved jsonb := '[]'::jsonb;
  v_parlay text := 'none';
  v_parlay_id bigint;
  v_sig text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.pickem_profiles where user_id = v_uid) then
    raise exception 'no pickem profile';
  end if;
  if v_kind is null or v_kind not in ('straight', 'parlay') then
    raise exception 'unknown bet kind';
  end if;
  if jsonb_typeof(p_bet -> 'legs') is distinct from 'array' then
    raise exception 'legs must be an array';
  end if;
  v_count := jsonb_array_length(p_bet -> 'legs');
  if v_count < 1 or v_count > 20 or (v_kind = 'straight' and v_count <> 1) then
    raise exception 'wrong number of legs';
  end if;
  if v_stake is not null and (v_stake <= 0 or v_stake > 1000000) then
    v_stake := null;
  end if;

  for v_leg in select * from jsonb_array_elements(p_bet -> 'legs') loop
    v_market := v_leg ->> 'market';
    v_sel := v_leg ->> 'selection';
    v_line := (v_leg ->> 'line')::numeric;
    v_price := (v_leg ->> 'price')::int;
    v_reason := null;
    select * into v_game from public.pickem_games where id = v_leg ->> 'game_id';
    if not found then
      v_reason := 'not_on_board';
    elsif v_game.commence_time <= now() then
      v_reason := 'started';
    elsif not coalesce(
        (v_market in ('spread', 'ml') and v_sel in ('home', 'away'))
        or (v_market = 'total' and v_sel in ('over', 'under')), false)
      or (v_market = 'ml') <> (v_line is null)
      or v_price is null or abs(v_price) < 100 or abs(v_price) > 100000 then
      v_reason := 'invalid';
    end if;

    if v_reason is null then
      insert into public.pickem_picks (user_id, game_id, market, selection, line, price)
      values (v_uid, v_game.id, v_market, v_sel, v_line, v_price)
      on conflict (user_id, game_id, market) do update
        set selection = excluded.selection, line = excluded.line, price = excluded.price, updated_at = now()
      returning id into v_pick_id;
      if v_kind = 'straight' and v_stake is not null then
        insert into public.pickem_wagers (user_id, pick_id, book, stake)
        values (v_uid, v_pick_id, v_book, v_stake)
        on conflict (pick_id) do update set book = excluded.book, stake = excluded.stake;
      end if;
      v_saved := v_saved || jsonb_build_object(
        'game_id', v_game.id, 'market', v_market, 'selection', v_sel, 'line', v_line, 'price', v_price,
        'label', left(coalesce(v_leg ->> 'label', ''), 80));
      if v_first.id is null or v_game.commence_time < v_first.commence_time then
        v_first := v_game;
      end if;
    end if;
    v_results := v_results || jsonb_build_object(
      'game_id', v_leg ->> 'game_id', 'market', v_market,
      'status', case when v_reason is null then 'saved' else 'skipped' end, 'reason', v_reason);
  end loop;

  if v_kind = 'parlay' then
    if jsonb_array_length(v_saved) < 2
      or jsonb_array_length(v_saved) <> coalesce((p_bet ->> 'leg_count')::int, v_count)
      or v_odds is null or abs(v_odds) < 100 then
      v_parlay := 'incomplete';
    else
      select string_agg(s.k, '|' order by s.k) into v_sig
      from (
        select (l ->> 'game_id') || ':' || (l ->> 'market') || ':' || (l ->> 'selection') as k
        from jsonb_array_elements(v_saved) l
      ) s;
      insert into public.pickem_user_parlays (user_id, league, season, week, legs, american_odds, locks_at, signature)
      values (v_uid, v_first.league, v_first.season, v_first.week, v_saved, v_odds, v_first.commence_time, v_sig)
      on conflict (user_id, signature) do nothing
      returning id into v_parlay_id;
      if v_parlay_id is null then
        v_parlay := 'duplicate';
      else
        v_parlay := 'saved';
        if v_stake is not null then
          insert into public.pickem_wagers (user_id, user_parlay_id, book, stake)
          values (v_uid, v_parlay_id, v_book, v_stake);
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('legs', v_results, 'parlay', v_parlay, 'parlay_id', v_parlay_id);
end;
$$;
revoke execute on function public.pickem_import_bet(jsonb) from public, anon;
grant execute on function public.pickem_import_bet(jsonb) to authenticated;

-- Leaderboard: a player's own parlay counts like a tailed house parlay, one
-- unit at the ticket's combined price. Same columns, so the grant carries over.
create or replace view public.pickem_leaderboard with (security_invoker = true) as
with straight as (
  select p.user_id, g.season, g.week, g.league, r.result,
    public.pickem_units(r.result, p.price) as units
  from public.pickem_picks p
  join public.pickem_games g on g.id = p.game_id
  cross join lateral (
    select public.pickem_pick_result(p.market, p.selection, p.line, g.home_score, g.away_score) as result
  ) r
  where g.completed
),
tickets as (
  select t.user_id, 'house' as source, pl.id, pl.season, pl.week, pl.league, pl.legs, pl.american_odds
  from public.pickem_parlay_tails t
  join public.pickem_parlays pl on pl.id = t.parlay_id
  union all
  select up.user_id, 'own', up.id, up.season, up.week, up.league, up.legs, up.american_odds
  from public.pickem_user_parlays up
),
parlay as (
  select tk.user_id, tk.season, tk.week, tk.league,
    case
      when bool_or(lr.result = 'loss') then 'loss'
      when bool_or(lr.result is null) then null
      when bool_and(lr.result = 'win') then 'win'
      else 'push'
    end as result,
    tk.american_odds
  from tickets tk
  cross join lateral jsonb_array_elements(tk.legs) leg
  join public.pickem_games g on g.id = leg ->> 'game_id'
  cross join lateral (
    select public.pickem_pick_result(leg ->> 'market', leg ->> 'selection', (leg ->> 'line')::numeric, g.home_score, g.away_score) as result
  ) lr
  group by tk.user_id, tk.source, tk.id, tk.season, tk.week, tk.league, tk.american_odds
),
all_rows as (
  select user_id, season, week, league, result, units from straight
  union all
  select user_id, season, week, league, result, public.pickem_units(result, american_odds) from parlay
)
select a.user_id, pr.display_name, a.season, a.week,
  count(*) filter (where a.result = 'win') as wins,
  count(*) filter (where a.result = 'loss') as losses,
  count(*) filter (where a.result = 'push') as pushes,
  coalesce(sum(a.units), 0) as units,
  a.league
from all_rows a
join public.pickem_profiles pr on pr.user_id = a.user_id
where a.result is not null
group by a.user_id, pr.display_name, a.season, a.week, a.league;
