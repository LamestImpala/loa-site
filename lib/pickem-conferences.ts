// Which conference each FBS school plays football in for 2026, keyed by the
// school name that shortTeam() produces from The Odds API's "School Mascot"
// strings. Keyed by school rather than the full string so a mascot spelling
// we have never seen ("Ragin Cajuns" vs "Ragin' Cajuns") still resolves.
// Alignment verified 2026-09-12 against the 2026 FBS season listings; the
// rebuilt Pac-12 and the Mountain West's replacements took effect July 1.
import { shortTeam } from "./pickem.ts";

export type Conference =
  | "SEC"
  | "Big Ten"
  | "Big 12"
  | "ACC"
  | "American"
  | "Mountain West"
  | "Pac-12"
  | "Sun Belt"
  | "MAC"
  | "Conference USA"
  | "Independent"
  | "FCS";

/** Display order for the conference picker. */
export const CONFERENCES: Conference[] = [
  "SEC",
  "Big Ten",
  "Big 12",
  "ACC",
  "American",
  "Mountain West",
  "Pac-12",
  "Sun Belt",
  "MAC",
  "Conference USA",
  "Independent",
  "FCS",
];

const POWER_FOUR: ReadonlySet<Conference> = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);

/** Short tag shown beside a team name on the board. */
export function conferenceTag(conf: Conference): string {
  switch (conf) {
    case "SEC": return "SEC";
    case "Big Ten": return "B1G";
    case "Big 12": return "B12";
    case "ACC": return "ACC";
    case "American": return "AAC";
    case "Mountain West": return "MWC";
    case "Pac-12": return "P12";
    case "Sun Belt": return "SBC";
    case "MAC": return "MAC";
    case "Conference USA": return "CUSA";
    case "Independent": return "IND";
    case "FCS": return "FCS";
  }
}

const MEMBERS: Record<Exclude<Conference, "FCS">, string[]> = {
  SEC: [
    "Alabama", "Arkansas", "Auburn", "Florida", "Georgia", "Kentucky", "LSU",
    "Mississippi State", "Missouri", "Oklahoma", "Ole Miss", "South Carolina",
    "Tennessee", "Texas", "Texas A&M", "Vanderbilt",
  ],
  "Big Ten": [
    "Illinois", "Indiana", "Iowa", "Maryland", "Michigan", "Michigan State",
    "Minnesota", "Nebraska", "Northwestern", "Ohio State", "Oregon", "Penn State",
    "Purdue", "Rutgers", "UCLA", "USC", "Washington", "Wisconsin",
  ],
  "Big 12": [
    "Arizona", "Arizona State", "Baylor", "BYU", "Cincinnati", "Colorado", "Houston",
    "Iowa State", "Kansas", "Kansas State", "Oklahoma State", "TCU", "Texas Tech",
    "UCF", "Utah", "West Virginia",
  ],
  ACC: [
    "Boston College", "California", "Clemson", "Duke", "Florida State", "Georgia Tech",
    "Louisville", "Miami", "NC State", "North Carolina", "Pittsburgh", "SMU", "Stanford",
    "Syracuse", "Virginia", "Virginia Tech", "Wake Forest",
  ],
  // Army and Navy are football-only members.
  American: [
    "Army", "Charlotte", "East Carolina", "Florida Atlantic", "Memphis", "Navy",
    "North Texas", "Rice", "South Florida", "Temple", "Tulane", "Tulsa", "UAB", "UTSA",
  ],
  // Lost five schools to the Pac-12; added Hawaii full-time, UTEP, North Dakota
  // State, and Northern Illinois (football-only).
  "Mountain West": [
    "Air Force", "Hawaii", "Nevada", "New Mexico", "North Dakota State",
    "Northern Illinois", "San Jose State", "UNLV", "UTEP", "Wyoming",
  ],
  "Pac-12": [
    "Boise State", "Colorado State", "Fresno State", "Oregon State", "San Diego State",
    "Texas State", "Utah State", "Washington State",
  ],
  "Sun Belt": [
    "Appalachian State", "Arkansas State", "Coastal Carolina", "Georgia Southern",
    "Georgia State", "James Madison", "Louisiana", "Louisiana Tech", "UL Monroe",
    "Marshall", "Old Dominion", "South Alabama", "Southern Miss", "Troy",
  ],
  // Sacramento State is a football-only member from 2026.
  MAC: [
    "Akron", "Ball State", "Bowling Green", "Buffalo", "Central Michigan",
    "Eastern Michigan", "Kent State", "Miami (OH)", "Ohio", "Sacramento State",
    "Toledo", "Massachusetts", "Western Michigan",
  ],
  "Conference USA": [
    "Delaware", "Florida International", "Jacksonville State", "Kennesaw State",
    "Liberty", "Middle Tennessee", "Missouri State", "New Mexico State",
    "Sam Houston State", "Western Kentucky",
  ],
  Independent: ["Notre Dame", "UConn"],
};

// Other spellings the books and feeds use for the same school.
const ALIASES: Record<string, string> = {
  UMass: "Massachusetts",
  "Louisiana Monroe": "UL Monroe",
  "Louisiana-Monroe": "UL Monroe",
  "Louisiana Lafayette": "Louisiana",
  "Louisiana-Lafayette": "Louisiana",
  "Sam Houston": "Sam Houston State",
  FIU: "Florida International",
  "Southern Mississippi": "Southern Miss",
  "Hawai'i": "Hawaii",
  Connecticut: "UConn",
  "Miami (FL)": "Miami",
  "Miami FL": "Miami",
  "Miami OH": "Miami (OH)",
  "App State": "Appalachian State",
  "San José State": "San Jose State",
  "Texas-San Antonio": "UTSA",
  "Texas-El Paso": "UTEP",
  "Central Florida": "UCF",
  "Southern Methodist": "SMU",
  "Brigham Young": "BYU",
  "Texas Christian": "TCU",
  "North Carolina State": "NC State",
  "Mississippi": "Ole Miss",
};

const BY_SCHOOL: Map<string, Conference> = new Map();
for (const [conf, schools] of Object.entries(MEMBERS) as [Conference, string[]][]) {
  for (const s of schools) BY_SCHOOL.set(s, conf);
}

/** Every FBS school in the map, for tests that need the full roster. */
export function knownSchools(): string[] {
  return [...BY_SCHOOL.keys()];
}

const warned = new Set<string>();

/**
 * Conference for an Odds API team string such as "Alabama Crimson Tide".
 * Anything we do not recognise is treated as an FCS opponent; genuine FBS
 * misses show up via unmappedTeams() on the sync job.
 */
export function conferenceOf(team: string): Conference {
  const school = shortTeam(team);
  const found = BY_SCHOOL.get(ALIASES[school] ?? school);
  if (found) return found;
  if (process.env.NODE_ENV !== "production" && !warned.has(team)) {
    warned.add(team);
    console.warn(`pickem: no conference for "${team}", treating as FCS`);
  }
  return "FCS";
}

export function isPower(team: string): boolean {
  const c = conferenceOf(team);
  return POWER_FOUR.has(c) || shortTeam(team) === "Notre Dame";
}

/** Team strings that fell through to FCS. Genuine FCS schools appear here too. */
export function unmappedTeams(teams: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const t of teams) if (conferenceOf(t) === "FCS") out.add(t);
  return [...out].sort();
}
