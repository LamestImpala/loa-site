-- One-off data repair. Until lines were frozen at kickoff (2026-10-03) the
-- sync kept writing in-game odds over a started game's spread, total,
-- moneylines and best prices. This puts back the last snapshot taken before
-- kickoff for every finished game that has a snapshot from after kickoff.
--
-- best (the best price per side) has no history, so it is cleared; a house
-- call without a locked price then grades at -110, which is what the client
-- already assumes. Games first seen after kickoff have no pre-game snapshot
-- and are left alone; nobody could pick them and the house never called them.
-- Player picks are not affected: each pick carries its own locked line.
--
-- The old values are kept in pickem_games_backup_20261003. To undo:
--   update public.pickem_games g
--   set spread_home = b.spread_home, total = b.total, ml_home = b.ml_home,
--       ml_away = b.ml_away, best = b.best, lines_updated_at = b.lines_updated_at
--   from public.pickem_games_backup_20261003 b where b.id = g.id;

begin;

create table public.pickem_games_backup_20261003 as
select g.id, g.spread_home, g.total, g.ml_home, g.ml_away, g.best, g.lines_updated_at
from public.pickem_games g
where g.completed
  and exists (select 1 from public.pickem_line_history h
              where h.game_id = g.id and h.taken_at >= g.commence_time)
  and exists (select 1 from public.pickem_line_history h
              where h.game_id = g.id and h.taken_at < g.commence_time and h.spread_home is not null);

alter table public.pickem_games_backup_20261003 enable row level security;

update public.pickem_games g
set spread_home = cl.spread_home,
    total = cl.total,
    ml_home = cl.ml_home,
    ml_away = cl.ml_away,
    best = '{}'::jsonb,
    lines_updated_at = cl.taken_at
from public.pickem_games_backup_20261003 b
cross join lateral (
  select h.spread_home, h.total, h.ml_home, h.ml_away, h.taken_at
  from public.pickem_line_history h
  where h.game_id = b.id
    and h.taken_at < (select commence_time from public.pickem_games where id = b.id)
    and h.spread_home is not null
  order by h.taken_at desc
  limit 1
) cl
where g.id = b.id;

commit;
