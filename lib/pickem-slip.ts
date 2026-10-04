// Bet slip import: what Claude reads off a sportsbook screenshot, checked
// against the board before anything is saved. Pure and browser-safe so it
// runs under node --test; the Claude call itself is in pickem-server.ts.
import {
  displayTeam,
  fmtSpread,
  parlayAmericanOdds,
  winUnits,
  type Market,
  type PickemGame,
  type PickResult,
  type Selection,
} from "./pickem.ts";

export const SLIP_MARKETS = ["spread", "total", "ml"] as const;
export const SLIP_SELECTIONS = ["home", "away", "over", "under"] as const;

/** One leg as the model returns it. `game_id` is null when the game is not in the list it was given. */
export type SlipLeg = {
  game_id: string | null;
  market: Market;
  selection: Selection;
  /** The picked side's own number for a spread, the total for a total, null for a moneyline. */
  line: number | null;
  price: number;
  /** The leg as printed on the slip, shown when it cannot be imported. */
  raw_text: string;
  /** Why the leg is not a full-game spread, total or moneyline (a prop, a half, a team total), else null. */
  unsupported: string | null;
};

export type SlipBet = {
  kind: "straight" | "parlay";
  stake: number | null;
  /** The ticket's combined price for a parlay; ignored for a straight bet. */
  american_odds: number | null;
  legs: SlipLeg[];
};

export type ParsedSlip = { book: string | null; bets: SlipBet[] };

/** The columns of a game the review needs. */
export type SlipGame = Pick<
  PickemGame,
  "id" | "league" | "commence_time" | "home_team" | "away_team" | "spread_home" | "total" | "ml_home" | "ml_away"
>;

export type LegStatus = "ok" | "unsupported" | "not_on_board" | "started" | "invalid";

export type ReviewLeg = {
  status: LegStatus;
  game_id: string | null;
  market: Market;
  selection: Selection;
  line: number | null;
  price: number;
  /** "Jaguars +2.5" for a leg on the board, the slip's own text otherwise. */
  label: string;
  /** The board's current number for the same side, to show beside the slip's. */
  board: number | null;
  kickoff: string | null;
  note: string | null;
};

export type ReviewBet = {
  kind: "straight" | "parlay";
  stake: number | null;
  american_odds: number | null;
  legs: ReviewLeg[];
  /** A parlay is saved as a ticket only when every leg can be imported. */
  ticket: boolean;
};

export type SlipReview = { book: string | null; bets: ReviewBet[] };

/** A leg's label at the slip's own number, in the board's team names. */
export function slipLegLabel(g: SlipGame, market: Market, selection: Selection, line: number | null): string {
  const home = displayTeam(g.league, g.home_team);
  const away = displayTeam(g.league, g.away_team);
  if (market === "total") return `${selection === "over" ? "Over" : "Under"} ${line} (${away} @ ${home})`;
  const team = selection === "home" ? home : away;
  return market === "ml" ? `${team} ML` : `${team} ${fmtSpread(line)}`;
}

function boardNumber(g: SlipGame, market: Market, selection: Selection): number | null {
  if (market === "total") return g.total;
  if (market === "ml") return selection === "home" ? g.ml_home : g.ml_away;
  return selection === "home" ? g.spread_home : g.spread_home == null ? null : -g.spread_home;
}

function sidesMatch(market: Market, selection: Selection): boolean {
  return market === "total" ? selection === "over" || selection === "under" : selection === "home" || selection === "away";
}

function reviewLeg(leg: SlipLeg, byId: Map<string, SlipGame>, now: number): ReviewLeg {
  const g = leg.game_id ? byId.get(leg.game_id) : undefined;
  const line = leg.market === "ml" ? null : leg.line;
  const base = { game_id: g?.id ?? null, market: leg.market, selection: leg.selection, line, price: leg.price };
  const off = (status: LegStatus, note: string): ReviewLeg => ({
    ...base,
    status,
    label: leg.raw_text,
    board: null,
    kickoff: g?.commence_time ?? null,
    note,
  });
  if (leg.unsupported) return off("unsupported", leg.unsupported);
  if (!g) return off("not_on_board", "This game is not on the board.");
  const priceOk = Number.isInteger(leg.price) && Math.abs(leg.price) >= 100;
  const lineOk = leg.market === "ml" || (line != null && Number.isFinite(line) && (leg.market !== "total" || line > 0));
  if (!sidesMatch(leg.market, leg.selection) || !priceOk || !lineOk) return off("invalid", "Could not read this leg.");
  const read: ReviewLeg = {
    ...base,
    status: "ok",
    label: slipLegLabel(g, leg.market, leg.selection, line),
    board: boardNumber(g, leg.market, leg.selection),
    kickoff: g.commence_time,
    note: null,
  };
  if (new Date(g.commence_time).getTime() <= now) return { ...read, status: "started", note: "This game has kicked off, so picks are locked." };
  return read;
}

/**
 * Check a parsed slip against the board. A straight bet the model returned
 * with several legs is really several straight bets, and its one stake cannot
 * be split between them, so it is dropped.
 */
export function reviewSlip(slip: ParsedSlip, games: SlipGame[], now: number): SlipReview {
  const byId = new Map(games.map((g) => [g.id, g]));
  const bets: ReviewBet[] = [];
  for (const bet of slip.bets) {
    const legs = bet.legs.map((l) => reviewLeg(l, byId, now));
    if (legs.length === 0) continue;
    if (bet.kind === "straight") {
      for (const leg of legs) bets.push({ kind: "straight", stake: legs.length === 1 ? positive(bet.stake) : null, american_odds: null, legs: [leg], ticket: false });
      continue;
    }
    const ticket = legs.length >= 2 && legs.every((l) => l.status === "ok");
    const odds = bet.american_odds != null && Math.abs(bet.american_odds) >= 100 ? Math.round(bet.american_odds) : null;
    bets.push({
      kind: "parlay",
      stake: positive(bet.stake),
      american_odds: odds ?? (ticket ? parlayAmericanOdds(legs.map((l) => l.price)) : null),
      legs,
      ticket,
    });
  }
  return { book: slip.book?.trim() || null, bets };
}

function positive(n: number | null): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

/** Whether saving this bet would write anything. */
export function importable(bet: ReviewBet): boolean {
  return bet.legs.some((l) => l.status === "ok");
}

/** The argument to pickem_import_bet: the legs that can be saved, and how many the slip had. */
export function betPayload(bet: ReviewBet, book: string | null) {
  return {
    kind: bet.kind,
    book,
    stake: bet.stake,
    american_odds: bet.american_odds,
    leg_count: bet.legs.length,
    legs: bet.legs
      .filter((l) => l.status === "ok")
      .map((l) => ({ game_id: l.game_id, market: l.market, selection: l.selection, line: l.line, price: l.price, label: l.label })),
  };
}

/** A ticket's grade from its legs (mirrors pickem_leaderboard): any loss loses, a push on any leg pushes. */
export function ticketResult(legs: PickResult[]): PickResult {
  if (legs.some((r) => r === "loss")) return "loss";
  if (legs.some((r) => r == null)) return null;
  return legs.every((r) => r === "win") ? "win" : "push";
}

/** Dollars won or lost on a stake at an American price; null until graded. */
export function wagerNet(stake: number, price: number, result: PickResult): number | null {
  if (result == null) return null;
  if (result === "push") return 0;
  return result === "win" ? Math.round(stake * winUnits(price) * 100) / 100 : -stake;
}

export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}$${Number.isInteger(abs) ? abs : abs.toFixed(2)}`;
}
