// Outside data the house is shown about a game: college team ratings from
// CollegeFootballData, NFL EPA per play from nflverse, and injured NFL
// starters from Sleeper. Browser-safe, pure: the fetching is in
// pickem-server.ts.
import { shortTeam } from "./pickem.ts";
import { espnTeamId } from "./pickem-logos.ts";

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

/** EPA per play. def is what the team's opponents did against it, so lower is better. */
export type TeamEpa = {
  games: number;
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
};

// pickem_game_signals.source, and the GameSignals field each one fills.
export const SIGNAL_SOURCES = { cfbd: "ratings", nflverse: "epa", sleeper: "injuries" } as const;
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

/** Season and last-three-games EPA per play for every team, keyed by nflverse abbreviation. */
export function teamEpa(rows: TeamWeek[]): Map<string, TeamEpa> {
  const out = new Map<string, TeamEpa>();
  const byWeek = (a: TeamWeek, b: TeamWeek) => a.week - b.week;
  for (const team of new Set(rows.map((r) => r.team))) {
    const off = rows.filter((r) => r.team === team).sort(byWeek);
    const def = rows.filter((r) => r.opp === team).sort(byWeek);
    const o = perPlay(off);
    const d = perPlay(def);
    out.set(team, {
      games: off.length,
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
