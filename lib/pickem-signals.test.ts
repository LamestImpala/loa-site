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

test("teamEpa: adjusted EPA is each game less the opponent's season average, averaged", () => {
  // Three teams, one game each pair, 10 dropbacks a game: EPA per play is the total / 10.
  const row = (week: number, team: string, opp: string, epa: number) => ({ week, team, opp, pass_epa: epa, rush_epa: 0, pass_plays: 10, rush_plays: 0 });
  const rows = [row(1, "A", "B", 3), row(1, "B", "A", -1), row(2, "A", "C", 1), row(2, "C", "A", 2), row(3, "B", "C", 0), row(3, "C", "B", 4)];
  const a = teamEpa(rows).get("A")!;
  // Raw numbers are unchanged: A gains 4 / 20 and allows 1 / 20.
  assert.equal(a.off, 0.2);
  assert.equal(a.def, 0.05);
  // Offense: 0.3 against B (which allows 0.35) and 0.1 against C (which allows 0.05): -0.05 and +0.05.
  assert.equal(a.adj_off, 0);
  // Defense: B gained -0.1 (it gains -0.05) and C gained 0.2 (it gains 0.3): -0.05 and -0.1.
  assert.equal(a.adj_def, -0.075);
  // C's offense was better than B's and A's defenses usually allow: 0.2 - 0.05 and 0.4 - 0.35.
  assert.equal(teamEpa(rows).get("C")!.adj_off, 0.1);
});

test("teamEpa: a team with no plays has no adjusted numbers", () => {
  const rows = [{ week: 1, team: "A", opp: "B", pass_epa: 0, rush_epa: 0, pass_plays: 0, rush_plays: 0 }];
  const a = teamEpa(rows).get("A")!;
  assert.equal(a.adj_off, null);
  assert.equal(a.adj_def, null);
});

// ---------------------------------------------------------------------------
// Pinnacle, weather, rest, research

import { clip, clipDigest, collegeTier, noVig, parseWeather, pinnacleLine, teamRest, vsPinnacle, wantsResearch, type OddsEventLike } from "./pickem-signals.ts";

const PIN_EVENT: OddsEventLike = {
  id: "e1",
  home_team: "Kansas City Chiefs",
  away_team: "Buffalo Bills",
  bookmakers: [
    { key: "draftkings", markets: [] },
    {
      key: "pinnacle",
      last_update: "2026-10-15T14:00:00Z",
      markets: [
        { key: "spreads", outcomes: [{ name: "Kansas City Chiefs", price: -120, point: -3 }, { name: "Buffalo Bills", price: 100, point: 3 }] },
        { key: "totals", outcomes: [{ name: "Over", price: -105, point: 47.5 }, { name: "Under", price: -105, point: 47.5 }] },
        { key: "h2h", outcomes: [{ name: "Kansas City Chiefs", price: -160 }, { name: "Buffalo Bills", price: 140 }] },
      ],
    },
  ],
};

test("noVig takes the vig out in proportion", () => {
  assert.equal(noVig(-110, -110), 0.5);
  assert.ok(Math.abs(noVig(-120, 100) - (120 / 220) / (120 / 220 + 0.5)) < 1e-12);
});

test("pinnacleLine reads Pinnacle's book and moves the fair spread by the price imbalance", () => {
  const p = pinnacleLine("nfl", PIN_EVENT)!;
  assert.equal(p.spread_home, -3);
  assert.equal(p.spread_home_price, -120);
  assert.equal(p.total, 47.5);
  assert.equal(p.ml_away, 140);
  // -3 at -120/+100: the Chiefs cover -3 about 52.2% of the time, worth 0.7 of a point at 3% a point.
  assert.equal(p.fair.spread_home, -3.7);
  assert.equal(p.fair.total, 47.5); // even prices: the number is fair
  assert.equal(p.fair.home_win, 0.596); // 0.615 / (0.615 + 0.417)
  assert.equal(p.updated_at, "2026-10-15T14:00:00Z");
  assert.equal(pinnacleLine("nfl", { ...PIN_EVENT, bookmakers: [{ key: "fanduel", markets: [] }] }), null);
});

test("vsPinnacle: points against the fair line, positive where the bettor gets more", () => {
  const pin = pinnacleLine("nfl", PIN_EVENT)!;
  const v = vsPinnacle(
    {
      spread_home: -3,
      total: 48.5,
      best: {
        spread_home: { point: -2.5, price: -115, book: "A" },
        spread_away: { point: 3.5, price: -125, book: "B" },
        over: { point: 48, price: -110, book: "C" },
        under: { point: 49, price: -110, book: "D" },
      },
    },
    pin
  );
  assert.deepEqual(v.consensus, { spread_home: 0.7, total: 1 });
  // Home at -2.5 lays 1.2 fewer than the fair -3.7; away at +3.5 gets 0.2 less than +3.7.
  assert.deepEqual(v.best, { home: 1.2, away: -0.2, over: -0.5, under: 1.5 });
});

test("parseWeather: the kickoff hour, the windiest of the next four, nothing indoors or out of range", () => {
  const venue = { name: "Lambeau Field", lat: 44.5, lon: -88, dome: false, tz: "America/Chicago" };
  const forecast = {
    hourly: {
      time: ["2026-10-18T16:00", "2026-10-18T17:00", "2026-10-18T18:00", "2026-10-18T19:00", "2026-10-18T20:00", "2026-10-18T21:00"],
      temperature_2m: [40.2, 41.6, 42, 43, 44, 45],
      precipitation_probability: [10, 20, 30, 40, 50, 60],
      wind_speed_10m: [9, 12.4, 18.6, 14, 11, 30],
      wind_gusts_10m: [15, 22.5, 28, 25, 20, 40],
    },
  };
  assert.deepEqual(parseWeather(venue, "2026-10-18T17:25:00Z", forecast), {
    venue: "Lambeau Field", indoor: false, temp_f: 42, wind_mph: 12, gust_mph: 23, precip_pct: 20, wind_max_mph: 19,
  });
  assert.deepEqual(parseWeather({ ...venue, dome: true, name: "Ford Field" }, "2026-10-18T17:25:00Z", null), { venue: "Ford Field", indoor: true });
  assert.equal(parseWeather(venue, "2026-11-30T17:00:00Z", forecast), null);
  assert.equal(parseWeather(venue, "2026-10-18T17:00:00Z", {}), null);
});

const sched = (home: string, away: string, commence_time: string) => ({ home_team: home, away_team: away, commence_time });

test("teamRest: calendar days in Eastern time since the last game, short weeks and byes", () => {
  const season = [
    sched("Kansas City Chiefs", "Buffalo Bills", "2026-10-05T00:20:00Z"), // Sunday night Oct 4 Eastern
    sched("Buffalo Bills", "Miami Dolphins", "2026-10-12T17:00:00Z"),
    sched("Denver Broncos", "Kansas City Chiefs", "2026-10-16T00:15:00Z"), // Thursday night Oct 15 Eastern
  ];
  const tnf = season[2];
  const kc = teamRest("nfl", "Kansas City Chiefs", tnf, season);
  assert.equal(kc.days_rest, 11); // Sunday night Oct 4 to Thursday Oct 15
  assert.equal(kc.bye, false);
  assert.equal(kc.short_week, false);
  assert.deepEqual(teamRest("nfl", "Buffalo Bills", season[1], season).days_rest, 8); // the night game counts as Sunday the 4th
  const first = teamRest("nfl", "Denver Broncos", tnf, season);
  assert.deepEqual([first.days_rest, first.bye, first.short_week], [null, null, null]);
  const thursday = teamRest("nfl", "Miami Dolphins", sched("Miami Dolphins", "New York Jets", "2026-10-16T00:15:00Z"), season);
  assert.deepEqual([thursday.days_rest, thursday.short_week], [3, true]);
  const bye = teamRest("nfl", "Buffalo Bills", sched("Buffalo Bills", "New York Jets", "2026-10-26T17:00:00Z"), season);
  assert.deepEqual([bye.days_rest, bye.bye], [14, true]);
});

test("teamRest: NFL time-zone delta is the site's offset less the team's own", () => {
  const g = sched("Buffalo Bills", "Seattle Seahawks", "2026-10-18T17:00:00Z");
  assert.equal(teamRest("nfl", "Seattle Seahawks", g, [g]).tz_delta, 3); // Pacific team playing at 1 p.m. Eastern
  assert.equal(teamRest("nfl", "Buffalo Bills", g, [g]).tz_delta, 0);
  assert.equal(teamRest("ncaaf", "Alabama Crimson Tide", g, [g]).tz_delta, undefined);
  // A neutral site: the Jaguars "at home" in London are five hours ahead of their body clocks.
  const london = sched("Jacksonville Jaguars", "Houston Texans", "2026-10-18T13:30:00Z");
  const wembley = { name: "Wembley Stadium", lat: 51.556, lon: -0.2796, dome: false, tz: "Europe/London" };
  assert.equal(teamRest("nfl", "Jacksonville Jaguars", london, [london], wembley).tz_delta, 5);
  assert.equal(teamRest("nfl", "Houston Texans", london, [london], wembley).tz_delta, 6);
});

test("teamRest: a smaller college team's gap is unknown, not a bye, since its games may be off the board", () => {
  const season = [sched("Alabama Crimson Tide", "Troy Trojans", "2026-09-26T16:00:00Z")];
  const g = sched("Troy Trojans", "Alabama Crimson Tide", "2026-10-17T16:00:00Z");
  assert.deepEqual(teamRest("ncaaf", "Alabama Crimson Tide", g, season).bye, true);
  assert.deepEqual(teamRest("ncaaf", "Troy Trojans", g, season), { days_rest: null, bye: null, short_week: null });
  // A recent game is enough to know.
  const g2 = sched("Troy Trojans", "Alabama Crimson Tide", "2026-10-01T23:00:00Z");
  assert.deepEqual(teamRest("ncaaf", "Troy Trojans", g2, season), { days_rest: 5, bye: false, short_week: true });
});

test("wantsResearch: every NFL game; college inside 10 or Power Four on both sides or Arkansas", () => {
  assert.equal(wantsResearch("nfl", { home_team: "x", away_team: "y", spread_home: -20 }), true);
  assert.equal(wantsResearch("ncaaf", { home_team: "Troy Trojans", away_team: "Texas State Bobcats", spread_home: -9.5 }), true);
  assert.equal(wantsResearch("ncaaf", { home_team: "Troy Trojans", away_team: "Texas State Bobcats", spread_home: -14 }), false);
  assert.equal(wantsResearch("ncaaf", { home_team: "Alabama Crimson Tide", away_team: "Kentucky Wildcats", spread_home: -24 }), true);
  assert.equal(wantsResearch("ncaaf", { home_team: "Alabama Crimson Tide", away_team: "Troy Trojans", spread_home: -24 }), false);
  assert.equal(wantsResearch("ncaaf", { home_team: "Arkansas Razorbacks", away_team: "Troy Trojans", spread_home: null }), true);
  assert.equal(collegeTier("Troy Trojans", "Texas State Bobcats", 14), 3);
});

test("clipDigest cuts over-long text to size instead of failing the digest", () => {
  const long = "x".repeat(500);
  const d = clipDigest({
    injuries: [{ team: "home", player: null, detail: long, source: "s", date: null }],
    suspensions: [],
    coaching: [],
    quarterbacks: { home: long, away: "ok" },
    weather: null,
    what_changed: long,
  });
  assert.equal(d.injuries[0].detail.length, 300);
  assert.ok(d.injuries[0].detail.endsWith("…"));
  assert.equal(d.quarterbacks.home.length, 200);
  assert.equal(d.quarterbacks.away, "ok");
  assert.equal(d.weather, null);
  assert.equal(d.what_changed.length, 240);
  assert.equal(clip("short", 10), "short");
  assert.equal(clip("ends in space x", 15), "ends in space x");
  assert.equal(clip("ends in space x", 14), "ends in space…");
});

test("latestSignals maps the new sources to their fields, newest row winning", () => {
  const got = latestSignals([
    { game_id: "g", source: "pinnacle", taken_at: "2026-10-15T10:00:00Z", data: { spread_home: -3 } },
    { game_id: "g", source: "pinnacle", taken_at: "2026-10-15T16:00:00Z", data: { spread_home: -3.5 } },
    { game_id: "g", source: "weather", taken_at: "2026-10-15T10:00:00Z", data: { venue: "Lambeau Field", indoor: false } },
    { game_id: "g", source: "schedule", taken_at: "2026-10-15T10:00:00Z", data: { home: {}, away: {} } },
    { game_id: "g", source: "news", taken_at: "2026-10-16T10:00:00Z", data: { what_changed: "QB ruled out" } },
    { game_id: "g", source: "nonsense", taken_at: "2026-10-16T10:00:00Z", data: 1 },
  ]).get("g")!;
  assert.deepEqual(Object.keys(got).sort(), ["news", "pinnacle", "schedule", "weather"]);
  assert.deepEqual(got.pinnacle, { spread_home: -3.5 });
});
