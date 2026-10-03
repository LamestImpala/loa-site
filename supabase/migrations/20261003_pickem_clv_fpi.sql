-- Two things for judging the house on more than wins and losses.
--
-- pickem_house_clv      one row per house spread or total call on a game that
--                       has kicked off: the number the house locked, the
--                       closing number, and the difference in points.
-- pickem_house_clv_summary  the same, counted per league, market and tier.
-- pickem_model_lines    what an outside model said about a game on a given
--                       day (ESPN's FPI to start), so "the line moves toward
--                       FPI" can be tested with numbers taken before the move.
--
-- The close is the last pickem_line_history row before kickoff, not
-- pickem_games.spread_home: that column was overwritten with in-game numbers
-- until lines were frozen at kickoff on 2026-10-03. The sync runs a few times
-- a day, so the "close" can be some hours before kickoff.
--
-- clv is positive when the house got a better number than the close: it laid
-- fewer points or took more, went over a total that rose or under one that
-- fell. Every call counts, passes included, because a pass still names a
-- side. Calls made before lines were locked (2026-09-25) have no number of
-- their own and are left out. Moneylines are left out: the locked price is
-- the best book's and the close is a median, so the two do not compare.

create view public.pickem_house_clv with (security_invoker = true) as
with calls as (
  select g.id as game_id, g.league, g.season, g.week, g.commence_time,
    g.home_score, g.away_score, m.market,
    c.call ->> 'pick' as selection,
    (c.call ->> 'confidence')::int as confidence,
    (c.call ->> 'line')::numeric as line,
    case
      when m.market = 'total' then cl.total
      when c.call ->> 'pick' = 'home' then cl.spread_home
      else -cl.spread_home
    end as close_line,
    cl.taken_at as close_taken_at,
    (g.house ->> 'picked_at')::timestamptz as picked_at
  from public.pickem_games g
  cross join (values ('spread'), ('total')) as m(market)
  cross join lateral (select g.house -> m.market as call) c
  cross join lateral (
    select h.spread_home, h.total, h.taken_at
    from public.pickem_line_history h
    where h.game_id = g.id and h.taken_at < g.commence_time
    order by h.taken_at desc
    limit 1
  ) cl
  where g.commence_time <= now()
    and c.call ->> 'line' is not null
    and case when m.market = 'total'
          then c.call ->> 'pick' in ('over', 'under')
          else c.call ->> 'pick' in ('home', 'away') end
)
select game_id, league, season, week, commence_time, market, selection, confidence,
  case when confidence >= 8 then 'best' when confidence = 7 then 'like'
       when confidence = 6 then 'lean' else 'pass' end as tier,
  line, close_line,
  case when market = 'total' and selection = 'over' then close_line - line
       else line - close_line end as clv,
  picked_at, close_taken_at,
  public.pickem_pick_result(market, selection, line, home_score, away_score) as result
from calls
where close_line is not null;

create view public.pickem_house_clv_summary with (security_invoker = true) as
select league, season, market, tier,
  count(*) as calls,
  count(*) filter (where clv > 0) as beat_close,
  count(*) filter (where clv < 0) as lost_to_close,
  count(*) filter (where clv = 0) as same_as_close,
  round(avg(clv), 2) as avg_clv,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  count(*) filter (where result = 'push') as pushes
from public.pickem_house_clv
group by league, season, market, tier;

grant select on public.pickem_house_clv to anon, authenticated;
grant select on public.pickem_house_clv_summary to anon, authenticated;

-- home_margin is points the home team is predicted to win by (negative when
-- the away team is favoured), so it compares with -spread_home.
-- source_updated_at is the model's own stamp, which says whether a row is a
-- new prediction or the same one seen again.
create table public.pickem_model_lines (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  source text not null,
  taken_at timestamptz not null default now(),
  home_margin numeric,
  home_win_prob numeric,
  source_updated_at timestamptz
);
create index pickem_model_lines_game_idx on public.pickem_model_lines (game_id, source, taken_at);

-- Research data: written and read by the service role only.
alter table public.pickem_model_lines enable row level security;
