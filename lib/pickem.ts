// Shared pick'em types and pure helpers. Browser-safe: no secrets, no I/O.

export const PICKEM_SEASON = 2026;

// Leagues. Each has its own Odds API feed and its own week numbering; the
// rest of the model (markets, picks, units) is the same for both.
export type League = "ncaaf" | "nfl";
export const LEAGUES: League[] = ["ncaaf", "nfl"];

export function parseLeague(s: string | null | undefined): League | null {
  return s === "ncaaf" || s === "nfl" ? s : null;
}

// Weeks run Tuesday through Monday and roll over at 10:00 UTC (6 AM Eastern),
// so a Monday-night game that kicks after midnight UTC stays in its week.
// College week 1 is the week of Sat Sept 5, 2026, which is how the books label
// it (Aug 29 games were "Week 0"). NFL week 1 opens Thu Sept 10, 2026.
export const LEAGUE_META: Record<League, { label: string; short: string; oddsSport: string; week1TuesdayUtc: number }> = {
  ncaaf: { label: "College football", short: "College", oddsSport: "americanfootball_ncaaf", week1TuesdayUtc: Date.UTC(2026, 8, 1, 10) },
  nfl: { label: "NFL", short: "NFL", oddsSport: "americanfootball_nfl", week1TuesdayUtc: Date.UTC(2026, 8, 8, 10) },
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function seasonWeek(league: League, date: Date): number {
  return Math.floor((date.getTime() - LEAGUE_META[league].week1TuesdayUtc) / WEEK_MS) + 1;
}

/** [start, end) of a season week, in UTC. */
export function weekWindow(league: League, week: number): { start: Date; end: Date } {
  const start = new Date(LEAGUE_META[league].week1TuesdayUtc + (week - 1) * WEEK_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

export type Market = "spread" | "total" | "ml";
export type Selection = "home" | "away" | "over" | "under";

export type BestLine = { point: number | null; price: number; book: string };
export type BestLines = Partial<{
  spread_home: BestLine;
  spread_away: BestLine;
  over: BestLine;
  under: BestLine;
  ml_home: BestLine;
  ml_away: BestLine;
}>;

export type HouseCall = { pick: Selection; confidence: number; why: string };
export type HousePicks = { spread: HouseCall; total: HouseCall; ml: HouseCall };

export type PickemGame = {
  id: string;
  league: League;
  season: number;
  week: number;
  commence_time: string;
  home_team: string;
  away_team: string;
  spread_home: number | null;
  total: number | null;
  ml_home: number | null;
  ml_away: number | null;
  open_spread_home: number | null;
  open_total: number | null;
  open_ml_home: number | null;
  open_ml_away: number | null;
  best: BestLines;
  house: HousePicks | null;
  home_score: number | null;
  away_score: number | null;
  completed: boolean;
  lines_updated_at: string | null;
};

export type ParlayLeg = {
  game_id: string;
  market: Market;
  selection: Selection;
  line: number | null;
  price: number;
  label: string;
  /** House confidence behind the leg, 1-10. Absent on legacy rows. */
  confidence?: number;
};

export type PickemParlay = {
  id: number;
  league: League;
  season: number;
  week: number;
  name: string;
  legs: ParlayLeg[];
  american_odds: number;
  confidence: number | null;
  note: string;
  locks_at: string;
  leg_count: number;
  /** House's own estimate that every leg hits; null on legacy rows. */
  hit_probability: number | null;
};

export type PickemPick = {
  id?: number;
  user_id: string;
  game_id: string;
  market: Market;
  selection: Selection;
  line: number | null;
  price: number;
};

export type LeaderboardRow = {
  user_id: string;
  display_name: string;
  season: number;
  week: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  league: League;
};

// ---------------------------------------------------------------------------
// Odds math

export function americanToDecimal(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

export function decimalToAmerican(dec: number): number {
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

export function parlayAmericanOdds(prices: number[]): number {
  const dec = prices.reduce((acc, p) => acc * americanToDecimal(p), 1);
  return decimalToAmerican(dec);
}

/** Units returned on a 1-unit win at an American price. */
export function winUnits(price: number): number {
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

export function fmtPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

export function fmtSpread(point: number | null | undefined): string {
  if (point == null) return "—";
  if (point === 0) return "PK";
  return point > 0 ? `+${point}` : `${point}`;
}

// ---------------------------------------------------------------------------
// Grading (mirrors pickem_pick_result in SQL, for client-side display)

export type PickResult = "win" | "loss" | "push" | null;

export function gradePick(
  market: Market,
  selection: Selection,
  line: number | null,
  homeScore: number | null,
  awayScore: number | null
): PickResult {
  if (homeScore == null || awayScore == null) return null;
  if (market === "ml") {
    if (homeScore === awayScore) return "push";
    return (selection === "home") === homeScore > awayScore ? "win" : "loss";
  }
  if (market === "spread") {
    const margin =
      (selection === "home" ? homeScore - awayScore : awayScore - homeScore) +
      (line ?? 0);
    return margin > 0 ? "win" : margin === 0 ? "push" : "loss";
  }
  const sum = homeScore + awayScore;
  if (sum === line) return "push";
  return (selection === "over") === sum > (line ?? 0) ? "win" : "loss";
}

// ---------------------------------------------------------------------------
// Team names

// The Odds API names teams "School Mascot". Trim the mascot for display.
const TWO_WORD_MASCOTS = [
  "Black Knights", "Golden Gophers", "Golden Bears", "Golden Flashes",
  "Golden Hurricane", "Golden Eagles", "Golden Panthers", "Yellow Jackets",
  "Fighting Illini", "Fighting Irish", "Fighting Camels", "Fighting Hawks",
  "Sun Devils", "Blue Devils", "Blue Hens", "Blue Raiders", "Red Raiders",
  "Red Wolves", "Red Flash", "Crimson Tide", "Demon Deacons", "Tar Heels",
  "Nittany Lions", "Mean Green", "Horned Frogs", "Ragin Cajuns",
  "Ragin' Cajuns", "Thundering Herd", "Wolf Pack", "Rainbow Warriors",
  "Runnin Bulldogs", "Runnin' Bulldogs", "Scarlet Knights", "Green Wave",
  "Mountain Hawks", "Big Green", "Big Red", "Purple Eagles", "River Hawks",
];

export function shortTeam(name: string): string {
  for (const m of TWO_WORD_MASCOTS) {
    if (name.endsWith(" " + m)) return name.slice(0, -m.length - 1);
  }
  const i = name.lastIndexOf(" ");
  return i > 0 ? name.slice(0, i) : name;
}

/** The name the board shows: the school for college, the nickname for the NFL ("Kansas City Chiefs" is "Chiefs"). */
export function displayTeam(league: League, name: string): string {
  if (league === "ncaaf") return shortTeam(name);
  const i = name.lastIndexOf(" ");
  return i > 0 ? name.slice(i + 1) : name;
}

// Conference membership (and isPower) lives in pickem-conferences.ts.

export const ALWAYS_FEATURED = ["Arkansas Razorbacks"];

// ---------------------------------------------------------------------------
// Parlay legs: how a pick on a game becomes a line, a price and a label.

export function legLabel(g: PickemGame, market: Market, selection: Selection): string {
  const home = displayTeam(g.league, g.home_team);
  const away = displayTeam(g.league, g.away_team);
  if (market === "total") return `${selection === "over" ? "Over" : "Under"} ${g.total} (${away} @ ${home})`;
  const team = selection === "home" ? home : away;
  if (market === "ml") return `${team} ML`;
  const sp = selection === "home" ? g.spread_home : g.spread_home == null ? null : -g.spread_home;
  return `${team} ${sp == null ? "" : sp > 0 ? `+${sp}` : sp}`;
}

/** The picked side's number and the price we lock: consensus for moneylines, best book for spreads and totals. */
export function legLineAndPrice(g: PickemGame, market: Market, selection: Selection): { line: number | null; price: number } {
  if (market === "ml") {
    return { line: null, price: (selection === "home" ? g.ml_home : g.ml_away) ?? -110 };
  }
  if (market === "total") {
    const b = selection === "over" ? g.best.over : g.best.under;
    return { line: g.total, price: b?.price ?? -110 };
  }
  const b = selection === "home" ? g.best.spread_home : g.best.spread_away;
  const line = selection === "home" ? g.spread_home : g.spread_home == null ? null : -g.spread_home;
  return { line, price: b?.price ?? -110 };
}

/** Price on the other side of the same market, for taking the vig out. Null when we do not have it. */
export function opposingPrice(g: PickemGame, market: Market, selection: Selection): number | null {
  if (market === "ml") return (selection === "home" ? g.ml_away : g.ml_home) ?? null;
  if (market === "total") return (selection === "over" ? g.best.under : g.best.over)?.price ?? null;
  return (selection === "home" ? g.best.spread_away : g.best.spread_home)?.price ?? null;
}
