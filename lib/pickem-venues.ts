// Where games are played, for the weather and travel signals: every NFL
// stadium (by hand, below) and every FBS home stadium plus the larger neutral
// sites (generated from CollegeFootballData into pickem-venues-ncaaf.ts by
// scripts/gen-venues.mjs, cached here so nothing is fetched at run time).
// Browser-safe, pure.
import type { League } from "./pickem.ts";
import { espnTeamId } from "./pickem-logos.ts";
import { COLLEGE_HOME_VENUES, COLLEGE_VENUES } from "./pickem-venues-ncaaf.ts";

/** dome is any roof the weather does not reach in practice: fixed, retractable or canopy. */
export type Venue = { name: string; lat: number; lon: number; dome: boolean; tz: string };

const v = (name: string, lat: number, lon: number, dome: boolean, tz: string): Venue => ({ name, lat, lon, dome, tz });
const ET = "America/New_York";
const CT = "America/Chicago";
const PT = "America/Los_Angeles";

/** Home stadium by ESPN's NFL code (espnTeamId). Retractable roofs count as domes. */
export const NFL_HOME_VENUES: Record<string, Venue> = {
  ari: v("State Farm Stadium", 33.5276, -112.2626, true, "America/Phoenix"),
  atl: v("Mercedes-Benz Stadium", 33.7554, -84.4009, true, ET),
  bal: v("M&T Bank Stadium", 39.278, -76.6227, false, ET),
  buf: v("Highmark Stadium", 42.7738, -78.787, false, ET),
  car: v("Bank of America Stadium", 35.2258, -80.8528, false, ET),
  chi: v("Soldier Field", 41.8623, -87.6167, false, CT),
  cin: v("Paycor Stadium", 39.0955, -84.5161, false, ET),
  cle: v("Huntington Bank Field", 41.5061, -81.6995, false, ET),
  dal: v("AT&T Stadium", 32.7473, -97.0945, true, CT),
  den: v("Empower Field at Mile High", 39.7439, -105.0201, false, "America/Denver"),
  det: v("Ford Field", 42.34, -83.0456, true, "America/Detroit"),
  gb: v("Lambeau Field", 44.5013, -88.0622, false, CT),
  hou: v("NRG Stadium", 29.6847, -95.4107, true, CT),
  ind: v("Lucas Oil Stadium", 39.7601, -86.1639, true, "America/Indiana/Indianapolis"),
  jax: v("EverBank Stadium", 30.3239, -81.6373, false, ET),
  kc: v("GEHA Field at Arrowhead Stadium", 39.0489, -94.4839, false, CT),
  lv: v("Allegiant Stadium", 36.0909, -115.1833, true, PT),
  lac: v("SoFi Stadium", 33.9535, -118.3392, true, PT),
  lar: v("SoFi Stadium", 33.9535, -118.3392, true, PT),
  mia: v("Hard Rock Stadium", 25.958, -80.2389, false, ET),
  min: v("U.S. Bank Stadium", 44.9737, -93.2575, true, CT),
  ne: v("Gillette Stadium", 42.0909, -71.2643, false, ET),
  no: v("Caesars Superdome", 29.9511, -90.0812, true, CT),
  nyg: v("MetLife Stadium", 40.8135, -74.0745, false, ET),
  nyj: v("MetLife Stadium", 40.8135, -74.0745, false, ET),
  phi: v("Lincoln Financial Field", 39.9008, -75.1675, false, ET),
  pit: v("Acrisure Stadium", 40.4468, -80.0158, false, ET),
  sf: v("Levi's Stadium", 37.403, -121.97, false, PT),
  sea: v("Lumen Field", 47.5952, -122.3316, false, PT),
  tb: v("Raymond James Stadium", 27.9759, -82.5033, false, ET),
  ten: v("Nissan Stadium", 36.1665, -86.7713, false, CT),
  wsh: v("Northwest Stadium", 38.9077, -76.8645, false, ET),
};

/** International and other neutral NFL sites, looked up by ESPN's venue name. Add one when the sync lists it unmatched. */
export const NFL_NEUTRAL_VENUES: Venue[] = [
  v("Tottenham Hotspur Stadium", 51.6043, -0.0664, false, "Europe/London"),
  v("Wembley Stadium", 51.556, -0.2796, false, "Europe/London"),
  v("Croke Park", 53.3607, -6.2511, false, "Europe/Dublin"),
  v("Allianz Arena", 48.2188, 11.6247, false, "Europe/Berlin"),
  v("Olympiastadion Berlin", 52.5147, 13.2395, false, "Europe/Berlin"),
  v("Deutsche Bank Park", 50.0686, 8.6455, false, "Europe/Berlin"),
  v("Estadio Santiago Bernabéu", 40.4531, -3.6883, true, "Europe/Madrid"),
  v("Estadio Banorte", 19.3029, -99.1505, false, "America/Mexico_City"),
  v("Neo Química Arena", -23.5453, -46.4742, false, "America/Sao_Paulo"),
  v("Maracanã", -22.9121, -43.2302, false, "America/Sao_Paulo"),
  v("Melbourne Cricket Ground", -37.82, 144.9834, false, "Australia/Melbourne"),
];

const plain = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** A team's home stadium, or undefined when we do not know the team. */
export function homeVenue(league: League, teamName: string): Venue | undefined {
  const id = espnTeamId(league, teamName);
  if (id == null) return undefined;
  return league === "nfl" ? NFL_HOME_VENUES[id] : COLLEGE_HOME_VENUES[id];
}

/** A venue by name (ESPN's spelling), for neutral sites. */
export function venueByName(league: League, name: string): Venue | undefined {
  const want = plain(name);
  const pool = league === "nfl" ? [...NFL_NEUTRAL_VENUES, ...Object.values(NFL_HOME_VENUES)] : [...COLLEGE_VENUES, ...Object.values(COLLEGE_HOME_VENUES)];
  return pool.find((x) => plain(x.name) === want);
}

/** What ESPN says about where a game is: neutral site or not, and the venue's name and roof. */
export type EspnSite = { neutral: boolean; name: string | null; indoor: boolean | null };

/**
 * Where a game is played. A neutral site is looked up by ESPN's venue name
 * (undefined when we do not have it); otherwise the home team's stadium.
 * ESPN's indoor flag, when it has one, overrides the table's roof.
 */
export function gameVenue(league: League, homeTeam: string, site?: EspnSite): Venue | undefined {
  const base = site?.neutral && site.name ? venueByName(league, site.name) : homeVenue(league, homeTeam);
  if (!base) return undefined;
  return site?.indoor == null ? base : { ...base, dome: site.indoor };
}

/** A time zone's offset from UTC in hours at an instant ("America/Chicago" in October is -5). */
export function utcOffsetHours(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const h = Number(m[2]) + Number(m[3] ?? 0) / 60;
  return m[1] === "-" ? -h : h;
}
