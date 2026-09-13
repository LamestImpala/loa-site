// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayTeam, legLabel, parseLeague, seasonWeek, weekWindow, type PickemGame } from "./pickem.ts";
import { parseView } from "./pickem-board.ts";

const at = (iso: string) => new Date(iso);

test("NFL week 1 runs from the Thursday opener through Monday night", () => {
  const { start, end } = weekWindow("nfl", 1);
  assert.equal(start.toISOString(), "2026-09-08T10:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-15T10:00:00.000Z");
  assert.equal(seasonWeek("nfl", at("2026-09-11T00:15:00Z")), 1); // Thursday night opener
  assert.equal(seasonWeek("nfl", at("2026-09-15T00:15:00Z")), 1); // Monday night, after midnight UTC
  assert.equal(seasonWeek("nfl", at("2026-09-15T10:00:00Z")), 2); // Tuesday morning rollover
});

test("college weeks keep their numbering and absorb a Labor Day night game", () => {
  assert.equal(seasonWeek("ncaaf", at("2026-09-05T20:00:00Z")), 1);
  assert.equal(seasonWeek("ncaaf", at("2026-09-08T00:00:00Z")), 1); // Mon 8 PM ET
  assert.equal(seasonWeek("ncaaf", at("2026-09-13T00:00:00Z")), 2);
  assert.equal(seasonWeek("nfl", at("2026-09-13T00:00:00Z")), 1); // same day, NFL is a week behind
});

test("display names: school for college, nickname for the NFL", () => {
  assert.equal(displayTeam("ncaaf", "Alabama Crimson Tide"), "Alabama");
  assert.equal(displayTeam("ncaaf", "Kansas City Chiefs"), "Kansas City"); // college rule, wrong league
  assert.equal(displayTeam("nfl", "Kansas City Chiefs"), "Chiefs");
  assert.equal(displayTeam("nfl", "Washington Commanders"), "Commanders");
});

test("leg labels follow the game's league", () => {
  const g = {
    id: "x",
    league: "nfl",
    season: 2026,
    week: 1,
    commence_time: "2026-09-13T17:00:00Z",
    home_team: "Kansas City Chiefs",
    away_team: "Los Angeles Chargers",
    spread_home: -3,
    total: 47.5,
    ml_home: -160,
    ml_away: 140,
    open_spread_home: -3,
    open_total: 47.5,
    open_ml_home: -160,
    open_ml_away: 140,
    best: {},
    house: null,
    home_score: null,
    away_score: null,
    completed: false,
    lines_updated_at: null,
  } satisfies PickemGame;
  assert.equal(legLabel(g, "spread", "home"), "Chiefs -3");
  assert.equal(legLabel(g, "spread", "away"), "Chargers +3");
  assert.equal(legLabel(g, "total", "over"), "Over 47.5 (Chargers @ Chiefs)");
});

test("parseLeague accepts only the two leagues", () => {
  assert.equal(parseLeague("nfl"), "nfl");
  assert.equal(parseLeague("ncaaf"), "ncaaf");
  assert.equal(parseLeague("NFL"), null);
  assert.equal(parseLeague(undefined), null);
});

test("a conference view with no conferences falls back to all", () => {
  assert.deepEqual(parseView("conf", "SEC", []), { view: "all", conf: null });
});
