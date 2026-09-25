-- The house plays its own calls. Every call at confidence 6 or better is a
-- play: 1 unit on a 6 (lean), 2 on a 7 (like), 3 on 8 and up (best bet). The
-- number and price are locked into the house jsonb when the call is made
-- (lockLines in lib/pickem-server.ts); rows written before that fall back to
-- the game's stored line and best price, which for a finished game is the
-- closing number. Wins, losses and pushes count calls; units are staked.
--
-- Readable by everyone, like pickem_games; security_invoker so the games
-- policy applies. A new view rather than a change to pickem_leaderboard,
-- which is keyed by a real user_id and can only append columns.
-- lib/pickem-house.ts (houseWeekRecord) mirrors this for the client.

create view public.pickem_house_record with (security_invoker = true) as
with calls as (
  select g.league, g.season, g.week, g.home_score, g.away_score, m.market,
    c.call ->> 'pick' as selection,
    (c.call ->> 'confidence')::int as confidence,
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
      -110) as price
  from public.pickem_games g
  cross join (values ('spread'), ('total'), ('ml')) as m(market)
  cross join lateral (select g.house -> m.market as call) c
  where g.completed
    and c.call is not null
    and (c.call ->> 'confidence')::int >= 6
    and case when m.market = 'total'
          then c.call ->> 'pick' in ('over', 'under')
          else c.call ->> 'pick' in ('home', 'away') end
),
graded as (
  select league, season, week, r.result,
    case when confidence >= 8 then 3 when confidence = 7 then 2 else 1 end as stake,
    public.pickem_units(r.result, price) as units
  from calls
  cross join lateral (
    select public.pickem_pick_result(market, selection, line, home_score, away_score) as result
  ) r
)
select league, season, week,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  count(*) filter (where result = 'push') as pushes,
  coalesce(sum(units * stake), 0) as units
from graded
where result is not null
group by league, season, week;

grant select on public.pickem_house_record to anon, authenticated;
