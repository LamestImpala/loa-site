// The house as a player. Every call at 6 or better is a play staked by tier
// (1u lean, 2u like, 3u best bet) at the number the house took when it made
// the call. Pure and browser-safe so it runs under node --test; the SQL view
// pickem_house_record (supabase/migrations/20260924_pickem_house.sql) does
// the same arithmetic for the season leaderboard, and the two must agree.
import {
  displayTeam,
  fmtSpread,
  gradePick,
  houseStake,
  houseTier,
  legLineAndPrice,
  winUnits,
  type HouseCall,
  type HouseTier,
  type Market,
  type PickemGame,
  type PickResult,
  type Selection,
} from "./pickem.ts";

export const MARKETS: Market[] = ["spread", "total", "ml"];

/** A total takes over/under; a spread or moneyline takes a team. Legacy rows were not checked at the schema. */
export function fitsMarket(market: Market, selection: Selection): boolean {
  return market === "total" ? selection === "over" || selection === "under" : selection === "home" || selection === "away";
}

/**
 * The number and price a call is graded at: the ones locked into the call,
 * or, for a call written before locking, the game's current line and best
 * price (the closing number once the game is over).
 */
export function callLineAndPrice(g: PickemGame, market: Market, call: HouseCall): { line: number | null; price: number } {
  if (typeof call.price === "number") return { line: market === "ml" ? null : call.line ?? null, price: call.price };
  return legLineAndPrice(g, market, call.pick);
}

/** "Alabama -9", "Under 47 (Kentucky @ Alabama)", "Alabama ML", from the play's own number. */
export function playLabel(g: PickemGame, market: Market, selection: Selection, line: number | null): string {
  const home = displayTeam(g.league, g.home_team);
  const away = displayTeam(g.league, g.away_team);
  if (market === "total") return `${selection === "over" ? "Over" : "Under"} ${line ?? "—"} (${away} @ ${home})`;
  const team = selection === "home" ? home : away;
  if (market === "ml") return `${team} ML`;
  return line == null ? team : `${team} ${fmtSpread(line)}`;
}

export type HousePlay = {
  game_id: string;
  market: Market;
  selection: Selection;
  line: number | null;
  price: number;
  confidence: number;
  tier: Exclude<HouseTier, "pass">;
  stake: 1 | 2 | 3;
  why: string;
  label: string;
  kickoff: string;
  completed: boolean;
  /** Graded against the row's score: final when completed, provisional while a live score is on it, null before kickoff. */
  result: PickResult;
};

/** Every call the house is playing this slate, in slate order. */
export function housePlays(games: PickemGame[]): HousePlay[] {
  const out: HousePlay[] = [];
  for (const g of games) {
    if (!g.house) continue;
    for (const market of MARKETS) {
      const call = g.house[market];
      if (!call || !fitsMarket(market, call.pick)) continue;
      const tier = houseTier(call.confidence);
      if (tier === "pass") continue;
      const { line, price } = callLineAndPrice(g, market, call);
      if (market !== "ml" && line == null) continue;
      out.push({
        game_id: g.id,
        market,
        selection: call.pick,
        line,
        price,
        confidence: call.confidence,
        tier,
        stake: houseStake(call.confidence) as 1 | 2 | 3,
        why: call.why,
        label: playLabel(g, market, call.pick, line),
        kickoff: g.commence_time,
        completed: g.completed,
        result: gradePick(market, call.pick, line, g.home_score, g.away_score),
      });
    }
  }
  return out;
}

/** Units won or lost on a play: the American-odds return per unit times the stake, minus the stake on a loss. Mirrors pickem_units. */
export function playUnits(result: PickResult, price: number, stake: number): number {
  if (result === "win") return winUnits(price) * stake;
  if (result === "loss") return -stake;
  return 0;
}

export type HouseRecord = { wins: number; losses: number; pushes: number; units: number };

/** The house's record on the completed games in a slate. Same arithmetic as pickem_house_record. */
export function houseWeekRecord(games: PickemGame[]): HouseRecord {
  const rec: HouseRecord = { wins: 0, losses: 0, pushes: 0, units: 0 };
  for (const p of housePlays(games)) {
    if (!p.completed || !p.result) continue;
    if (p.result === "win") rec.wins++;
    else if (p.result === "loss") rec.losses++;
    else rec.pushes++;
    rec.units += playUnits(p.result, p.price, p.stake);
  }
  return rec;
}

export function fmtRecord(r: HouseRecord): string {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}
