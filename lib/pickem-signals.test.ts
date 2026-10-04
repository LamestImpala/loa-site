// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cfbdRatings, cfbdSchool, keyInjuries, latestSignals, nflAbbr, parseTeamWeeks, teamEpa, type CfbdTeam } from "./pickem-signals.ts";

const TEAMS: CfbdTeam[] = [
  { id: 333, school: "Alabama", alternateNames: ["ALA"] },
  { id: 2026, school: "App State", alternateNames: ["Appalachian State", "Appalachian St"] },
  { id: 999001, school: "San José State", alternateNames: [] },
];

test("cfbdSchool matches on the ESPN id, whatever CFBD calls the school", () => {
  assert.equal(cfbdSchool("Alabama Crimson Tide", TEAMS), "Alabama");
  assert.equal(cfbdSchool("Appalachian State Mountaineers", TEAMS), "App State");
});

test("cfbdSchool falls back to the school name, ignoring accents, and gives null for a team CFBD lacks", () => {
  assert.equal(cfbdSchool("San Jose State Spartans", TEAMS), "San José State");
  assert.equal(cfbdSchool("Wofford Terriers", TEAMS), null);
});

test("cfbdRatings merges the three feeds per school and leaves gaps null", () => {
  const r = cfbdRatings(
    [{ team: "Alabama", rating: 24.44, offense: { rating: 38.16 }, defense: { rating: 14.2 } }],
    [{ team: "Alabama", elo: 1890.4 }, { team: "Kentucky", elo: 1502 }],
    [{ team: "Alabama", offense: { successRate: 0.4712, explosiveness: 1.234 }, defense: { successRate: 0.36, explosiveness: null } }]
  );
  assert.deepEqual(r.get("Alabama"), {
    sp: 24.4, sp_off: 38.2, sp_def: 14.2, elo: 1890,
    off_success: 0.471, def_success: 0.36, off_explosiveness: 1.23, def_explosiveness: null,
  });
  assert.equal(r.get("Kentucky")?.sp, null);
  assert.equal(r.get("Kentucky")?.elo, 1502);
});

test("nflAbbr fixes the two teams nflverse and Sleeper spell differently from ESPN", () => {
  assert.equal(nflAbbr("Kansas City Chiefs", "nflverse"), "KC");
  assert.equal(nflAbbr("Los Angeles Rams", "nflverse"), "LA");
  assert.equal(nflAbbr("Los Angeles Rams", "sleeper"), "LAR");
  assert.equal(nflAbbr("Washington Commanders", "nflverse"), "WAS");
  assert.equal(nflAbbr("Washington Commanders", "sleeper"), "WAS");
  assert.equal(nflAbbr("London Monarchs", "sleeper"), null);
});

const CSV = [
  "season,week,team,season_type,game_id,opponent_team,completions,attempts,passing_yards,sacks_suffered,passing_epa,carries,rushing_epa,fg_made_list",
  "2026,1,KC,REG,2026_01_KC_LAC,LAC,20,28,250,2,6,20,-1,27;44",
  "2026,1,LAC,REG,2026_01_KC_LAC,KC,18,36,200,4,-4,10,2,",
  "2026,2,KC,REG,2026_02_KC_DEN,DEN,10,18,90,2,-3,30,3,",
  "2026,2,DEN,REG,2026_02_KC_DEN,KC,22,30,280,0,9,20,1,51",
].join("\n");

test("parseTeamWeeks reads the columns by name and counts sacks as pass plays", () => {
  const rows = parseTeamWeeks(CSV);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { week: 1, team: "KC", opp: "LAC", pass_epa: 6, rush_epa: -1, pass_plays: 30, rush_plays: 20 });
  assert.throws(() => parseTeamWeeks("season,week,team\n2026,1,KC"), /missing columns/);
});

test("teamEpa: offense is the team's own rows, defense is its opponents' rows", () => {
  const kc = teamEpa(parseTeamWeeks(CSV)).get("KC")!;
  assert.equal(kc.games, 2);
  assert.equal(kc.off, 0.05); // (6 - 1 - 3 + 3) / (30 + 20 + 20 + 30)
  assert.equal(kc.off_pass, 0.06); // (6 - 3) / (30 + 20)
  assert.equal(kc.off_rush, 0.04); // (-1 + 3) / (20 + 30)
  assert.equal(kc.def, 0.08); // (-4 + 2 + 9 + 1) / (40 + 10 + 30 + 20)
  assert.equal(kc.def_pass, 0.071); // (-4 + 9) / (40 + 30)
  assert.equal(kc.off_last3, kc.off);
});

test("keyInjuries keeps injured starters and the second quarterback, quarterbacks first", () => {
  const got = keyInjuries([
    { full_name: "Starter Tackle", team: "KC", position: "OT", injury_status: "Out", depth_chart_order: 1 },
    { full_name: "Backup QB", team: "KC", position: "QB", injury_status: "Questionable", depth_chart_order: 2 },
    { full_name: "Backup Guard", team: "KC", position: "G", injury_status: "Out", depth_chart_order: 2 },
    { full_name: "Healthy QB", team: "KC", position: "QB", injury_status: null, depth_chart_order: 1 },
    { full_name: "Not Applicable", team: "KC", position: "WR", injury_status: "NA", depth_chart_order: 1 },
    { full_name: "Free Agent", team: null, position: "WR", injury_status: "IR", depth_chart_order: 1 },
  ]);
  assert.deepEqual(got.get("KC"), [
    { name: "Backup QB", pos: "QB", status: "Questionable" },
    { name: "Starter Tackle", pos: "OT", status: "Out" },
  ]);
  assert.equal(got.size, 1);
});

test("latestSignals takes the newest row of each source per game and ignores unknown sources", () => {
  const got = latestSignals([
    { game_id: "a", source: "nflverse", taken_at: "2026-10-06T14:30:00Z", data: { v: "new" } },
    { game_id: "a", source: "nflverse", taken_at: "2026-10-05T14:30:00Z", data: { v: "old" } },
    { game_id: "a", source: "sleeper", taken_at: "2026-10-05T14:30:00Z", data: { home: [], away: [] } },
    { game_id: "b", source: "cfbd", taken_at: "2026-10-05T13:30:00Z", data: { v: "ratings" } },
    { game_id: "b", source: "mystery", taken_at: "2026-10-06T13:30:00Z", data: {} },
  ]);
  assert.deepEqual(got.get("a"), { epa: { v: "new" }, injuries: { home: [], away: [] } });
  assert.deepEqual(got.get("b"), { ratings: { v: "ratings" } });
});
