// Live scores from ESPN's public scoreboard: matching its events to our
// games, turning its status into the clock column, and laying the result
// over the rows. Pure, no I/O, so it runs under node --test.
import type { League, LiveScore, PickemGame } from "./pickem.ts";
import { espnTeamId } from "./pickem-logos.ts";

/** The slice of an ESPN scoreboard event we read. */
export type EspnEvent = {
  id: string;
  date: string;
  status: {
    period: number;
    displayClock: string;
    type: { name: string; state: string; completed: boolean; shortDetail: string };
  };
  competitions: {
    competitors: { homeAway: string; score: string; team: { id: string; abbreviation: string } }[];
  }[];
};

/** Live scores by our game id. Only games ESPN has as in play or over. */
export type LiveMap = Record<string, LiveScore>;

/** What the live route returns. */
export type LivePayload = { league: League; asOf: string; scores: LiveMap; graded: number; pending: number };

type GameRef = Pick<PickemGame, "id" | "league" | "home_team" | "away_team" | "commence_time">;

/** ESPN and the books can disagree on kickoff by a bit; a whole different week is not a match. */
export const MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;

function periodLabel(p: number): string {
  if (p < 1) return "";
  if (p <= 4) return ["1st", "2nd", "3rd", "4th"][p - 1];
  return p === 5 ? "OT" : `${p - 4}OT`;
}

/** "2nd 4:48", "Half", "End 3rd", "OT 2:10", "Final", "Final/OT", or ESPN's own words for anything else. */
export function fmtLiveStatus(s: EspnEvent["status"]): string {
  const t = s.type;
  if (t.completed) return /^Final/.test(t.shortDetail) ? t.shortDetail : "Final";
  switch (t.name) {
    case "STATUS_HALFTIME":
      return "Half";
    case "STATUS_END_PERIOD":
      return `End ${periodLabel(s.period)}`.trim();
    case "STATUS_IN_PROGRESS": {
      const label = periodLabel(s.period);
      return label ? `${label} ${s.displayClock}` : "Live";
    }
    case "STATUS_DELAYED":
      return "Delayed";
    default:
      return t.shortDetail;
  }
}

/** The id we compare an ESPN competitor by; see espnTeamId. */
function competitorKey(league: League, c: EspnEvent["competitions"][0]["competitors"][0]): string {
  return league === "nfl" ? c.team.abbreviation.toLowerCase() : c.team.id;
}

function sides(ev: EspnEvent) {
  const comp = ev.competitions[0];
  if (!comp) return null;
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  return home && away ? { home, away } : null;
}

/**
 * Pair our games with ESPN's events by both teams' ids and a kickoff within
 * the window. A neutral-site game may have home and away the other way
 * round at ESPN; the scores are swapped back. Games ESPN lists as not yet
 * started, or that we cannot pair, are left out.
 */
export function matchEvents(league: League, games: GameRef[], events: EspnEvent[]): LiveMap {
  const byKey = new Map<string, EspnEvent[]>();
  for (const ev of events) {
    const s = sides(ev);
    if (!s) continue;
    const key = `${competitorKey(league, s.home)}|${competitorKey(league, s.away)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), ev]);
  }

  const out: LiveMap = {};
  for (const g of games) {
    const h = espnTeamId(g.league, g.home_team);
    const a = espnTeamId(g.league, g.away_team);
    if (!h || !a) continue;
    const kick = Date.parse(g.commence_time);
    const near = (ev: EspnEvent) => Math.abs(Date.parse(ev.date) - kick) <= MATCH_WINDOW_MS;
    let swapped = false;
    let ev = byKey.get(`${h}|${a}`)?.find(near);
    if (!ev) {
      ev = byKey.get(`${a}|${h}`)?.find(near);
      swapped = true;
    }
    if (!ev) continue;
    const state = ev.status.type.state;
    if (state !== "in" && state !== "post") continue;
    const s = sides(ev)!;
    const espnHome = Number(s.home.score);
    const espnAway = Number(s.away.score);
    if (!Number.isFinite(espnHome) || !Number.isFinite(espnAway)) continue;
    out[g.id] = {
      state,
      home: swapped ? espnAway : espnHome,
      away: swapped ? espnHome : espnAway,
      status: fmtLiveStatus(ev.status),
      completed: ev.status.type.completed,
    };
  }
  return out;
}

/**
 * The rows with live scores laid over them. A row the database has already
 * graded keeps its own score; the rest take ESPN's, and go final when ESPN
 * calls the game.
 */
export function applyLive(games: PickemGame[], live: LiveMap): PickemGame[] {
  return games.map((g) => {
    const l = live[g.id];
    if (!l || g.completed) return g;
    return { ...g, home_score: l.home, away_score: l.away, completed: l.completed, live: l };
  });
}

/** Whether anything on the slate has kicked off and is not yet final, so the board should be polling. */
export function hasGamesInPlay(games: PickemGame[], live: LiveMap, now: number): boolean {
  return games.some((g) => !g.completed && !live[g.id]?.completed && Date.parse(g.commence_time) <= now);
}

/** ESPN's `dates=` value for a kickoff: the calendar day in Eastern time, as YYYYMMDD. */
export function espnDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms))
    .replace(/-/g, "");
}
