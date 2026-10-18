-- House prompt experiments. Each house run deals the week's games to the
-- prompt variants in lib/pickem-variants.ts (control, and feedback-on: the
-- same prompt with the house's own record after the slate) and stores the
-- variant with the call, in pickem_games.house ->> 'variant' and here in
-- pickem_house_calls.variant. pickem_house_graded already reads the variant
-- from the house jsonb (20261014_pickem_house_calibration.sql).
--
-- pickem_house_experiment  the latest call on every completed game, per
--                          variant, per league and over both leagues
--                          (league = 'all'). Calls made before the
--                          experiment (no variant) are left out.
--   calls, wins, losses, pushes, win_pct      spread and total calls, passes included
--   win_lo, win_hi                            95% Wilson interval on win_pct
--   plays, play_wins, play_losses, play_win_pct, play_lo, play_hi
--                                             the same for calls at 6 and up
--   clv_calls, avg_clv                        spread and total calls with a locked line
--   units                                     every market, at the tier's full stake
--   prompt_versions                           the versions the variant's calls carry
--
-- There is no winner column: the variant is promoted by hand, by editing the
-- map. Read by the admin page only.

alter table public.pickem_house_calls add column variant text;

create or replace function public.pickem_wilson(wins bigint, n bigint, upper boolean)
returns numeric
language sql immutable
set search_path = ''
as $$
  -- 95% Wilson score interval bound for wins out of n; null when n is 0.
  select case when n = 0 then null else round((
    (wins::numeric / n + 1.9208 / n)
    + case when upper then 1 else -1 end
      * 1.96 * sqrt((wins::numeric / n) * (1 - wins::numeric / n) / n + 0.9604 / (n * n))
  ) / (1 + 3.8416 / n), 3) end
$$;

create view public.pickem_house_experiment with (security_invoker = true) as
with calls as (
  select league, season, variant, prompt_version, market, confidence, result, clv,
    units_flat * stake as units
  from public.pickem_house_graded
  where variant is not null
),
grouped as (
  select coalesce(league, 'all') as league, season, variant,
    string_agg(distinct prompt_version, ', ') as prompt_versions,
    count(*) filter (where market <> 'ml') as calls,
    count(*) filter (where market <> 'ml' and result = 'win') as wins,
    count(*) filter (where market <> 'ml' and result = 'loss') as losses,
    count(*) filter (where market <> 'ml' and result = 'push') as pushes,
    count(*) filter (where market <> 'ml' and confidence >= 6) as plays,
    count(*) filter (where market <> 'ml' and confidence >= 6 and result = 'win') as play_wins,
    count(*) filter (where market <> 'ml' and confidence >= 6 and result = 'loss') as play_losses,
    count(clv) as clv_calls,
    round(avg(clv), 2) as avg_clv,
    round(sum(units), 2) as units
  from calls
  group by grouping sets ((league, season, variant), (season, variant))
)
select league, season, variant, prompt_versions,
  calls, wins, losses, pushes,
  round(wins::numeric / nullif(wins + losses, 0), 3) as win_pct,
  public.pickem_wilson(wins, wins + losses, false) as win_lo,
  public.pickem_wilson(wins, wins + losses, true) as win_hi,
  plays, play_wins, play_losses,
  round(play_wins::numeric / nullif(play_wins + play_losses, 0), 3) as play_win_pct,
  public.pickem_wilson(play_wins, play_wins + play_losses, false) as play_lo,
  public.pickem_wilson(play_wins, play_wins + play_losses, true) as play_hi,
  clv_calls, avg_clv, units
from grouped;

grant select on public.pickem_house_experiment to authenticated;
revoke all on public.pickem_house_experiment from anon;
