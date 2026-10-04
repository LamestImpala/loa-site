-- Outside data the house is shown about a game, stored each time the lines
-- sync (at most once a day per source):
--   cfbd      college: each team's SP+, Elo, success rate and explosiveness
--   nflverse  NFL: each team's EPA per play, season and last three games
--   sleeper   NFL: each team's injured starters
-- data is {"home": ..., "away": ...}; the shapes are in lib/pickem-signals.ts.
-- Kept apart from pickem_games because the board reads that table whole.
create table public.pickem_game_signals (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  source text not null,
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create index pickem_game_signals_game_idx on public.pickem_game_signals (game_id, source, taken_at);

-- Research data: written and read by the service role only.
alter table public.pickem_game_signals enable row level security;

-- What the house was shown when it made a call, so calls made with and
-- without a signal can be compared. Null when it was shown none.
alter table public.pickem_house_calls add column signals jsonb;
