-- Every house run, kept. pickem_games.house holds only the latest call, so a
-- re-pick used to erase the earlier one and with it any way to measure that
-- call against the close. spread_home and total are the consensus numbers at
-- the time of the call; the locked line and price are inside house.
create table public.pickem_house_calls (
  id bigint generated always as identity primary key,
  game_id text not null references public.pickem_games (id) on delete cascade,
  picked_at timestamptz not null,
  prompt_version text,
  model text,
  effort text,
  house jsonb not null,
  spread_home numeric,
  total numeric
);
create index pickem_house_calls_game_idx on public.pickem_house_calls (game_id, picked_at);

-- Research data: written and read by the service role only.
alter table public.pickem_house_calls enable row level security;
