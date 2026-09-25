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
  type HousePicks,
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

// ---------------------------------------------------------------------------
// Projected scores

/**
 * A projection has to back the calls it comes with: graded as if the
 * projection were the final, the spread call and the total call must not
 * lose. Landing on the number is fine (that is a 5, no lean). The moneyline
 * may disagree, since a dog's price can be worth it at a projected loss.
 * Calls are graded at their locked line, so lock before checking.
 */
export function projectionAgrees(h: Pick<HousePicks, "spread" | "total">, proj: { home: number; away: number }): boolean {
  const spread = gradePick("spread", h.spread.pick, h.spread.line ?? null, proj.home, proj.away);
  const total = gradePick("total", h.total.pick, h.total.line ?? null, proj.home, proj.away);
  return spread !== "loss" && total !== "loss";
}

/** "Alabama 31, Kentucky 17", home first. */
export function fmtProjection(g: PickemGame, proj: { home: number; away: number }): string {
  return `${displayTeam(g.league, g.home_team)} ${proj.home}, ${displayTeam(g.league, g.away_team)} ${proj.away}`;
}

// ---------------------------------------------------------------------------
// The weekly House Card: the house's strongest plays, ranked. Computed at
// render from the slate (the calls carry their locked numbers, so the card
// does not move once posted) and graded live like everything else.

import { americanToDecimal, opposingPrice, type League } from "./pickem.ts";
import { estimatedProbability, fairProbability } from "./pickem-parlays.ts";

/** How many plays make the card: enough to be a card, few enough to be a stance. */
export const HOUSE_CARD_SIZE: Record<League, number> = { ncaaf: 5, nfl: 3 };

export type HouseCardTag = "lock" | "upset";
export type HouseCardPlay = HousePlay & { edge: number; tags: HouseCardTag[] };

/** A game the house passes on all three ways, the closest one on the slate. */
export type StayAway = { game_id: string; home: string; away: string; spread_home: number | null; why: string; kickoff: string };

export type HouseCard = {
  /** Ranked. The top HOUSE_CARD_SIZE plays, plus the upset when it ranks lower. */
  plays: HouseCardPlay[];
  stayAway: StayAway | null;
  record: HouseRecord;
  /** Whether any game on the slate has house calls at all (else the card is not posted yet). */
  posted: boolean;
};

/**
 * Probability times payout, the parlay module's edge score, as a tie-break
 * within a tier. opposingPrice reads the other side's current price, not the
 * one at lock time; for a tie-break that is close enough.
 */
function edgeOf(g: PickemGame, p: HousePlay): number {
  const fair = fairProbability(p.price, opposingPrice(g, p.market, p.selection));
  return estimatedProbability(fair, p.confidence) * americanToDecimal(p.price);
}

const MARKET_ORDER: Record<Market, number> = { spread: 0, total: 1, ml: 2 };

/** One play per game, the house's strongest, ranked across the slate: tier first, then edge, then kickoff. */
export function rankHousePlays(games: PickemGame[]): HouseCardPlay[] {
  const byGame = new Map(games.map((g) => [g.id, g]));
  const best = new Map<string, HouseCardPlay>();
  for (const p of housePlays(games)) {
    const g = byGame.get(p.game_id)!;
    const play: HouseCardPlay = { ...p, edge: edgeOf(g, p), tags: [] };
    const cur = best.get(p.game_id);
    if (!cur || play.confidence > cur.confidence || (play.confidence === cur.confidence && (play.edge > cur.edge || (play.edge === cur.edge && MARKET_ORDER[play.market] < MARKET_ORDER[cur.market])))) {
      best.set(p.game_id, play);
    }
  }
  return [...best.values()].sort(
    (a, b) => b.confidence - a.confidence || b.edge - a.edge || a.kickoff.localeCompare(b.kickoff) || a.game_id.localeCompare(b.game_id)
  );
}

function stayAwayOf(games: PickemGame[]): StayAway | null {
  let pick: StayAway | null = null;
  let best = Infinity;
  for (const g of games) {
    const h = g.house;
    if (!h || g.spread_home == null) continue;
    if (MARKETS.some((m) => h[m] && houseTier(h[m].confidence) !== "pass")) continue;
    const dist = Math.abs(g.spread_home);
    if (!pick || dist < best || (dist === best && g.commence_time < pick.kickoff)) {
      best = dist;
      pick = {
        game_id: g.id,
        home: displayTeam(g.league, g.home_team),
        away: displayTeam(g.league, g.away_team),
        spread_home: g.spread_home,
        why: h.spread.why,
        kickoff: g.commence_time,
      };
    }
  }
  return pick;
}

export function buildHouseCard(games: PickemGame[]): HouseCard {
  const posted = games.some((g) => g.house);
  const ranked = rankHousePlays(games);
  const league = games[0]?.league ?? "ncaaf";
  const plays = ranked.slice(0, HOUSE_CARD_SIZE[league]);
  // A 6 is a lean, not a lock: the top play only earns the tag at like or better.
  if (plays[0] && plays[0].confidence >= 7) plays[0].tags.push("lock");
  // The strongest plus-money play is the upset alert, unless it is already the lock.
  const upset = ranked.find((p) => p.price > 0 && !p.tags.includes("lock"));
  if (upset) {
    upset.tags.push("upset");
    if (!plays.includes(upset)) plays.push(upset);
  }
  return { plays, stayAway: stayAwayOf(games), record: houseWeekRecord(games), posted };
}
