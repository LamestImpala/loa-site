// Pure grouping, filtering and formatting for the pick'em board. No React,
// no I/O, so it runs under node --test as well as in the browser.
import type { PickemGame } from "./pickem.ts";
import { CONFERENCES, conferenceOf, type Conference } from "./pickem-conferences.ts";

export type View = "soon" | "conf" | "all";

/** "Starting soon" means kickoff within this many ms of now. */
export const SOON_WINDOW_MS = 60 * 60 * 1000;

export const ET = "America/New_York";

export function kickoffMs(g: PickemGame): number {
  return Date.parse(g.commence_time);
}

function byKickoff(a: PickemGame, b: PickemGame): number {
  return kickoffMs(a) - kickoffMs(b) || a.id.localeCompare(b.id);
}

export type Buckets = {
  /** Kicks off in the next hour. Subset of upcoming. */
  soon: PickemGame[];
  /** Has not kicked off. */
  upcoming: PickemGame[];
  /** Kicked off or final. */
  started: PickemGame[];
  /** Kicked off, not yet final. Subset of started. */
  inProgress: PickemGame[];
  /** Final. Subset of started. */
  final: PickemGame[];
};

export function bucketGames(games: PickemGame[], now: number): Buckets {
  const sorted = [...games].sort(byKickoff);
  const soon: PickemGame[] = [];
  const upcoming: PickemGame[] = [];
  const started: PickemGame[] = [];
  const inProgress: PickemGame[] = [];
  const final: PickemGame[] = [];
  for (const g of sorted) {
    const k = kickoffMs(g);
    if (g.completed) {
      started.push(g);
      final.push(g);
    } else if (k <= now) {
      started.push(g);
      inProgress.push(g);
    } else {
      upcoming.push(g);
      if (k - now <= SOON_WINDOW_MS) soon.push(g);
    }
  }
  return { soon, upcoming, started, inProgress, final };
}

/** Games with at least one team in the conference. */
export function filterByConference(games: PickemGame[], conf: Conference): PickemGame[] {
  return games.filter((g) => conferenceOf(g.home_team) === conf || conferenceOf(g.away_team) === conf);
}

/** Conferences with a team on the slate, in picker order. */
export function conferencesOnSlate(games: PickemGame[]): Conference[] {
  const present = new Set<Conference>();
  for (const g of games) {
    present.add(conferenceOf(g.home_team));
    present.add(conferenceOf(g.away_team));
  }
  return CONFERENCES.filter((c) => present.has(c));
}

export type DayGroup = { key: string; label: string; games: PickemGame[] };

/** Split an ascending list into calendar days in the given zone. */
export function groupByDay(games: PickemGame[], tz: string): DayGroup[] {
  const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const labelFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const out: DayGroup[] = [];
  for (const g of [...games].sort(byKickoff)) {
    const d = new Date(kickoffMs(g));
    const key = keyFmt.format(d);
    const last = out[out.length - 1];
    if (last && last.key === key) last.games.push(g);
    else out.push({ key, label: labelFmt.format(d), games: [g] });
  }
  return out;
}

/** "7:30 PM" in the given zone. The day divider carries the weekday. */
export function fmtKick(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** "Sat 7:30 PM" for places without a day divider (masthead, empty states). */
export function fmtKickLong(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** "ET", "CT", or the zone's own short name when it is not a US zone. */
export function tzLabel(tz: string, at: number): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")?.value;
  if (!part) return "";
  const m = /^([ECMPAH])[SD]T$/.exec(part);
  return m ? `${m[1]}T` : part;
}

export type ParsedView = { view: View | "auto"; conf: Conference | null };

/** Read ?view= and ?conf= from the URL, falling back sensibly. */
export function parseView(view: string | null, conf: string | null, known: Conference[]): ParsedView {
  const c = known.find((k) => k === conf) ?? null;
  if (view === "soon" || view === "all") return { view, conf: c };
  if (view === "conf") return c ? { view: "conf", conf: c } : { view: "all", conf: null };
  if (view == null || view === "") return { view: "auto", conf: c };
  return { view: "all", conf: c };
}

export function defaultView(soonCount: number): View {
  return soonCount > 0 ? "soon" : "all";
}

/** Query string for a view, without the leading "?". Empty for the auto view. */
export function viewQuery(view: View | "auto", conf: Conference | null): string {
  const p = new URLSearchParams();
  if (view !== "auto") p.set("view", view);
  if (view === "conf" && conf) p.set("conf", conf);
  return p.toString();
}

// Sportsbook names as The Odds API spells them, shortened for the board.
const BOOK_CODES: Record<string, string> = {
  BetMGM: "MGM",
  DraftKings: "DK",
  FanDuel: "FD",
  Bovada: "BOV",
  "MyBookie.ag": "MB",
  BetRivers: "BR",
  "BetOnline.ag": "BOL",
  "LowVig.ag": "LV",
  BetUS: "BUS",
  Caesars: "CZR",
  "ESPN BET": "ESPN",
  Fanatics: "FAN",
  BetAnySports: "BAS",
  Unibet: "UNI",
  PointsBet: "PB",
  "Hard Rock Bet": "HRB",
  "Bally Bet": "BB",
  betPARX: "PARX",
  WynnBET: "WYNN",
  Bet365: "365",
};

export function bookCode(book: string | undefined): string {
  if (!book) return "";
  return BOOK_CODES[book] ?? book.replace(/\.ag$/, "").slice(0, 4).toUpperCase();
}
