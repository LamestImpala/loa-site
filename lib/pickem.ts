// Shared pick'em types and pure helpers. Browser-safe: no secrets, no I/O.

export const PICKEM_SEASON = 2026;
// Weeks run Tuesday through Monday. Week 1 is the week of Sat Sept 5, 2026,
// which is how the books label it (Aug 29 games were "Week 0").
const WEEK1_TUESDAY_UTC = Date.UTC(2026, 8, 1); // 2026-09-01
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function seasonWeek(date: Date): number {
  return Math.floor((date.getTime() - WEEK1_TUESDAY_UTC) / WEEK_MS) + 1;
}

/** [start, end) of a season week, in UTC. */
export function weekWindow(week: number): { start: Date; end: Date } {
  const start = new Date(WEEK1_TUESDAY_UTC + (week - 1) * WEEK_MS);
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
};

export type PickemParlay = {
  id: number;
  season: number;
  week: number;
  name: string;
  legs: ParlayLeg[];
  american_odds: number;
  confidence: number | null;
  note: string;
  locks_at: string;
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

// Conference membership (and isPower) lives in pickem-conferences.ts.

export const ALWAYS_FEATURED = ["Arkansas Razorbacks"];
