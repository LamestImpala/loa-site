// The price engine: finds a number at a bettable book that beats Pinnacle's
// no-vig price, and says by how much. It runs in shadow beside the house
// (lib/pickem-server.ts writes its plays to pickem_engine_plays at every
// line sync); nothing on the board reads it. Pure and browser-safe so it
// runs under node --test.
//
// The method. Pinnacle's two prices at its own number give the fair chance
// of each side there. A book's number is usually a half point or more away,
// so the chance is walked from Pinnacle's number to the book's, adding the
// share of games that land on each number crossed (lib/pickem-push-rates.ts:
// a half point through 3 is worth far more than one through 5). That gives
// win, push and loss at the book's own line, and with the book's own price,
// an expected value per unit staked.
import { americanToDecimal, type League, type Selection } from "./pickem.ts";
import { PUSH_RATES } from "./pickem-push-rates.ts";
import { noVig, PROB_PER_POINT, type OddsEventLike } from "./pickem-signals.ts";

export type EngineMarket = "spread" | "total";
const MARKETS: EngineMarket[] = ["spread", "total"];
const SIDES: Record<EngineMarket, [Selection, Selection]> = { spread: ["home", "away"], total: ["over", "under"] };

/** Every book the line sync asks The Odds API for: the nine US books the board is built from, and Pinnacle. Ten names cost one region. */
export const SYNC_BOOKS = ["draftkings", "fanduel", "betmgm", "betrivers", "bovada", "betonlineag", "lowvig", "betus", "mybookieag", "pinnacle"];
export const SHARP_BOOK = "pinnacle";
/** Books a play may be at: regulated US books. The snapshots keep the others, so a wider set can be replayed. */
export const ENGINE_BOOKS = ["draftkings", "fanduel", "betmgm", "betrivers"];

/** A play needs at least this expected value per unit staked. */
export const ENGINE_MIN_EV = 0.02;
/**
 * A lean is a bettable price that beats Pinnacle's fair price by less than a
 * play needs. It is recorded and graded but stakes nothing: regulated books
 * seldom offer 2%, and leans show sooner whether small edges hold to the close.
 */
export const ENGINE_LEAN_EV = 0;
export type EngineTier = "play" | "lean";
/** Units staked by expected value: 1 from ENGINE_MIN_EV, 2 from 3.5%, 3 from 5%. */
export const ENGINE_STAKES: [ev: number, units: number][] = [
  [0.05, 3],
  [0.035, 2],
  [ENGINE_MIN_EV, 1],
];
/** A quote older than this (Pinnacle's or the book's) is not compared. */
export const ENGINE_MAX_QUOTE_AGE_MS = 3 * 60 * 60 * 1000;
/** A book this many points from Pinnacle is news or bad data, not value. */
export const ENGINE_MAX_GAP: Record<EngineMarket, number> = { spread: 2, total: 3 };
/** Spread and total prices outside this range are alternate lines or errors. */
export const ENGINE_PRICE_RANGE: [min: number, max: number] = [-135, 120];

export function engineStake(ev: number): number {
  return ENGINE_STAKES.find(([min]) => ev >= min)?.[1] ?? 0;
}

// ---------------------------------------------------------------------------
// Snapshots: each book's spread and total on one event, small enough to store
// per sync (pickem_book_lines.books).

export type BookLines = {
  /** The book's last update, ISO. */
  u: string | null;
  /** Spread: the home team's points, then the home and away prices. */
  s?: [point: number, home: number, away: number];
  /** Total: the number, then the over and under prices. */
  t?: [point: number, over: number, under: number];
};
export type BookSnapshot = Record<string, BookLines>;

export function compactBooks(ev: OddsEventLike): BookSnapshot {
  const out: BookSnapshot = {};
  for (const b of ev.bookmakers) {
    const outcomes = (k: string) => b.markets.find((m) => m.key === k)?.outcomes ?? [];
    const sh = outcomes("spreads").find((o) => o.name === ev.home_team);
    const sa = outcomes("spreads").find((o) => o.name === ev.away_team);
    const over = outcomes("totals").find((o) => o.name === "Over");
    const under = outcomes("totals").find((o) => o.name === "Under");
    const lines: BookLines = { u: b.last_update ?? null };
    if (sh?.point != null && sa) lines.s = [sh.point, sh.price, sa.price];
    if (over?.point != null && under) lines.t = [over.point, over.price, under.price];
    if (lines.s || lines.t) out[b.key] = lines;
  }
  return out;
}

/**
 * One side of one market at one book, as a handicap: the side covers when its
 * own number (its margin; the total for an over; minus the total for an under)
 * plus the handicap is above zero. A bigger handicap is always the better bet.
 * `line` is what the board calls it: the side's spread, or the total.
 */
type Quote = { handicap: number; line: number; price: number; other: number };

function quote(lines: BookLines | undefined, market: EngineMarket, selection: Selection): Quote | null {
  if (!lines) return null;
  if (market === "spread") {
    if (!lines.s) return null;
    const [point, home, away] = lines.s;
    return selection === "home" ? { handicap: point, line: point, price: home, other: away } : { handicap: -point, line: -point, price: away, other: home };
  }
  if (!lines.t) return null;
  const [point, over, under] = lines.t;
  return selection === "over" ? { handicap: -point, line: point, price: over, other: under } : { handicap: point, line: point, price: under, other: over };
}

// ---------------------------------------------------------------------------
// From Pinnacle's number to a book's number.

/** The share of games landing exactly on a number: a margin of n points, or any one total. */
export function landingRate(league: League, market: EngineMarket, n: number): number {
  if (market === "total") return PUSH_RATES[league].total;
  return PUSH_RATES[league].margin[Math.abs(n)] ?? PROB_PER_POINT[league].spread;
}

export type CoverProbs = { win: number; push: number; loss: number };

const isWhole = (x: number) => Number.isInteger(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Win, push and loss for a side at `handicap`, given Pinnacle's handicap for
 * the same side and the no-vig chance the side wins there (pushes aside).
 * The side wins when its number is above minus the handicap, so moving the
 * handicap from Pinnacle's to the book's adds (or removes) every whole number
 * in between.
 */
export function coverProbs(league: League, market: EngineMarket, pinHandicap: number, pinFair: number, handicap: number): CoverProbs {
  const rate = (n: number) => landingRate(league, market, n);
  const pinPush = isWhole(pinHandicap) ? rate(-pinHandicap) : 0;
  let win = pinFair * (1 - pinPush);
  // Whole numbers x with lo < x <= hi.
  const between = (lo: number, hi: number) => {
    let sum = 0;
    for (let x = Math.floor(lo) + 1; x <= Math.floor(hi); x++) sum += rate(x);
    return sum;
  };
  if (handicap > pinHandicap) win += between(-handicap, -pinHandicap);
  else if (handicap < pinHandicap) win -= between(-pinHandicap, -handicap);
  win = clamp01(win);
  const push = isWhole(handicap) ? Math.min(rate(-handicap), 1 - win) : 0;
  return { win, push, loss: clamp01(1 - win - push) };
}

/** Expected units won per unit staked at an American price. */
export function quoteEv(p: Pick<CoverProbs, "win" | "loss">, price: number): number {
  return p.win * (americanToDecimal(price) - 1) - p.loss;
}

// ---------------------------------------------------------------------------
// Plays.

export type EnginePlay = {
  game_id: string;
  market: EngineMarket;
  selection: Selection;
  /** The book's key and display name. */
  book_key: string;
  book: string;
  /** The side's spread, or the total, at that book. */
  line: number;
  price: number;
  win_prob: number;
  push_prob: number;
  ev: number;
  /** "play" from ENGINE_MIN_EV, staked; "lean" below it, tracked at no stake. */
  tier: EngineTier;
  stake: number;
  /** What it was measured against: Pinnacle's line for the same side, its two prices, and the side's no-vig chance there. */
  pinnacle: { line: number; price: number; other: number; fair: number; updated_at: string | null };
};

export type EngineSkip = "no_pinnacle" | "stale_pinnacle" | "no_book" | "stale_book" | "gap" | "price" | "no_edge";

export type EngineResult = { plays: EnginePlay[]; skipped: Partial<Record<EngineSkip, number>> };

const fresh = (u: string | null, now: number) => u != null && now - Date.parse(u) <= ENGINE_MAX_QUOTE_AGE_MS;
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * The best bettable quote on each of an event's spread and total: a play when
 * its expected value reaches ENGINE_MIN_EV, a lean when it is at least
 * ENGINE_LEAN_EV, otherwise the reason the market had none. `titles` maps a
 * book's key to its display name. A market gives at most one, so the two
 * sides never both qualify.
 */
export function findPlays(league: League, gameId: string, books: BookSnapshot, now: number, titles: Record<string, string> = {}): EngineResult {
  const plays: EnginePlay[] = [];
  const skipped: EngineResult["skipped"] = {};
  const skip = (why: EngineSkip) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const pin = books[SHARP_BOOK];
  for (const market of MARKETS) {
    if (!quote(pin, market, SIDES[market][0])) {
      skip("no_pinnacle");
      continue;
    }
    if (!fresh(pin.u, now)) {
      skip("stale_pinnacle");
      continue;
    }
    let best: EnginePlay | null = null;
    // The reason the market gave nothing, should it give nothing: the furthest any quote got.
    let reached: EngineSkip = "no_book";
    const reach = (why: EngineSkip) => {
      const order: EngineSkip[] = ["no_book", "stale_book", "gap", "price", "no_edge"];
      if (order.indexOf(why) > order.indexOf(reached)) reached = why;
    };
    for (const selection of SIDES[market]) {
      const p = quote(pin, market, selection)!;
      const pinFair = noVig(p.price, p.other);
      for (const key of ENGINE_BOOKS) {
        const q = quote(books[key], market, selection);
        if (!q) continue;
        if (!fresh(books[key].u, now)) {
          reach("stale_book");
          continue;
        }
        if (Math.abs(q.handicap - p.handicap) > ENGINE_MAX_GAP[market]) {
          reach("gap");
          continue;
        }
        if (q.price < ENGINE_PRICE_RANGE[0] || q.price > ENGINE_PRICE_RANGE[1]) {
          reach("price");
          continue;
        }
        reach("no_edge");
        const probs = coverProbs(league, market, p.handicap, pinFair, q.handicap);
        const ev = quoteEv(probs, q.price);
        if (ev < ENGINE_LEAN_EV || (best && ev <= best.ev)) continue;
        best = {
          game_id: gameId,
          market,
          selection,
          book_key: key,
          book: titles[key] ?? key,
          line: q.line,
          price: q.price,
          win_prob: round(probs.win, 4),
          push_prob: round(probs.push, 4),
          ev: round(ev, 4),
          tier: ev >= ENGINE_MIN_EV ? "play" : "lean",
          stake: engineStake(ev),
          pinnacle: { line: p.line, price: p.price, other: p.other, fair: round(pinFair, 4), updated_at: pin.u },
        };
      }
    }
    if (best) plays.push(best);
    else skip(reached);
  }
  return { plays, skipped };
}

/**
 * A locked play valued against a later snapshot, normally the last one before
 * kickoff: Pinnacle's closing line for the play's side and the play's expected
 * value at its own line and price against Pinnacle's closing no-vig price.
 * Above zero is a play that beat the close. Null when the snapshot has no
 * Pinnacle line on the market.
 */
export function closingEv(
  league: League,
  play: Pick<EnginePlay, "market" | "selection" | "line" | "price">,
  closing: BookSnapshot
): { close_line: number; close_ev: number } | null {
  const p = quote(closing[SHARP_BOOK], play.market, play.selection);
  if (!p) return null;
  const handicap = play.market === "total" && play.selection === "over" ? -play.line : play.line;
  const probs = coverProbs(league, play.market, p.handicap, noVig(p.price, p.other), handicap);
  return { close_line: p.line, close_ev: round(quoteEv(probs, play.price), 4) };
}

/** An event without the sharp book, for everything the board shows: its consensus and best lines are US books only. */
export function withoutSharp<E extends { bookmakers: { key: string }[] }>(ev: E): E {
  return { ...ev, bookmakers: ev.bookmakers.filter((b) => b.key !== SHARP_BOOK) };
}
