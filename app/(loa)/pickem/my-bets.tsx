"use client";

// The signed-in player's imported bets for this league and week: their own
// parlay tickets, and the straight picks that carry a stake. Stakes and
// dollar results come from pickem_wagers, which only the owner can read.
import { fmtPrice, gradePick, winUnits, type League, type PickemGame, type PickResult, type Wager } from "@/lib/pickem";
import { fmtMoney, slipLegLabel, ticketResult, wagerNet } from "@/lib/pickem-slip";
import type { PickemSession } from "./use-pickem-session";
import ResultTag from "./result-tag";
import TeamLogo from "./team-logo";

type Props = { auth: PickemSession; games: PickemGame[]; league: League; week: number; now: number };

function Money({ wager, price, result }: { wager: Wager; price: number; result: PickResult }) {
  const { stake, book, payout } = wager;
  const net = wagerNet(stake, price, result, payout);
  return (
    <p className="mt-2 text-xs tabular-nums text-neutral-500">
      {fmtMoney(stake)}
      {book ? ` at ${book}` : ""} · {net == null ? `to win ${fmtMoney(wagerNet(stake, price, "win", payout)!)}` : net === 0 ? "stake back" : net > 0 ? `won ${fmtMoney(net)}` : `lost ${fmtMoney(-net)}`} · only you see this
    </p>
  );
}

export default function MyBets({ auth, games, league, week, now }: Props) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const tickets = auth.myParlays.filter((p) => p.league === league && p.week === week);
  const staked = auth.wagers.flatMap((w) => {
    const pick = w.pick_id == null ? undefined : [...auth.picks.values()].find((p) => p.id === w.pick_id);
    const g = pick ? byId.get(pick.game_id) : undefined;
    return pick && g ? [{ w, pick, g }] : [];
  });
  if (tickets.length === 0 && staked.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-white">My bets</h2>
      <p className="mt-1 max-w-2xl text-sm text-neutral-400">
        Imported from your bet slips. A parlay risks a unit at its combined price, on top of its legs counting as picks.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tickets.map((p) => {
          const results = p.legs.map((l) => {
            const g = byId.get(l.game_id);
            return g ? gradePick(l.market, l.selection, l.line, g.home_score, g.away_score) : null;
          });
          const done = p.legs.every((l) => byId.get(l.game_id)?.completed);
          const result = ticketResult(results);
          const wager = auth.wagers.find((w) => w.user_parlay_id === p.id);
          const locked = new Date(p.locks_at).getTime() <= now;
          return (
            <div key={p.id} className="flex flex-col rounded-md border border-white/10 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-white">
                  {p.leg_count}-leg parlay <ResultTag result={result === "loss" || done ? result : null} provisional={false} />
                </h3>
                <span className="text-sm font-semibold tabular-nums text-orange-200">{fmtPrice(p.american_odds)}</span>
              </div>
              <ul className="mt-3 text-sm text-neutral-100">
                {p.legs.map((l, i) => {
                  const g = byId.get(l.game_id);
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 border-t border-white/10 py-1.5 first:border-t-0">
                      <span className="inline-flex items-center gap-1.5">
                        {g && l.market !== "total" ? <TeamLogo league={g.league} name={l.selection === "home" ? g.home_team : g.away_team} size="sm" /> : null}
                        {l.label}
                      </span>
                      <span className="flex items-center gap-2 tabular-nums text-neutral-400">
                        {fmtPrice(l.price)} <ResultTag result={results[i]} provisional={!!g && !g.completed} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs tabular-nums text-neutral-500">1 unit returns {(1 + winUnits(p.american_odds)).toFixed(2)}</p>
              {wager ? <Money wager={wager} price={p.american_odds} result={done || result === "loss" ? result : null} /> : null}
              {!locked ? (
                <button
                  type="button"
                  onClick={() => auth.removeParlay(p.id)}
                  className="mt-3 h-9 rounded-md border border-white/15 text-sm font-medium text-neutral-100 transition hover:border-white/40"
                >
                  Remove ticket
                </button>
              ) : null}
            </div>
          );
        })}
        {staked.map(({ w, pick, g }) => {
          const result = gradePick(pick.market, pick.selection, pick.line, g.home_score, g.away_score);
          return (
            <div key={w.id} className="rounded-md border border-white/10 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-white">
                  {slipLegLabel(g, pick.market, pick.selection, pick.line)} <ResultTag result={result} provisional={!g.completed} />
                </h3>
                <span className="text-sm font-semibold tabular-nums text-orange-200">{fmtPrice(pick.price)}</span>
              </div>
              <Money wager={w} price={pick.price} result={g.completed ? result : null} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
