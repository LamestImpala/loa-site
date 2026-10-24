// Outside data the house is shown about a game: college team ratings from
// CollegeFootballData, NFL EPA per play from nflverse, injured NFL starters
// from Sleeper, Pinnacle's line from The Odds API, the forecast at kickoff
// from Open-Meteo, each team's rest from our own schedule, and a news digest
// from a Claude research call. Browser-safe, pure: the fetching is in
// pickem-server.ts.
import { ALWAYS_FEATURED, shortTeam, type BestLines, type League } from "./pickem.ts";
import { isPower } from "./pickem-conferences.ts";
import { espnTeamId } from "./pickem-logos.ts";
import { homeVenue, utcOffsetHours, type Venue } from "./pickem-venues.ts";

/** SP+ is points better than an average team; on defense a lower number is better. */
export type TeamRatings = {
  sp: number | null;
  sp_off: number | null;
  sp_def: number | null;
  elo: number | null;
  off_success: number | null;
  def_success: number | null;
  off_explosiveness: number | null;
  def_explosiveness: number | null;
};

/**
 * EPA per play. def is what the team's opponents did against it, so lower is
 * better. adj_off and adj_def are opponent-adjusted: each game's EPA per play
 * less what that opponent allowed (or gained) per play over its season,
 * averaged over the team's games. adj_off above 0 is an offense better than
 * its opponents' defenses let teams be; adj_def below 0 is a defense better
 * than its opponents' offenses usually are.
 */
export type TeamEpa = {
  games: number;
  adj_off: number | null;
  adj_def: number | null;
  off: number | null;
  off_pass: number | null;
  off_rush: number | null;
  def: number | null;
  def_pass: number | null;
  def_rush: number | null;
  off_last3: number | null;
  def_last3: number | null;
};

export type Injury = { name: string; pos: string; status: string };

type Sides<T> = { home: T; away: T };

export type GameSignals = {
  ratings?: Sides<TeamRatings>;
  /** ESPN FPI's predicted home margin; compares with -spread_home. */
  fpi_home_margin?: number;
  epa?: Sides<TeamEpa>;
  injuries?: Sides<Injury[]>;
  pinnacle?: PinnacleLine;
  /** Shown to the house only: how the consensus and the best numbers sit against Pinnacle's no-vig line. */
  vs_pinnacle?: VsPinnacle;
  weather?: Weather;
  schedule?: Sides<TeamRest>;
  news?: NewsDigest;
};

// pickem_game_signals.source, and the GameSignals field each one fills.
export const SIGNAL_SOURCES = {
  cfbd: "ratings",
  nflverse: "epa",
  sleeper: "injuries",
  pinnacle: "pinnacle",
  weather: "weather",
  schedule: "schedule",
  news: "news",
} as const;
export type SignalSource = keyof typeof SIGNAL_SOURCES;
export type SignalRow = { game_id: string; source: string; taken_at: string; data: unknown };

/** The newest row of each source per game, as the object the house is shown. */
export function latestSignals(rows: SignalRow[]): Map<string, GameSignals> {
  const out = new Map<string, GameSignals>();
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (!(r.source in SIGNAL_SOURCES)) continue;
    const key = `${r.game_id}|${r.source}`;
    const prev = seen.get(key);
    if (prev && prev >= r.taken_at) continue;
    seen.set(key, r.taken_at);
    const signals = out.get(r.game_id) ?? {};
    Object.assign(signals, { [SIGNAL_SOURCES[r.source as SignalSource]]: r.data });
    out.set(r.game_id, signals);
  }
  return out;
}

const round = (v: number | null | undefined, places: number): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** places) / 10 ** places;

// ---------------------------------------------------------------------------
// CollegeFootballData

export type CfbdTeam = { id: number; school: string; alternateNames?: string[] | null };
export type CfbdSp = { team: string; rating?: number | null; offense?: { rating?: number | null } | null; defense?: { rating?: number | null } | null };
export type CfbdElo = { team: string; elo?: number | null };
type CfbdUnit = { successRate?: number | null; explosiveness?: number | null } | null;
export type CfbdAdvanced = { team: string; offense?: CfbdUnit; defense?: CfbdUnit };

const plain = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

/**
 * CFBD's school name for one of our teams, or null (an FCS team, or a
 * spelling we do not know). Matched on the ESPN team id first, then on the
 * school name and its alternates.
 */
export function cfbdSchool(teamName: string, teams: CfbdTeam[]): string | null {
  const id = espnTeamId("ncaaf", teamName);
  const byId = id == null ? undefined : teams.find((t) => String(t.id) === id);
  if (byId) return byId.school;
  const want = plain(shortTeam(teamName));
  const byName = teams.find((t) => [t.school, ...(t.alternateNames ?? [])].some((n) => plain(n) === want));
  return byName?.school ?? null;
}

/** Ratings per CFBD school from the three season feeds. */
export function cfbdRatings(sp: CfbdSp[], elo: CfbdElo[], advanced: CfbdAdvanced[]): Map<string, TeamRatings> {
  const out = new Map<string, TeamRatings>();
  const at = (school: string) => {
    let r = out.get(school);
    if (!r) {
      r = { sp: null, sp_off: null, sp_def: null, elo: null, off_success: null, def_success: null, off_explosiveness: null, def_explosiveness: null };
      out.set(school, r);
    }
    return r;
  };
  for (const s of sp) Object.assign(at(s.team), { sp: round(s.rating, 1), sp_off: round(s.offense?.rating, 1), sp_def: round(s.defense?.rating, 1) });
  for (const e of elo) at(e.team).elo = round(e.elo, 0);
  for (const a of advanced) {
    Object.assign(at(a.team), {
      off_success: round(a.offense?.successRate, 3),
      def_success: round(a.defense?.successRate, 3),
      off_explosiveness: round(a.offense?.explosiveness, 2),
      def_explosiveness: round(a.defense?.explosiveness, 2),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// NFL: nflverse and Sleeper use upper-case abbreviations that differ from
// ESPN's for two teams.

const NFL_ABBR_FIXES = { nflverse: { wsh: "WAS", lar: "LA" }, sleeper: { wsh: "WAS" } } as const;

/** A team's abbreviation in nflverse's or Sleeper's data, or null when we do not know the team. */
export function nflAbbr(teamName: string, source: "nflverse" | "sleeper"): string | null {
  const code = espnTeamId("nfl", teamName);
  if (code == null) return null;
  return (NFL_ABBR_FIXES[source] as Record<string, string>)[code] ?? code.toUpperCase();
}

export type TeamWeek = { week: number; team: string; opp: string; pass_epa: number; rush_epa: number; pass_plays: number; rush_plays: number };

/** nflverse's stats_team_week file, one row per team per game. */
export function parseTeamWeeks(csv: string): TeamWeek[] {
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(",");
  const at = Object.fromEntries(
    ["week", "team", "opponent_team", "attempts", "sacks_suffered", "carries", "passing_epa", "rushing_epa"].map((c) => [c, cols.indexOf(c)])
  );
  if (Object.values(at).some((i) => i < 0)) throw new Error("nflverse team stats: missing columns");
  return lines.map((line) => {
    const f = line.split(",");
    const n = (c: string) => Number(f[at[c]]) || 0;
    return {
      week: n("week"),
      team: f[at.team],
      opp: f[at.opponent_team],
      pass_epa: n("passing_epa"),
      rush_epa: n("rushing_epa"),
      // A dropback is an attempt or a sack; passing_epa covers both.
      pass_plays: n("attempts") + n("sacks_suffered"),
      rush_plays: n("carries"),
    };
  });
}

function perPlay(games: TeamWeek[]) {
  const sum = (k: "pass_epa" | "rush_epa" | "pass_plays" | "rush_plays") => games.reduce((a, g) => a + g[k], 0);
  const div = (a: number, b: number) => (b ? round(a / b, 3) : null);
  return { all: div(sum("pass_epa") + sum("rush_epa"), sum("pass_plays") + sum("rush_plays")), pass: div(sum("pass_epa"), sum("pass_plays")), rush: div(sum("rush_epa"), sum("rush_plays")) };
}

/** One team-game's EPA per play, unrounded. */
function gameEpa(r: TeamWeek): number | null {
  const plays = r.pass_plays + r.rush_plays;
  return plays ? (r.pass_epa + r.rush_epa) / plays : null;
}

/** Season and last-three-games EPA per play for every team, keyed by nflverse abbreviation. */
export function teamEpa(rows: TeamWeek[]): Map<string, TeamEpa> {
  const out = new Map<string, TeamEpa>();
  const byWeek = (a: TeamWeek, b: TeamWeek) => a.week - b.week;
  const teams = [...new Set(rows.map((r) => r.team))];
  // Each team's season EPA per play gained and allowed, unrounded, for the adjustment.
  const seasonPer = (xs: TeamWeek[]) => {
    const plays = xs.reduce((a, r) => a + r.pass_plays + r.rush_plays, 0);
    return plays ? xs.reduce((a, r) => a + r.pass_epa + r.rush_epa, 0) / plays : null;
  };
  const gained = new Map(teams.map((t) => [t, seasonPer(rows.filter((r) => r.team === t))]));
  const allowed = new Map(teams.map((t) => [t, seasonPer(rows.filter((r) => r.opp === t))]));
  const mean = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x != null);
    return ok.length ? round(ok.reduce((a, x) => a + x, 0) / ok.length, 3) : null;
  };
  const less = (a: number | null, b: number | null | undefined) => (a == null || b == null ? null : a - b);
  for (const team of teams) {
    const off = rows.filter((r) => r.team === team).sort(byWeek);
    const def = rows.filter((r) => r.opp === team).sort(byWeek);
    const o = perPlay(off);
    const d = perPlay(def);
    out.set(team, {
      games: off.length,
      // Against each opponent: what we gained less what it allows, and what it gained on us less what it gains.
      adj_off: mean(off.map((r) => less(gameEpa(r), allowed.get(r.opp)))),
      adj_def: mean(def.map((r) => less(gameEpa(r), gained.get(r.team)))),
      off: o.all,
      off_pass: o.pass,
      off_rush: o.rush,
      def: d.all,
      def_pass: d.pass,
      def_rush: d.rush,
      off_last3: perPlay(off.slice(-3)).all,
      def_last3: perPlay(def.slice(-3)).all,
    });
  }
  return out;
}

export type SleeperPlayer = {
  full_name?: string | null;
  team?: string | null;
  position?: string | null;
  injury_status?: string | null;
  depth_chart_order?: number | null;
};

/**
 * Injured starters per Sleeper team, quarterbacks first. A starter is first
 * on the depth chart at his position, plus the second quarterback.
 */
export function keyInjuries(players: Iterable<SleeperPlayer>): Map<string, Injury[]> {
  const out = new Map<string, Injury[]>();
  for (const p of players) {
    if (!p.team || !p.injury_status || p.injury_status === "NA") continue;
    const qb = p.position === "QB";
    if (p.depth_chart_order !== 1 && !(qb && p.depth_chart_order === 2)) continue;
    const list = out.get(p.team) ?? [];
    list.push({ name: p.full_name ?? "?", pos: p.position ?? "?", status: p.injury_status });
    out.set(p.team, list);
  }
  const rank = (i: Injury) => (i.pos === "QB" ? 0 : 1);
  for (const list of out.values()) list.sort((a, b) => rank(a) - rank(b) || a.pos.localeCompare(b.pos) || a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------------------
// Pinnacle: the sharp book's line and the fair number it implies once the
// vig is out. Fetched from The Odds API (bookmakers=pinnacle) by the house
// and research jobs only, since every fetch costs 3 requests.

/** The slice of an Odds API event this reads. */
export type OddsEventLike = {
  id: string;
  home_team: string;
  away_team: string;
  bookmakers: { key: string; last_update?: string; markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[] }[];
};

/**
 * Win probability moved per point off the number, near the middle of the
 * distribution. Rough: NFL margins cluster on 3 and 7, college margins are
 * wider, totals wider still. Only used to turn a price imbalance into points.
 */
export const PROB_PER_POINT: Record<League, { spread: number; total: number }> = {
  nfl: { spread: 0.03, total: 0.025 },
  ncaaf: { spread: 0.025, total: 0.02 },
};

export type PinnacleLine = {
  spread_home: number | null;
  spread_home_price: number | null;
  spread_away_price: number | null;
  total: number | null;
  over_price: number | null;
  under_price: number | null;
  ml_home: number | null;
  ml_away: number | null;
  /** No-vig: the home spread and total at which both sides are even money, and the home team's chance to win. */
  fair: { spread_home: number | null; total: number | null; home_win: number | null };
  updated_at: string | null;
};

const implied = (price: number) => (price > 0 ? 100 / (price + 100) : -price / (-price + 100));

/** The first side's share of the pair's implied probability: the vig taken out proportionally. */
export function noVig(price: number, other: number): number {
  const a = implied(price);
  return a / (a + implied(other));
}

/** Pinnacle's line on one Odds API event, with its fair numbers; null when Pinnacle has no market on it. */
export function pinnacleLine(league: League, ev: OddsEventLike): PinnacleLine | null {
  const book = ev.bookmakers.find((b) => b.key === "pinnacle");
  if (!book) return null;
  const market = (k: string) => book.markets.find((m) => m.key === k)?.outcomes ?? [];
  const spreads = market("spreads");
  const totals = market("totals");
  const h2h = market("h2h");
  const sh = spreads.find((o) => o.name === ev.home_team);
  const sa = spreads.find((o) => o.name === ev.away_team);
  const over = totals.find((o) => o.name === "Over");
  const under = totals.find((o) => o.name === "Under");
  const mh = h2h.find((o) => o.name === ev.home_team);
  const ma = h2h.find((o) => o.name === ev.away_team);
  if (!sh && !over && !mh) return null;
  const k = PROB_PER_POINT[league];
  // A side priced above even money to cover at the number deserves a bigger number: move it by the imbalance in points.
  const fairSpread = sh?.point != null && sa ? round(sh.point - (noVig(sh.price, sa.price) - 0.5) / k.spread, 1) : (sh?.point ?? null);
  const fairTotal = over?.point != null && under ? round(over.point + (noVig(over.price, under.price) - 0.5) / k.total, 1) : (over?.point ?? null);
  return {
    spread_home: sh?.point ?? null,
    spread_home_price: sh?.price ?? null,
    spread_away_price: sa?.price ?? null,
    total: over?.point ?? null,
    over_price: over?.price ?? null,
    under_price: under?.price ?? null,
    ml_home: mh?.price ?? null,
    ml_away: ma?.price ?? null,
    fair: { spread_home: fairSpread, total: fairTotal, home_win: mh && ma ? round(noVig(mh.price, ma.price), 3) : null },
    updated_at: book.last_update ?? null,
  };
}

/**
 * Points, with Pinnacle's no-vig line as the reference. consensus: our
 * median less Pinnacle's fair number (home spread and total). best: how many
 * points better than Pinnacle's fair number the best available line is for a
 * bettor on each side; positive is value.
 */
export type VsPinnacle = {
  consensus: { spread_home: number | null; total: number | null };
  best: { home: number | null; away: number | null; over: number | null; under: number | null };
};

export function vsPinnacle(g: { spread_home: number | null; total: number | null; best: BestLines }, pin: PinnacleLine): VsPinnacle {
  const fs = pin.fair.spread_home;
  const ft = pin.fair.total;
  const d = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : round(a - b, 1));
  return {
    consensus: { spread_home: d(g.spread_home, fs), total: d(g.total, ft) },
    best: {
      home: d(g.best.spread_home?.point, fs),
      away: fs == null ? null : d(g.best.spread_away?.point, -fs),
      over: d(ft, g.best.over?.point),
      under: d(g.best.under?.point, ft),
    },
  };
}

// ---------------------------------------------------------------------------
// Weather at kickoff, from Open-Meteo's hourly forecast (free, no key).

export type Weather = {
  venue: string;
  indoor: boolean;
  /** At the kickoff hour; absent indoors or past the forecast's range. */
  temp_f?: number | null;
  wind_mph?: number | null;
  gust_mph?: number | null;
  precip_pct?: number | null;
  /** The strongest sustained wind from kickoff through the next three hours. */
  wind_max_mph?: number | null;
};

/** The slice of an Open-Meteo forecast this reads (requested with timezone=UTC, mph and Fahrenheit). */
export type OpenMeteo = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation_probability?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
  };
};

/** The forecast at a venue for a kickoff, or null when the forecast does not reach it. */
export function parseWeather(venue: Venue, kickoff: string, forecast: OpenMeteo | null): Weather | null {
  if (venue.dome) return { venue: venue.name, indoor: true };
  const h = forecast?.hourly;
  if (!h?.time?.length) return null;
  const hour = new Date(Date.parse(kickoff));
  hour.setUTCMinutes(0, 0, 0);
  const want = hour.toISOString().slice(0, 13); // "2026-10-17T19"
  const i = h.time.findIndex((t) => t.slice(0, 13) === want);
  if (i < 0) return null;
  const at = (xs: (number | null)[] | undefined, j = i) => {
    const x = xs?.[j];
    return typeof x === "number" ? Math.round(x) : null;
  };
  const window = [0, 1, 2, 3].map((k) => at(h.wind_speed_10m, i + k)).filter((x): x is number => x != null);
  return {
    venue: venue.name,
    indoor: false,
    temp_f: at(h.temperature_2m),
    wind_mph: at(h.wind_speed_10m),
    gust_mph: at(h.wind_gusts_10m),
    precip_pct: at(h.precipitation_probability),
    wind_max_mph: window.length ? Math.max(...window) : null,
  };
}

// ---------------------------------------------------------------------------
// Rest and travel, from our own schedule.

export type TeamRest = {
  /** Calendar days (Eastern) since the team's last game this season; null when unknown or its first game. */
  days_rest: number | null;
  bye: boolean | null;
  short_week: boolean | null;
  /** NFL: hours the team's body clock is behind the kickoff site's (positive: travelled east). */
  tz_delta?: number | null;
};

type ScheduledGame = { home_team: string; away_team: string; commence_time: string };

const easternDay = (iso: string) => {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return Date.parse(`${ymd}T00:00:00Z`) / 86400000;
};

/**
 * Whether the board carries every game a team plays. The NFL board has every
 * game; college has every game with a Power Four team (or one we always
 * feature), so a smaller school's previous game may be missing.
 */
function fullSchedule(league: League, team: string): boolean {
  return league === "nfl" || isPower(team) || ALWAYS_FEATURED.includes(team);
}

/**
 * One team's rest before a game, from the season's games on the board.
 * `site` is where the game is when that is known to differ from the home
 * team's stadium (a neutral site); the NFL time-zone change is measured to it.
 */
export function teamRest(league: League, team: string, game: ScheduledGame, season: ScheduledGame[], site?: Venue): TeamRest {
  const kick = Date.parse(game.commence_time);
  const prev = season
    .filter((g) => (g.home_team === team || g.away_team === team) && Date.parse(g.commence_time) < kick)
    .sort((a, b) => b.commence_time.localeCompare(a.commence_time))[0];
  const days = prev ? easternDay(game.commence_time) - easternDay(prev.commence_time) : null;
  // Two weeks or more since the last game we have: a bye, unless the team's other games may be off the board.
  const unknown = days == null || (days >= 13 && !fullSchedule(league, team));
  const rest: TeamRest = unknown
    ? { days_rest: null, bye: null, short_week: null }
    : { days_rest: days, bye: days! >= 13, short_week: days! < 7 };
  if (league === "nfl") {
    const at = site ?? homeVenue("nfl", game.home_team);
    const own = homeVenue("nfl", team);
    rest.tz_delta = at && own ? utcOffsetHours(at.tz, new Date(kick)) - utcOffsetHours(own.tz, new Date(kick)) : null;
  }
  return rest;
}

// ---------------------------------------------------------------------------
// News digest: what a research call (lib/pickem-server.ts researchGames)
// found about a game, dated and sourced.

export type NewsItem = { team: "home" | "away"; player: string | null; detail: string; source: string; date: string | null };
export type NewsDigest = {
  injuries: NewsItem[];
  quarterbacks: { home: string; away: string };
  weather: string | null;
  suspensions: NewsItem[];
  coaching: NewsItem[];
  what_changed: string;
  model: string;
  researched_at: string;
};

/**
 * A string cut to `max` characters, ending in an ellipsis when it was longer.
 * Structured output holds the JSON to its shape, not its string lengths, so a
 * `.max()` in an output schema can only fail the parse and lose the whole
 * call; sizes are applied here, after parsing, instead.
 */
export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A digest with its text cut to the sizes the house is shown: 300 characters an item, 200 a quarterback line, 300 for weather, 240 for what changed. */
export function clipDigest<D extends Pick<NewsDigest, "injuries" | "quarterbacks" | "weather" | "suspensions" | "coaching" | "what_changed">>(d: D): D {
  const items = (xs: NewsItem[]) => xs.map((x) => ({ ...x, detail: clip(x.detail, 300) }));
  return {
    ...d,
    injuries: items(d.injuries),
    suspensions: items(d.suspensions),
    coaching: items(d.coaching),
    quarterbacks: { home: clip(d.quarterbacks.home, 200), away: clip(d.quarterbacks.away, 200) },
    weather: d.weather == null ? null : clip(d.weather, 300),
    what_changed: clip(d.what_changed, 240),
  };
}

// ---------------------------------------------------------------------------
// Which games get a research call.

/** College slate tiers, as selectSlate orders them: 0 a featured team, 1 Power Four vs Power Four, 2 one Power Four team, 3 inside 14, 4 the rest. */
export function collegeTier(home: string, away: string, absSpread: number): number {
  if (ALWAYS_FEATURED.includes(home) || ALWAYS_FEATURED.includes(away)) return 0;
  const p = Number(isPower(home)) + Number(isPower(away));
  if (p === 2) return 1;
  if (p === 1) return 2;
  return absSpread <= 14 ? 3 : 4;
}

/** Research is spent on games inside 10 points, the top two college tiers, and every NFL game. */
export function wantsResearch(league: League, g: { home_team: string; away_team: string; spread_home: number | null }): boolean {
  if (league === "nfl") return true;
  const spread = Math.abs(g.spread_home ?? 99);
  return spread <= 10 || collegeTier(g.home_team, g.away_team, spread) <= 1;
}
