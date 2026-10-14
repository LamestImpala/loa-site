-- The house's own record, by the kind of call, so it can be fed back to the
-- house and so stakes and parlay odds come from results instead of from the
-- probabilities the prompt asserts (6 ≈ 55%, 7 ≈ 58%).
--
-- pickem_house_graded       one row per market of the latest call on every
--                           completed game: its confidence, basis, prompt,
--                           locked number, closing number, CLV and result.
-- pickem_house_calibration  that, counted per league, market, confidence,
--                           basis and prompt version. The board reads it
--                           (stakes on the House Card), the house reads it
--                           (the record block in its prompt), and so does the
--                           admin page.
-- pickem_house_graded_all, pickem_house_calibration_all
--                           the same over every call ever made, re-picks
--                           included, for research. Not readable by the board.
-- pickem_house_last_week    every call from each league's most recent finished
--                           week, with CLV and result, shown to the house.
-- pickem_house_record       replaced: stakes are now earned (see below).
--
-- "Latest call" is pickem_games.house, not the newest pickem_house_calls row.
-- The two are written together, but pickem_house_calls only starts on
-- 2026-10-04 and has nothing for most of the season's completed games, and
-- pickem_games is public, so the board's stakes and this view agree for
-- anyone. Columns the older calls lack read 'untagged' (basis) and
-- 'unversioned' (prompt_version).
--
-- Grading is pickem_house_record's: the locked line and price, or for a call
-- made before locking the game's stored line and best price (the closing
-- number), else -110. CLV is pickem_house_clv's: the locked line against the
-- last pickem_line_history row before kickoff, positive when the house beat
-- the close; null for a moneyline and for a call without a locked line.
-- win_pct leaves pushes out. clv_points is the sum behind avg_clv, so groups
-- can be added up exactly (lib/pickem.ts tallyCalibration). units are at the tier's nominal stake (0 on a
-- pass, 1, 2, 3); units_flat are 1u on every call, passes included.
--
-- Earned stakes: a 7 stakes 2u and an 8+ 3u only once that confidence has 50
-- or more completed spread and total calls in the league and season, winning
-- 55% or more of those decided (20 * wins >= 11 * (wins + losses), the same
-- integer test as effectiveStake in lib/pickem-house.ts). Until then every
-- call at 6+ stakes 1u. The test reads today's calibration, so a tier that
-- qualifies (or stops qualifying) restates the season's units.

create view public.pickem_house_graded with (security_invoker = true) as
with calls as (
  select g.id as game_id, g.league, g.season, g.week, g.commence_time,
    g.home_team, g.away_team, g.home_score, g.away_score, m.market,
    c.call ->> 'pick' as selection,
    (c.call ->> 'confidence')::int as confidence,
    coalesce(c.call ->> 'basis', 'untagged') as basis,
    coalesce(g.house ->> 'prompt_version', 'unversioned') as prompt_version,
    g.house ->> 'variant' as variant,
    (g.house ->> 'picked_at')::timestamptz as picked_at,
    c.call ->> 'why' as why,
    (c.call ->> 'line')::numeric as locked_line,
    case m.market
      when 'ml' then null::numeric
      when 'total' then coalesce((c.call ->> 'line')::numeric, g.total)
      else coalesce((c.call ->> 'line')::numeric,
        case when c.call ->> 'pick' = 'home' then g.spread_home else -g.spread_home end)
    end as line,
    coalesce((c.call ->> 'price')::int,
      case m.market
        when 'ml' then case when c.call ->> 'pick' = 'home' then g.ml_home else g.ml_away end
        when 'total' then (g.best -> (c.call ->> 'pick') ->> 'price')::int
        else (g.best -> ('spread_' || (c.call ->> 'pick')) ->> 'price')::int
      end,
      -110) as price,
    case
      when m.market = 'ml' then null::numeric
      when m.market = 'total' then cl.total
      when c.call ->> 'pick' = 'home' then cl.spread_home
      else -cl.spread_home
    end as close_line
  from public.pickem_games g
  cross join (values ('spread'), ('total'), ('ml')) as m(market)
  cross join lateral (select g.house -> m.market as call) c
  left join lateral (
    select h.spread_home, h.total
    from public.pickem_line_history h
    where h.game_id = g.id and h.taken_at < g.commence_time
    order by h.taken_at desc
    limit 1
  ) cl on true
  where g.completed
    and c.call is not null
    and case when m.market = 'total'
          then c.call ->> 'pick' in ('over', 'under')
          else c.call ->> 'pick' in ('home', 'away') end
)
select game_id, league, season, week, commence_time, home_team, away_team, market,
  selection, confidence, basis, prompt_version, variant, picked_at, why, line, price,
  case when locked_line is null then null else close_line end as close_line,
  case when locked_line is null or close_line is null then null
       when market = 'total' and selection = 'over' then close_line - locked_line
       else locked_line - close_line end as clv,
  case when confidence >= 8 then 3 when confidence = 7 then 2
       when confidence = 6 then 1 else 0 end as stake,
  r.result,
  public.pickem_units(r.result, price) as units_flat
from calls
cross join lateral (
  select public.pickem_pick_result(market, selection, line, home_score, away_score) as result
) r
where r.result is not null;

create view public.pickem_house_calibration with (security_invoker = true) as
select league, season, market, confidence, basis, prompt_version,
  count(*) as calls,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  count(*) filter (where result = 'push') as pushes,
  round(count(*) filter (where result = 'win')::numeric
    / nullif(count(*) filter (where result in ('win', 'loss')), 0), 3) as win_pct,
  count(clv) as clv_calls,
  coalesce(sum(clv), 0) as clv_points,
  round(avg(clv), 2) as avg_clv,
  round(sum(units_flat * stake), 2) as units,
  round(sum(units_flat), 2) as units_flat
from public.pickem_house_graded
group by league, season, market, confidence, basis, prompt_version;

-- Every call, re-picks included. A game with no pickem_house_calls row (all
-- of them before 2026-10-04) contributes its pickem_games.house call.
create view public.pickem_house_graded_all with (security_invoker = true) as
with runs as (
  select c.game_id, c.picked_at, c.house from public.pickem_house_calls c
  union all
  select g.id, coalesce((g.house ->> 'picked_at')::timestamptz, g.commence_time), g.house
  from public.pickem_games g
  where g.house is not null
    and not exists (select 1 from public.pickem_house_calls c where c.game_id = g.id)
),
calls as (
  select g.id as game_id, g.league, g.season, g.week, g.home_score, g.away_score, m.market,
    runs.picked_at,
    c.call ->> 'pick' as selection,
    (c.call ->> 'confidence')::int as confidence,
    coalesce(c.call ->> 'basis', 'untagged') as basis,
    coalesce(runs.house ->> 'prompt_version', 'unversioned') as prompt_version,
    runs.house ->> 'variant' as variant,
    (c.call ->> 'line')::numeric as locked_line,
    case m.market
      when 'ml' then null::numeric
      when 'total' then coalesce((c.call ->> 'line')::numeric, g.total)
      else coalesce((c.call ->> 'line')::numeric,
        case when c.call ->> 'pick' = 'home' then g.spread_home else -g.spread_home end)
    end as line,
    coalesce((c.call ->> 'price')::int,
      case m.market
        when 'ml' then case when c.call ->> 'pick' = 'home' then g.ml_home else g.ml_away end
        when 'total' then (g.best -> (c.call ->> 'pick') ->> 'price')::int
        else (g.best -> ('spread_' || (c.call ->> 'pick')) ->> 'price')::int
      end,
      -110) as price,
    case
      when m.market = 'ml' then null::numeric
      when m.market = 'total' then cl.total
      when c.call ->> 'pick' = 'home' then cl.spread_home
      else -cl.spread_home
    end as close_line
  from runs
  join public.pickem_games g on g.id = runs.game_id
  cross join (values ('spread'), ('total'), ('ml')) as m(market)
  cross join lateral (select runs.house -> m.market as call) c
  left join lateral (
    select h.spread_home, h.total
    from public.pickem_line_history h
    where h.game_id = g.id and h.taken_at < g.commence_time
    order by h.taken_at desc
    limit 1
  ) cl on true
  where g.completed
    and c.call is not null
    and case when m.market = 'total'
          then c.call ->> 'pick' in ('over', 'under')
          else c.call ->> 'pick' in ('home', 'away') end
)
select game_id, league, season, week, picked_at, market, selection, confidence, basis,
  prompt_version, variant, line, price,
  case when locked_line is null then null else close_line end as close_line,
  case when locked_line is null or close_line is null then null
       when market = 'total' and selection = 'over' then close_line - locked_line
       else locked_line - close_line end as clv,
  case when confidence >= 8 then 3 when confidence = 7 then 2
       when confidence = 6 then 1 else 0 end as stake,
  r.result,
  public.pickem_units(r.result, price) as units_flat
from calls
cross join lateral (
  select public.pickem_pick_result(market, selection, line, home_score, away_score) as result
) r
where r.result is not null;

create view public.pickem_house_calibration_all with (security_invoker = true) as
select league, season, market, confidence, basis, prompt_version,
  count(*) as calls,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  count(*) filter (where result = 'push') as pushes,
  round(count(*) filter (where result = 'win')::numeric
    / nullif(count(*) filter (where result in ('win', 'loss')), 0), 3) as win_pct,
  count(clv) as clv_calls,
  coalesce(sum(clv), 0) as clv_points,
  round(avg(clv), 2) as avg_clv,
  round(sum(units_flat * stake), 2) as units,
  round(sum(units_flat), 2) as units_flat
from public.pickem_house_graded_all
group by league, season, market, confidence, basis, prompt_version;

-- The latest week per league in which every game the house called has kicked
-- off and at least one has a final. Unfinished games (postponed, or not yet
-- graded) are listed with a null result.
create view public.pickem_house_last_week with (security_invoker = true) as
with weeks as (
  select league, season, week
  from public.pickem_games
  where house is not null
  group by league, season, week
  having max(commence_time) <= now() and bool_or(completed)
),
latest as (
  select distinct on (league) league, season, week
  from weeks
  order by league, season desc, week desc
)
select g.league, g.season, g.week, g.id as game_id,
  g.away_team || ' @ ' || g.home_team as matchup, g.commence_time, m.market,
  c.call ->> 'pick' as selection,
  (c.call ->> 'confidence')::int as confidence,
  coalesce(c.call ->> 'basis', 'untagged') as basis,
  (c.call ->> 'line')::numeric as line,
  (c.call ->> 'price')::int as price,
  gr.close_line, gr.clv, gr.result,
  left(c.call ->> 'why', 120) as why
from latest l
join public.pickem_games g on g.league = l.league and g.season = l.season and g.week = l.week
cross join (values ('spread'), ('total'), ('ml')) as m(market)
cross join lateral (select g.house -> m.market as call) c
left join public.pickem_house_graded gr on gr.game_id = g.id and gr.market = m.market
where c.call is not null;

-- Same output as before; stakes are now earned per the header.
create or replace view public.pickem_house_record with (security_invoker = true) as
with earned as (
  select league, season, confidence
  from public.pickem_house_graded
  where market in ('spread', 'total')
  group by league, season, confidence
  having count(*) >= 50
    and 20 * count(*) filter (where result = 'win')
      >= 11 * count(*) filter (where result in ('win', 'loss'))
)
select g.league, g.season, g.week,
  count(*) filter (where g.result = 'win') as wins,
  count(*) filter (where g.result = 'loss') as losses,
  count(*) filter (where g.result = 'push') as pushes,
  coalesce(sum(g.units_flat * case when e.confidence is null then 1 else g.stake end), 0) as units
from public.pickem_house_graded g
left join earned e on e.league = g.league and e.season = g.season and e.confidence = g.confidence
where g.confidence >= 6
group by g.league, g.season, g.week;

-- Every run stores the record it was shown, so a call can be audited against it.
alter table public.pickem_house_calls add column feedback text;

-- The board reads calibration (House Card stakes); the rest is for the house
-- job (service role) and the admin page. The *_all views read
-- pickem_house_calls, which only the service role can see; they are revoked
-- here so nobody reads a half-empty version of them.
grant select on public.pickem_house_graded to anon, authenticated;
grant select on public.pickem_house_calibration to anon, authenticated;
grant select on public.pickem_house_last_week to anon, authenticated;
revoke all on public.pickem_house_graded_all from anon, authenticated;
revoke all on public.pickem_house_calibration_all from anon, authenticated;
