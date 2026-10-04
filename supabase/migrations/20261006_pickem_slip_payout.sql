-- Slip import: keep the payout printed on the slip. A book's payout can be
-- more than the odds alone return (a profit boost, a bonus), so it is stored
-- as shown rather than worked out from the price. payout is the total
-- returned on a win, stake included. Apply in the Supabase SQL editor.
alter table public.pickem_wagers add column payout numeric check (payout > 0);

-- Same function, now reading p_bet.payout. A slip uploaded a second time
-- also refreshes the stake and payout on the ticket it already made.
create or replace function public.pickem_import_bet(p_bet jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := p_bet ->> 'kind';
  v_book text := nullif(left(coalesce(p_bet ->> 'book', ''), 40), '');
  v_stake numeric := (p_bet ->> 'stake')::numeric;
  v_odds int := (p_bet ->> 'american_odds')::int;
  v_payout numeric := (p_bet ->> 'payout')::numeric;
  v_count int;
  v_leg jsonb;
  v_game public.pickem_games%rowtype;
  v_first public.pickem_games%rowtype;
  v_market text;
  v_sel text;
  v_line numeric;
  v_price int;
  v_reason text;
  v_pick_id bigint;
  v_results jsonb := '[]'::jsonb;
  v_saved jsonb := '[]'::jsonb;
  v_parlay text := 'none';
  v_parlay_id bigint;
  v_sig text;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.pickem_profiles where user_id = v_uid) then
    raise exception 'no pickem profile';
  end if;
  if v_kind is null or v_kind not in ('straight', 'parlay') then
    raise exception 'unknown bet kind';
  end if;
  if jsonb_typeof(p_bet -> 'legs') is distinct from 'array' then
    raise exception 'legs must be an array';
  end if;
  v_count := jsonb_array_length(p_bet -> 'legs');
  if v_count < 1 or v_count > 20 or (v_kind = 'straight' and v_count <> 1) then
    raise exception 'wrong number of legs';
  end if;
  if v_stake is not null and (v_stake <= 0 or v_stake > 1000000) then
    v_stake := null;
  end if;
  if v_stake is null or v_payout is null or v_payout <= v_stake or v_payout > 100000000 then
    v_payout := null;
  end if;

  for v_leg in select * from jsonb_array_elements(p_bet -> 'legs') loop
    v_market := v_leg ->> 'market';
    v_sel := v_leg ->> 'selection';
    v_line := (v_leg ->> 'line')::numeric;
    v_price := (v_leg ->> 'price')::int;
    v_reason := null;
    select * into v_game from public.pickem_games where id = v_leg ->> 'game_id';
    if not found then
      v_reason := 'not_on_board';
    elsif v_game.commence_time <= now() then
      v_reason := 'started';
    elsif not coalesce(
        (v_market in ('spread', 'ml') and v_sel in ('home', 'away'))
        or (v_market = 'total' and v_sel in ('over', 'under')), false)
      or (v_market = 'ml') <> (v_line is null)
      or v_price is null or abs(v_price) < 100 or abs(v_price) > 100000 then
      v_reason := 'invalid';
    end if;

    if v_reason is null then
      insert into public.pickem_picks (user_id, game_id, market, selection, line, price)
      values (v_uid, v_game.id, v_market, v_sel, v_line, v_price)
      on conflict (user_id, game_id, market) do update
        set selection = excluded.selection, line = excluded.line, price = excluded.price, updated_at = now()
      returning id into v_pick_id;
      if v_kind = 'straight' and v_stake is not null then
        insert into public.pickem_wagers (user_id, pick_id, book, stake, payout)
        values (v_uid, v_pick_id, v_book, v_stake, v_payout)
        on conflict (pick_id) do update set book = excluded.book, stake = excluded.stake, payout = excluded.payout;
      end if;
      v_saved := v_saved || jsonb_build_object(
        'game_id', v_game.id, 'market', v_market, 'selection', v_sel, 'line', v_line, 'price', v_price,
        'label', left(coalesce(v_leg ->> 'label', ''), 80));
      if v_first.id is null or v_game.commence_time < v_first.commence_time then
        v_first := v_game;
      end if;
    end if;
    v_results := v_results || jsonb_build_object(
      'game_id', v_leg ->> 'game_id', 'market', v_market,
      'status', case when v_reason is null then 'saved' else 'skipped' end, 'reason', v_reason);
  end loop;

  if v_kind = 'parlay' then
    if jsonb_array_length(v_saved) < 2
      or jsonb_array_length(v_saved) <> coalesce((p_bet ->> 'leg_count')::int, v_count)
      or v_odds is null or abs(v_odds) < 100 then
      v_parlay := 'incomplete';
    else
      select string_agg(s.k, '|' order by s.k) into v_sig
      from (
        select (l ->> 'game_id') || ':' || (l ->> 'market') || ':' || (l ->> 'selection') as k
        from jsonb_array_elements(v_saved) l
      ) s;
      insert into public.pickem_user_parlays (user_id, league, season, week, legs, american_odds, locks_at, signature)
      values (v_uid, v_first.league, v_first.season, v_first.week, v_saved, v_odds, v_first.commence_time, v_sig)
      on conflict (user_id, signature) do nothing
      returning id into v_parlay_id;
      if v_parlay_id is null then
        v_parlay := 'duplicate';
        select id into v_parlay_id from public.pickem_user_parlays where user_id = v_uid and signature = v_sig;
      else
        v_parlay := 'saved';
      end if;
      -- The same slip again refreshes its stake and payout rather than adding a ticket.
      if v_stake is not null then
        insert into public.pickem_wagers (user_id, user_parlay_id, book, stake, payout)
        values (v_uid, v_parlay_id, v_book, v_stake, v_payout)
        on conflict (user_parlay_id) do update set book = excluded.book, stake = excluded.stake, payout = excluded.payout;
      end if;
    end if;
  end if;

  return jsonb_build_object('legs', v_results, 'parlay', v_parlay, 'parlay_id', v_parlay_id);
end;
$$;
