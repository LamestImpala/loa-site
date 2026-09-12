-- Parlays are now computed from the house picks, one per leg count, ranked by
-- expected value. leg_count is derived so it can never drift from legs, and
-- hit_probability is the house's own estimate that every leg hits (null on
-- rows written before this change). pickem_replace_parlays swaps a week's
-- tickets in one transaction without ever removing one somebody tailed.

alter table public.pickem_parlays
  add column leg_count int generated always as (jsonb_array_length(legs)) stored,
  add column hit_probability numeric;

create index pickem_parlays_week_legs_idx
  on public.pickem_parlays (season, week, leg_count, created_at desc);

-- Drop every parlay for the week that has not locked and nobody tails, keep the
-- rest, insert the new set. Locking the candidates first makes a tail that
-- races the delete wait and then fail its foreign key cleanly, so the cascade
-- on pickem_parlay_tails never removes a real tail.
create or replace function public.pickem_replace_parlays(p_season int, p_week int, p_rows jsonb)
returns table (removed int, inserted int)
language plpgsql
set search_path = ''
as $$
declare
  r int;
  i int;
begin
  perform 1 from public.pickem_parlays
    where season = p_season and week = p_week and locks_at > now()
    for update;

  delete from public.pickem_parlays pl
    where pl.season = p_season and pl.week = p_week and pl.locks_at > now()
      and not exists (select 1 from public.pickem_parlay_tails t where t.parlay_id = pl.id);
  get diagnostics r = row_count;

  insert into public.pickem_parlays (season, week, name, legs, american_odds, note, locks_at, hit_probability)
  select p_season, p_week, x.name, x.legs, x.american_odds, coalesce(x.note, ''), x.locks_at, x.hit_probability
  from jsonb_to_recordset(p_rows)
    as x(name text, legs jsonb, american_odds int, note text, locks_at timestamptz, hit_probability numeric);
  get diagnostics i = row_count;

  return query select r, i;
end
$$;

revoke execute on function public.pickem_replace_parlays(int, int, jsonb) from public, anon, authenticated;
