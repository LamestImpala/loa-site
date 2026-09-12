-- College football pick'em.
--
-- pickem_games      one row per featured game; consensus + best lines from The
--                   Odds API, opening numbers for movement, house picks, scores.
-- pickem_line_history  every line snapshot the sync job takes (movement charts).
-- pickem_parlays    house-recommended parlays for a week; users can "tail" one.
-- pickem_profiles   display name per auth user (the only public identity).
-- pickem_picks      one row per user + game + market; the line/price is locked
--                   at pick time and the row cannot change after kickoff.
-- pickem_parlay_tails  user tailed a house parlay (locks at the first kickoff).
--
-- Scoring is in units: every pick risks 1 unit at the locked price. A win pays
-- the American-odds return, a loss is -1, a push is 0. The leaderboard view
-- sums units and W-L-P per user per week.

create table public.pickem_games (
  id text primary key, -- The Odds API event id
  season int not null,
  week int not null,
  commence_time timestamptz not null,
  home_team text not null,
  away_team text not null,
  spread_home numeric, -- consensus (median across books); away is the negation
  total numeric,
  ml_home int,
  ml_away int,
  open_spread_home numeric, -- first numbers we saw; movement = current - open
  open_total numeric,
  open_ml_home int,
  open_ml_away int,
  best jsonb not null default '{}'::jsonb, -- best available number per side, with book
  house jsonb, -- house picks: {spread:{pick,confidence,why}, total:{...}, ml:{...}}
  home_score int,
  away_score int,
  completed boolean not null default false,
  lines_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pickem_games_week_idx on public.pickem_games (season, week, commence_time);

create table public.pickem_line_history (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  taken_at timestamptz not null default now(),
  spread_home numeric,
  total numeric,
  ml_home int,
  ml_away int
);
create index pickem_line_history_game_idx on public.pickem_line_history (game_id, taken_at);

create table public.pickem_parlays (
  id bigint generated always as identity primary key,
  season int not null,
  week int not null,
  name text not null,
  legs jsonb not null, -- [{game_id, market, selection, line, price, label}]
  american_odds int not null,
  confidence int,
  note text not null default '',
  locks_at timestamptz not null, -- earliest leg kickoff
  created_at timestamptz not null default now()
);
create index pickem_parlays_week_idx on public.pickem_parlays (season, week);

create table public.pickem_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  created_at timestamptz not null default now()
);

create table public.pickem_picks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null references public.pickem_games (id) on delete cascade,
  market text not null check (market in ('spread', 'total', 'ml')),
  selection text not null check (selection in ('home', 'away', 'over', 'under')),
  -- spread: the picked side's own number (home -3 => -3, away +3 => +3)
  -- total: the total; ml: null
  line numeric,
  price int not null default -110,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game_id, market)
);
create index pickem_picks_game_idx on public.pickem_picks (game_id);

create table public.pickem_parlay_tails (
  user_id uuid not null references auth.users (id) on delete cascade,
  parlay_id bigint not null references public.pickem_parlays (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, parlay_id)
);

-- Grade one pick against a final score. Returns win / loss / push, or null
-- while the game is unscored.
create or replace function public.pickem_pick_result(
  market text, selection text, line numeric, home_score int, away_score int
) returns text
language sql immutable as $$
  select case
    when home_score is null or away_score is null then null
    when market = 'ml' then
      case
        when home_score = away_score then 'push'
        when (selection = 'home') = (home_score > away_score) then 'win'
        else 'loss'
      end
    when market = 'spread' then
      case
        when (case when selection = 'home' then home_score - away_score else away_score - home_score end) + line > 0 then 'win'
        when (case when selection = 'home' then home_score - away_score else away_score - home_score end) + line = 0 then 'push'
        else 'loss'
      end
    when market = 'total' then
      case
        when home_score + away_score = line then 'push'
        when (selection = 'over') = (home_score + away_score > line) then 'win'
        else 'loss'
      end
  end
$$;

-- Units won or lost on a 1-unit stake at an American price.
create or replace function public.pickem_units(result text, price int) returns numeric
language sql immutable as $$
  select case result
    when 'win' then case when price > 0 then price / 100.0 else 100.0 / abs(price) end
    when 'loss' then -1
    when 'push' then 0
  end
$$;

-- Per-user, per-week record. security_invoker so RLS on picks applies: picks
-- on started games are readable by everyone, and only started games are graded.
create view public.pickem_leaderboard with (security_invoker = true) as
with straight as (
  select p.user_id, g.season, g.week, r.result,
    public.pickem_units(r.result, p.price) as units
  from public.pickem_picks p
  join public.pickem_games g on g.id = p.game_id
  cross join lateral (
    select public.pickem_pick_result(p.market, p.selection, p.line, g.home_score, g.away_score) as result
  ) r
  where g.completed
),
parlay as (
  select t.user_id, pl.season, pl.week,
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
  group by t.user_id, pl.id, pl.season, pl.week, pl.american_odds
),
all_rows as (
  select user_id, season, week, result, units from straight
  union all
  select user_id, season, week, result, public.pickem_units(result, american_odds) from parlay
)
select a.user_id, pr.display_name, a.season, a.week,
  count(*) filter (where a.result = 'win') as wins,
  count(*) filter (where a.result = 'loss') as losses,
  count(*) filter (where a.result = 'push') as pushes,
  coalesce(sum(a.units), 0) as units
from all_rows a
join public.pickem_profiles pr on pr.user_id = a.user_id
where a.result is not null
group by a.user_id, pr.display_name, a.season, a.week;

-- Row level security. Games, lines, parlays and profiles are public reads and
-- are written only by the service role (the sync and house-pick jobs).
alter table public.pickem_games enable row level security;
alter table public.pickem_line_history enable row level security;
alter table public.pickem_parlays enable row level security;
alter table public.pickem_profiles enable row level security;
alter table public.pickem_picks enable row level security;
alter table public.pickem_parlay_tails enable row level security;

create policy "anyone reads games" on public.pickem_games
  for select to anon, authenticated using (true);
create policy "anyone reads line history" on public.pickem_line_history
  for select to anon, authenticated using (true);
create policy "anyone reads parlays" on public.pickem_parlays
  for select to anon, authenticated using (true);
create policy "anyone reads profiles" on public.pickem_profiles
  for select to anon, authenticated using (true);

create policy "users insert own profile" on public.pickem_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users update own profile" on public.pickem_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Your own picks are always visible; everyone's picks become visible at kickoff.
create policy "read own picks or locked picks" on public.pickem_picks
  for select to anon, authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.pickem_games g where g.id = game_id and g.commence_time <= now())
  );
create policy "users insert own picks before kickoff" on public.pickem_picks
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_profiles pr where pr.user_id = (select auth.uid()))
    and exists (select 1 from public.pickem_games g where g.id = game_id and g.commence_time > now())
  );
create policy "users update own picks before kickoff" on public.pickem_picks
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_games g where g.id = game_id and g.commence_time > now())
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_games g where g.id = game_id and g.commence_time > now())
  );
create policy "users delete own picks before kickoff" on public.pickem_picks
  for delete to authenticated using (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_games g where g.id = game_id and g.commence_time > now())
  );

create policy "read own tails or locked tails" on public.pickem_parlay_tails
  for select to anon, authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.pickem_parlays pl where pl.id = parlay_id and pl.locks_at <= now())
  );
create policy "users tail before lock" on public.pickem_parlay_tails
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_profiles pr where pr.user_id = (select auth.uid()))
    and exists (select 1 from public.pickem_parlays pl where pl.id = parlay_id and pl.locks_at > now())
  );
create policy "users untail before lock" on public.pickem_parlay_tails
  for delete to authenticated using (
    user_id = (select auth.uid())
    and exists (select 1 from public.pickem_parlays pl where pl.id = parlay_id and pl.locks_at > now())
  );

grant select on public.pickem_leaderboard to anon, authenticated;
