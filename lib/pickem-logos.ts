// Team logos, hotlinked from ESPN's CDN. Browser-safe, pure. The "500-dark"
// set is drawn for dark backgrounds, which is what the board is.
import { shortTeam, type League } from "./pickem.ts";
import { ESPN_COLLEGE_IDS } from "./pickem-logo-ids.ts";

const CDN = "https://a.espncdn.com/i/teamlogos";

// The Odds API's NFL names to ESPN's logo codes.
const NFL_CODES: Record<string, string> = {
  "Arizona Cardinals": "ari",
  "Atlanta Falcons": "atl",
  "Baltimore Ravens": "bal",
  "Buffalo Bills": "buf",
  "Carolina Panthers": "car",
  "Chicago Bears": "chi",
  "Cincinnati Bengals": "cin",
  "Cleveland Browns": "cle",
  "Dallas Cowboys": "dal",
  "Denver Broncos": "den",
  "Detroit Lions": "det",
  "Green Bay Packers": "gb",
  "Houston Texans": "hou",
  "Indianapolis Colts": "ind",
  "Jacksonville Jaguars": "jax",
  "Kansas City Chiefs": "kc",
  "Las Vegas Raiders": "lv",
  "Los Angeles Chargers": "lac",
  "Los Angeles Rams": "lar",
  "Miami Dolphins": "mia",
  "Minnesota Vikings": "min",
  "New England Patriots": "ne",
  "New Orleans Saints": "no",
  "New York Giants": "nyg",
  "New York Jets": "nyj",
  "Philadelphia Eagles": "phi",
  "Pittsburgh Steelers": "pit",
  "San Francisco 49ers": "sf",
  "Seattle Seahawks": "sea",
  "Tampa Bay Buccaneers": "tb",
  "Tennessee Titans": "ten",
  "Washington Commanders": "wsh",
};

export const NFL_TEAMS: readonly string[] = Object.keys(NFL_CODES);

// Schools the Odds API spells differently from ESPN, keyed the way
// shortTeam() spells the Odds API side.
const COLLEGE_ALIASES: Record<string, string> = {
  "Appalachian State": "App State",
  Hawaii: "Hawai'i",
  "Sam Houston State": "Sam Houston",
  "San Jose State": "San José State",
};

/** URL of the team's logo, or null when we do not know one. */
export function logoUrl(league: League, teamName: string): string | null {
  if (league === "nfl") {
    const code = NFL_CODES[teamName];
    return code ? `${CDN}/nfl/500-dark/${code}.png` : null;
  }
  const school = shortTeam(teamName);
  const id = ESPN_COLLEGE_IDS[COLLEGE_ALIASES[school] ?? school];
  return id == null ? null : `${CDN}/ncaa/500-dark/${id}.png`;
}
