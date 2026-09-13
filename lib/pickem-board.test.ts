// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PickemGame } from "./pickem.ts";
import {
  bookCode,
  bucketGames,
  conferencesOnSlate,
  filterByConference,
  groupByDay,
  parseView,
  tzLabel,
  viewQuery,
} from "./pickem-board.ts";

const NOW = Date.parse("2026-09-12T19:00:00Z"); // Sat 3:00 PM ET

function game(id: string, minutesFromNow: number, home: string, away: string, completed = false): PickemGame {
  return {
    id,
    league: "ncaaf",
    season: 2026,
    week: 2,
    commence_time: new Date(NOW + minutesFromNow * 60_000).toISOString(),
    home_team: home,
    away_team: away,
    spread_home: null, total: null, ml_home: null, ml_away: null,
    open_spread_home: null, open_total: null, open_ml_home: null, open_ml_away: null,
    best: {},
    house: null,
    home_score: null, away_score: null,
    completed,
    lines_updated_at: null,
  };
}

const slate = [
  game("late", 600, "Utah Utes", "Arkansas Razorbacks"),
  game("soon2", 59, "Kentucky Wildcats", "Alabama Crimson Tide"),
  game("live", -30, "Temple Owls", "Penn State Nittany Lions"),
  game("soon1", 5, "Illinois Fighting Illini", "Duke Blue Devils"),
  game("edge", 60, "BYU Cougars", "Arizona Wildcats"),
  game("final", -300, "Army Black Knights", "South Florida Bulls", true),
  game("hour+", 61, "Iowa Hawkeyes", "Iowa State Cyclones"),
];

test("buckets are ascending and soon is a one-hour window inclusive", () => {
  const b = bucketGames(slate, NOW);
  assert.deepEqual(b.soon.map((g) => g.id), ["soon1", "soon2", "edge"]);
  assert.deepEqual(b.upcoming.map((g) => g.id), ["soon1", "soon2", "edge", "hour+", "late"]);
  assert.deepEqual(b.started.map((g) => g.id), ["final", "live"]);
});

test("a completed game is started even if its clock says otherwise", () => {
  const b = bucketGames([game("odd", 30, "Ohio Bobcats", "Buffalo Bulls", true)], NOW);
  assert.equal(b.started.length, 1);
  assert.equal(b.upcoming.length, 0);
});

test("conference filter matches either side", () => {
  const sec = filterByConference(slate, "SEC").map((g) => g.id).sort();
  assert.deepEqual(sec, ["late", "soon2"]);
  assert.deepEqual(conferencesOnSlate(slate), ["SEC", "Big Ten", "Big 12", "ACC", "American"]);
});

test("day grouping follows the viewer's zone", () => {
  const lateNight = game("hawaii", 0, "Hawaii Rainbow Warriors", "New Mexico State Aggies");
  lateNight.commence_time = "2026-09-13T04:00:00Z"; // Sun 12:00 AM ET, Sat 9:00 PM PT
  const et = groupByDay([slate[1], lateNight], "America/New_York");
  assert.deepEqual(et.map((d) => d.label), ["Sat, Sep 12", "Sun, Sep 13"]);
  const pt = groupByDay([slate[1], lateNight], "America/Los_Angeles");
  assert.deepEqual(pt.map((d) => d.label), ["Sat, Sep 12"]);
  assert.equal(pt[0].games.length, 2);
});

test("view parsing falls back", () => {
  const known = conferencesOnSlate(slate);
  assert.deepEqual(parseView(null, null, known), { view: "auto", conf: null });
  assert.deepEqual(parseView("soon", null, known), { view: "soon", conf: null });
  assert.deepEqual(parseView("conf", "SEC", known), { view: "conf", conf: "SEC" });
  assert.deepEqual(parseView("conf", "MAC", known), { view: "all", conf: null });
  assert.deepEqual(parseView("bogus", null, known), { view: "all", conf: null });
  assert.equal(viewQuery("auto", null), "");
  assert.equal(viewQuery("conf", "Big Ten"), "view=conf&conf=Big+Ten");
});

test("zone labels", () => {
  assert.equal(tzLabel("America/New_York", NOW), "ET");
  assert.equal(tzLabel("America/Chicago", NOW), "CT");
  assert.equal(tzLabel("Pacific/Honolulu", NOW), "HT");
});

test("book codes", () => {
  assert.equal(bookCode("DraftKings"), "DK");
  assert.equal(bookCode("MyBookie.ag"), "MB");
  assert.equal(bookCode("Somebook.ag"), "SOME");
  assert.equal(bookCode(undefined), "");
});
