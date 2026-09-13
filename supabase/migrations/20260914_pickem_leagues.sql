-- NFL joins the pick'em. Games and parlays carry a league so the two feeds'
-- weeks never collide (NFL week 1 is the same days as college week 2), the
-- parlay swap is scoped to a league, and the leaderboard exposes the league so
-- the "this week" column can be filtered. Season totals stay combined across
-- both leagues.

alter table public.pickem_games
  add column league text not null default 'ncaaf' check (league in ('ncaaf', 'nfl'));

alter table public.pickem_parlays
  add column league text not null default 'ncaaf' check (league in ('ncaaf', 'nfl'));

-- A function's parameter list cannot change under create or replace, so the
-- old signature goes first. Execute rights are per signature and default to
-- public on a new function, so the revoke is repeated.
drop function public.pickem_replace_parlays(int, int, jsonb);

create or replace function public.pickem_replace_parlays(p_league text, p_season int, p_week int, p_rows jsonb)
returns table (removed int, inserted int)
language plpgsql
set search_path = ''
as $$
declare
  r int;
  i int;
begin
  perform 1 from public.pickem_parlays
    where league = p_league and season = p_season and week = p_week and locks_at > now()
    for update;

  delete from public.pickem_parlays pl
    where pl.league = p_league and pl.season = p_season and pl.week = p_week and pl.locks_at > now()
      and not exists (select 1 from public.pickem_parlay_tails t where t.parlay_id = pl.id);
  get diagnostics r = row_count;

  insert into public.pickem_parlays (league, season, week, name, legs, american_odds, note, locks_at, hit_probability)
  select p_league, p_season, p_week, x.name, x.legs, x.american_odds, coalesce(x.note, ''), x.locks_at, x.hit_probability
  from jsonb_to_recordset(p_rows)
    as x(name text, legs jsonb, american_odds int, note text, locks_at timestamptz, hit_probability numeric);
  get diagnostics i = row_count;

  return query select r, i;
end
$$;

revoke execute on function public.pickem_replace_parlays(text, int, int, jsonb) from public, anon, authenticated;

-- The old three-argument form stays as a college-only shim so a deploy that
-- still calls it keeps working until the league-aware code ships.
create function public.pickem_replace_parlays(p_season int, p_week int, p_rows jsonb)
returns table (removed int, inserted int)
language sql
set search_path = ''
as $$
  select * from public.pickem_replace_parlays('ncaaf', p_season, p_week, p_rows);
$$;

revoke execute on function public.pickem_replace_parlays(int, int, jsonb) from public, anon, authenticated;

-- Same view with league appended as the last column (create or replace only
-- allows appending). security_invoker and the grant carry over.
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
parlay as (
  select t.user_id, pl.season, pl.week, pl.league,
    case
      when bool_or(lr.result = 'loss') then 'loss'
      when bool_or(lr.result is null) then null
      when bool_and(lr.result = 'win') then 'win'
      else 'push'
    end as result,
    pl.american_odds
  from public.pickem_parlay_tails t
  join public.pickem_parlays pl on pl.id = t.parlay_id
  cross join lateral jsonb_array_elements(pl.legs) leg
  join public.pickem_games g on g.id = leg ->> 'game_id'
  cross join lateral (
    select public.pickem_pick_result(leg ->> 'market', leg ->> 'selection', (leg ->> 'line')::numeric, g.home_score, g.away_score) as result
  ) lr
  group by t.user_id, pl.id, pl.season, pl.week, pl.league, pl.american_odds
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
