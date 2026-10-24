// The house as a player. Every call at 6 or better is a play at the number
// the house took when it made the call, staked 1u until its confidence has
// earned more (effectiveStake: then 2u on a like, 3u on a best bet). Pure and
// browser-safe so it runs under node --test; the SQL view pickem_house_record
// (supabase/migrations/20261014_pickem_house_calibration.sql) does the same
// arithmetic for the season leaderboard, and the two must agree.
import {
  confidenceRecord,
  displayTeam,
  fmtSpread,
  gradePick,
  houseStake,
  houseTier,
  legLineAndPrice,
  winUnits,
  type CalibrationRow,
  type CalibrationTally,
  type HouseCall,
  type HouseNews,
  type HousePicks,
  type HouseTier,
  type Market,
  type PickemGame,
  type PickResult,
  type PreviousCall,
  type Selection,
} from "./pickem.ts";
import type { NewsDigest } from "./pickem-signals.ts";

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

// ---------------------------------------------------------------------------
// Earned stakes. The prompt asserts a 7 is about 58% and an 8 about 62%; a
// tier is staked as if that were true only once the record says so.

/** Completed spread and total calls a confidence needs before its tier's full stake. */
export const STAKE_MIN_CALLS = 50;

/**
 * Whether a confidence has earned its tier's full stake: STAKE_MIN_CALLS or
 * more completed calls in the league, winning 55% or more of those decided.
 * 20 * wins >= 11 * decided is 55% in integers, the test the SQL view uses.
 */
export function stakeEarned(t: CalibrationTally | undefined): boolean {
  if (!t || t.calls < STAKE_MIN_CALLS) return false;
  return 20 * t.wins >= 11 * (t.wins + t.losses);
}

/**
 * Units the house stakes on a call: nothing on a pass, 1u on any play, and
 * the tier's 2u or 3u once that confidence has earned it. `record` is
 * confidenceRecord for the call's league and season.
 */
export function effectiveStake(confidence: number, record: Map<number, CalibrationTally>): 0 | 1 | 2 | 3 {
  const full = houseStake(confidence);
  if (full <= 1) return full;
  return stakeEarned(record.get(confidence)) ? full : 1;
}

/** Effective stake for every confidence 6-10 in one league and season, for display. */
export function stakeTable(calibration: CalibrationRow[], league: League, season: number): { confidence: number; full: number; stake: number; earned: boolean }[] {
  const record = confidenceRecord(calibration, league, season);
  return [6, 7, 8, 9, 10].map((c) => ({ confidence: c, full: houseStake(c), stake: effectiveStake(c, record), earned: stakeEarned(record.get(c)) }));
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

/**
 * Every call the house is playing this slate, in slate order. calibration is
 * pickem_house_calibration's rows, which decide the stakes; with none, every
 * play is 1u.
 */
export function housePlays(games: PickemGame[], calibration: CalibrationRow[] = []): HousePlay[] {
  const out: HousePlay[] = [];
  const record = recordFor(calibration);
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
        stake: effectiveStake(call.confidence, record(g)) as 1 | 2 | 3,
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
export function houseWeekRecord(games: PickemGame[], calibration: CalibrationRow[] = []): HouseRecord {
  const rec: HouseRecord = { wins: 0, losses: 0, pushes: 0, units: 0 };
  for (const p of housePlays(games, calibration)) {
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
import { estimatedProbability, fairProbability, recordFor } from "./pickem-parlays.ts";

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
function edgeOf(g: PickemGame, p: HousePlay, record: Map<number, CalibrationTally>): number {
  const fair = fairProbability(p.price, opposingPrice(g, p.market, p.selection));
  return estimatedProbability(fair, p.confidence, record) * americanToDecimal(p.price);
}

const MARKET_ORDER: Record<Market, number> = { spread: 0, total: 1, ml: 2 };

/** One play per game, the house's strongest, ranked across the slate: tier first, then edge, then kickoff. */
export function rankHousePlays(games: PickemGame[], calibration: CalibrationRow[] = []): HouseCardPlay[] {
  const byGame = new Map(games.map((g) => [g.id, g]));
  const best = new Map<string, HouseCardPlay>();
  const record = recordFor(calibration);
  for (const p of housePlays(games, calibration)) {
    const g = byGame.get(p.game_id)!;
    const play: HouseCardPlay = { ...p, edge: edgeOf(g, p, record(g)), tags: [] };
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

/** calibration is pickem_house_calibration's rows: they set the stakes and the edge ranking. */
export function buildHouseCard(games: PickemGame[], calibration: CalibrationRow[] = []): HouseCard {
  const posted = games.some((g) => g.house);
  const ranked = rankHousePlays(games, calibration);
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
  return { plays, stayAway: stayAwayOf(games), record: houseWeekRecord(games, calibration), posted };
}

// ---------------------------------------------------------------------------
// What the board shows of the news behind a call. The research digest lives in
// pickem_game_signals, which only the jobs can read, so the house call keeps
// the digest's key items in pickem_games.house, which the board reads whole.

export const HOUSE_NEWS_ITEMS = 5;
const HOUSE_NEWS_DETAIL = 160;

/**
 * The digest's key items for the board: injuries first (the researcher lists
 * starters first), then suspensions and coaching changes, at most
 * HOUSE_NEWS_ITEMS, each detail cut to HOUSE_NEWS_DETAIL characters, with the
 * one line on what changed. Undefined for a digest with no items, which has
 * nothing to show.
 */
export function houseNews(d: Pick<NewsDigest, "injuries" | "suspensions" | "coaching" | "what_changed" | "researched_at">, max = HOUSE_NEWS_ITEMS): HouseNews | undefined {
  const items = [...d.injuries, ...d.suspensions, ...d.coaching].slice(0, max).map(({ team, player, detail, date }) => ({
    team,
    player,
    detail: detail.length > HOUSE_NEWS_DETAIL ? `${detail.slice(0, HOUSE_NEWS_DETAIL - 1).trimEnd()}…` : detail,
    date,
  }));
  if (!items.length) return undefined;
  return { researched_at: d.researched_at, what_changed: d.what_changed, items };
}

/** The side and confidence of each market of a call, with when it was made: what a re-pick replaced. */
export function previousCall(h: HousePicks): PreviousCall {
  const call = (c: HouseCall) => ({ pick: c.pick, confidence: c.confidence });
  return { ...(h.picked_at ? { picked_at: h.picked_at } : {}), spread: call(h.spread), total: call(h.total), ml: call(h.ml) };
}

/** The markets where a re-pick changed the tier, or the side of a play, so the board can say what moved. A pass's side means nothing, so two passes are the same call. */
export function changedMarkets(now: Pick<HousePicks, "spread" | "total" | "ml">, prev: PreviousCall): Market[] {
  return (["spread", "total", "ml"] as Market[]).filter((m) => {
    const was = houseTier(prev[m].confidence);
    const is = houseTier(now[m].confidence);
    return was !== is || (is !== "pass" && now[m].pick !== prev[m].pick);
  });
}

/** "Oct 23" for a digest item's YYYY-MM-DD; anything else as given. */
export function fmtNewsDate(date: string | null): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
