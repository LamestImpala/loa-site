-- The price engine, in shadow (lib/pickem-engine.ts). Every line sync stores
-- each game's per-book lines and locks any play or lean the engine finds: a
-- regulated book's number that beats Pinnacle's no-vig price. Nothing on the
-- board reads these; the admin page compares the engine with the house.

-- Per-book spread and total for one game at one sync, Pinnacle included:
-- { "<book key>": { "u": last update, "s": [home points, home price, away
-- price], "t": [total, over price, under price] } }. Kept so a different
-- rule (another threshold, other books) can be replayed over the same lines.
create table public.pickem_book_lines (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  taken_at timestamptz not null default now(),
  books jsonb not null
);
create index pickem_book_lines_game_idx on public.pickem_book_lines (game_id, taken_at desc);

-- One row per game, market and tier, locked the first time it appears and
-- never moved. tier 'play': expected value of 2% or more, staked. tier
-- 'lean': above zero and under 2%, tracked at no stake. line is the side's
-- spread or the total at that book; pinnacle is what it was measured against.
-- close_line and close_ev are filled once the game has kicked off: Pinnacle's
-- last pre-game line for the side, and the locked line and price valued
-- against Pinnacle's closing no-vig price (above zero beat the close).
create table public.pickem_engine_plays (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  league text not null,
  season int not null,
  week int not null,
  market text not null check (market in ('spread', 'total')),
  selection text not null check (selection in ('home', 'away', 'over', 'under')),
  tier text not null check (tier in ('play', 'lean')),
  book_key text not null,
  book text not null,
  line numeric not null,
  price int not null,
  win_prob numeric not null,
  push_prob numeric not null,
  ev numeric not null,
  stake int not null,
  pinnacle jsonb not null,
  found_at timestamptz not null,
  close_line numeric,
  close_ev numeric,
  closed_at timestamptz,
  unique (game_id, market, tier)
);
create index pickem_engine_plays_league_idx on public.pickem_engine_plays (league, season, week);

-- Written by the sync (service role). Read by the admin page, signed in as
-- the owner, the same test pickem_job_runs uses.
alter table public.pickem_book_lines enable row level security;
create policy "admin reads book lines" on public.pickem_book_lines
  for select
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
grant select on public.pickem_book_lines to authenticated;

alter table public.pickem_engine_plays enable row level security;
create policy "admin reads engine plays" on public.pickem_engine_plays
  for select
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
grant select on public.pickem_engine_plays to authenticated;

-- The fade-FPI view below reads the stored FPI numbers as the admin.
create policy "admin reads model lines" on public.pickem_model_lines
  for select
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
grant select on public.pickem_model_lines to authenticated;

-- Every engine play and lean with its game and, once the game is final, its
-- result at its own line and price.
create view public.pickem_engine_graded with (security_invoker = true) as
select
  p.id, p.game_id, p.league, p.season, p.week, g.commence_time, g.home_team, g.away_team,
  p.market, p.selection, p.tier, p.book, p.line, p.price, p.ev, p.stake, p.found_at,
  p.close_line, p.close_ev, p.closed_at,
  r.result,
  public.pickem_units(r.result, p.price) as units_flat,
  p.stake * public.pickem_units(r.result, p.price) as units
from public.pickem_engine_plays p
join public.pickem_games g on g.id = p.game_id
cross join lateral (
  select case when g.completed then public.pickem_pick_result(p.market, p.selection, p.line, g.home_score, g.away_score) end as result
) r;
grant select on public.pickem_engine_graded to authenticated;

-- A paper record for a second idea from the same review: when ESPN's FPI
-- disagrees with the consensus spread by 5 points or more, take the market's
-- side at that consensus, -110. Locked the first time the gap appears. Only
-- games from 2026-11-13 on count, since the idea came from the games before.
create view public.pickem_shadow_fade_fpi with (security_invoker = true) as
with first_gap as (
  select distinct on (m.game_id) m.game_id, m.taken_at, m.home_margin, h.spread_home
  from public.pickem_model_lines m
  join public.pickem_games g on g.id = m.game_id
  cross join lateral (
    select lh.spread_home
    from public.pickem_line_history lh
    where lh.game_id = m.game_id and lh.taken_at <= m.taken_at
    order by lh.taken_at desc
    limit 1
  ) h
  where m.source = 'fpi'
    and m.home_margin is not null
    and h.spread_home is not null
    and m.taken_at < g.commence_time
    and g.commence_time >= timestamptz '2026-11-13 00:00+00'
    and abs(m.home_margin + h.spread_home) >= 5
  order by m.game_id, m.taken_at
),
calls as (
  select f.game_id, f.taken_at as found_at, f.home_margin as fpi_home_margin,
    -- FPI likes the home team more than the line does: the market's side is the away team.
    case when f.home_margin + f.spread_home > 0 then 'away' else 'home' end as selection,
    case when f.home_margin + f.spread_home > 0 then -f.spread_home else f.spread_home end as line
  from first_gap f
)
select
  c.game_id, g.league, g.season, g.week, g.commence_time, g.home_team, g.away_team,
  'spread'::text as market, c.selection, c.line, -110 as price, c.fpi_home_margin, c.found_at,
  r.result,
  public.pickem_units(r.result, -110) as units_flat
from calls c
join public.pickem_games g on g.id = c.game_id
cross join lateral (
  select case when g.completed then public.pickem_pick_result('spread', c.selection, c.line, g.home_score, g.away_score) end as result
) r;
grant select on public.pickem_shadow_fade_fpi to authenticated;

-- The shadow strategies side by side, per league, over the same games (those
-- kicking off from 2026-11-13). picks counts everything locked; the record is
-- of finished games. closed and beat_close: for the engine, picks with a
-- closing Pinnacle price and those whose expected value against it was above
-- zero; for the house, calls with a closing line and those that beat it in
-- points. avg_ev and avg_close_ev are the engine's only.
create view public.pickem_engine_summary with (security_invoker = true) as
select
  e.league,
  'engine ' || e.tier as strategy,
  count(*) as picks,
  count(*) filter (where e.result = 'win') as wins,
  count(*) filter (where e.result = 'loss') as losses,
  count(*) filter (where e.result = 'push') as pushes,
  round(coalesce(sum(e.units), 0), 2) as units,
  round(coalesce(sum(e.units_flat), 0), 2) as units_flat,
  round(avg(e.ev), 4) as avg_ev,
  count(e.close_ev) as closed,
  count(*) filter (where e.close_ev > 0) as beat_close,
  round(avg(e.close_ev), 4) as avg_close_ev
from public.pickem_engine_graded e
where e.commence_time >= timestamptz '2026-11-13 00:00+00'
group by e.league, e.tier
union all
select
  h.league,
  'house',
  count(*),
  count(*) filter (where h.result = 'win'),
  count(*) filter (where h.result = 'loss'),
  count(*) filter (where h.result = 'push'),
  round(coalesce(sum(h.units_flat * h.stake), 0), 2),
  round(coalesce(sum(h.units_flat), 0), 2),
  null,
  count(h.clv),
  count(*) filter (where h.clv > 0),
  null
from public.pickem_house_graded h
where h.confidence >= 6
  and h.market in ('spread', 'total')
  and h.commence_time >= timestamptz '2026-11-13 00:00+00'
group by h.league
union all
select
  f.league,
  'fade fpi',
  count(*),
  count(*) filter (where f.result = 'win'),
  count(*) filter (where f.result = 'loss'),
  count(*) filter (where f.result = 'push'),
  round(coalesce(sum(f.units_flat), 0), 2),
  round(coalesce(sum(f.units_flat), 0), 2),
  null,
  0,
  0,
  null
from public.pickem_shadow_fade_fpi f
group by f.league;
grant select on public.pickem_engine_summary to authenticated;
