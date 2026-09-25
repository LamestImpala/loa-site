// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PickemGame } from "./pickem.ts";
import { applyLive, espnDate, fmtLiveStatus, hasGamesInPlay, matchEvents, type EspnEvent } from "./pickem-live.ts";

const KICK = "2026-09-26T23:30:00Z";

function game(id: string, league: "ncaaf" | "nfl", home: string, away: string, over: Partial<PickemGame> = {}): PickemGame {
  return {
    id, league, season: 2026, week: 4, commence_time: KICK, home_team: home, away_team: away,
    spread_home: null, total: null, ml_home: null, ml_away: null,
    open_spread_home: null, open_total: null, open_ml_home: null, open_ml_away: null,
    best: {}, house: null, home_score: null, away_score: null, completed: false, lines_updated_at: null,
    ...over,
  };
}

type Side = { id: string; abbreviation: string; score: string };
function event(id: string, home: Side, away: Side, status: Partial<EspnEvent["status"]["type"]> & { period?: number; clock?: string } = {}, date = KICK): EspnEvent {
  const { period = 2, clock = "4:48", ...type } = status;
  return {
    id,
    date,
    status: {
      period,
      displayClock: clock,
      type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: `${clock} - 2nd`, ...type },
    },
    competitions: [
      {
        competitors: [
          { homeAway: "home", score: home.score, team: { id: home.id, abbreviation: home.abbreviation } },
          { homeAway: "away", score: away.score, team: { id: away.id, abbreviation: away.abbreviation } },
        ],
      },
    ],
  };
}

const GB = { id: "9", abbreviation: "GB" };
const ATL = { id: "1", abbreviation: "ATL" };
const BAMA = { id: "333", abbreviation: "ALA" };
const UGA = { id: "61", abbreviation: "UGA" };

test("status formatting", () => {
  const st = (over: Parameters<typeof event>[3]) => event("x", { ...GB, score: "0" }, { ...ATL, score: "0" }, over).status;
  assert.equal(fmtLiveStatus(st({ period: 2, clock: "4:48" })), "2nd 4:48");
  assert.equal(fmtLiveStatus(st({ period: 5, clock: "2:10" })), "OT 2:10");
  assert.equal(fmtLiveStatus(st({ period: 6, clock: "0:30" })), "2OT 0:30");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_HALFTIME", shortDetail: "Halftime" })), "Half");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_END_PERIOD", period: 3, shortDetail: "End of 3rd" })), "End 3rd");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" })), "Final");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final/OT" })), "Final/OT");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_DELAYED", shortDetail: "Delayed" })), "Delayed");
  assert.equal(fmtLiveStatus(st({ name: "STATUS_POSTPONED", state: "post", shortDetail: "Postponed" })), "Postponed");
});

test("NFL games match by abbreviation, college by team id", () => {
  const games = [
    game("nfl1", "nfl", "Green Bay Packers", "Atlanta Falcons"),
    game("cfb1", "ncaaf", "Alabama Crimson Tide", "Georgia Bulldogs"),
  ];
  const live = matchEvents("nfl", games, [event("e1", { ...GB, score: "7" }, { ...ATL, score: "10" })]);
  assert.deepEqual(live, { nfl1: { state: "in", home: 7, away: 10, status: "2nd 4:48", completed: false } });
  const cfb = matchEvents("ncaaf", games, [
    event("e2", { ...BAMA, score: "21" }, { ...UGA, score: "14" }, { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" }),
  ]);
  assert.deepEqual(cfb, { cfb1: { state: "post", home: 21, away: 14, status: "Final", completed: true } });
});

test("a neutral-site game listed the other way round swaps the scores back", () => {
  const games = [game("cfb1", "ncaaf", "Alabama Crimson Tide", "Georgia Bulldogs")];
  const live = matchEvents("ncaaf", games, [event("e", { ...UGA, score: "3" }, { ...BAMA, score: "17" })]);
  assert.equal(live.cfb1.home, 17);
  assert.equal(live.cfb1.away, 3);
});

test("unknown teams, far-off dates and unstarted games are left out", () => {
  const games = [
    game("cfb1", "ncaaf", "Alabama Crimson Tide", "Georgia Bulldogs"),
    game("cfb2", "ncaaf", "Nowhere State Nobodies", "Georgia Bulldogs"),
  ];
  const lastWeek = event("old", { ...BAMA, score: "0" }, { ...UGA, score: "0" }, {}, "2026-09-19T23:30:00Z");
  const pre = event("pre", { ...BAMA, score: "0" }, { ...UGA, score: "0" }, { name: "STATUS_SCHEDULED", state: "pre", shortDetail: "9/26 - 7:30 PM EDT" });
  assert.deepEqual(matchEvents("ncaaf", games, [lastWeek, pre]), {});
});

test("applyLive overlays scores but never overrides a graded row", () => {
  const games = [
    game("a", "nfl", "Green Bay Packers", "Atlanta Falcons"),
    game("b", "nfl", "Buffalo Bills", "Miami Dolphins", { completed: true, home_score: 30, away_score: 27 }),
    game("c", "nfl", "Dallas Cowboys", "Chicago Bears"),
  ];
  const live = {
    a: { state: "in" as const, home: 7, away: 10, status: "2nd 4:48", completed: false },
    b: { state: "in" as const, home: 3, away: 0, status: "1st 9:00", completed: false },
  };
  const out = applyLive(games, live);
  assert.equal(out[0].home_score, 7);
  assert.equal(out[0].away_score, 10);
  assert.equal(out[0].completed, false);
  assert.equal(out[0].live?.status, "2nd 4:48");
  assert.equal(out[1].home_score, 30);
  assert.equal(out[1].live, undefined);
  assert.equal(out[2], games[2]);
  const done = applyLive(games, { a: { ...live.a, state: "post", status: "Final", completed: true } });
  assert.equal(done[0].completed, true);
});

test("polling runs while a started game lacks a final", () => {
  const now = Date.parse(KICK) + 60_000;
  const g = game("a", "nfl", "Green Bay Packers", "Atlanta Falcons");
  assert.equal(hasGamesInPlay([g], {}, now), true);
  assert.equal(hasGamesInPlay([g], {}, now - 120_000), false);
  assert.equal(hasGamesInPlay([g], { a: { state: "post", home: 1, away: 0, status: "Final", completed: true } }, now), false);
  assert.equal(hasGamesInPlay([{ ...g, completed: true }], {}, now), false);
});

test("ESPN dates are Eastern calendar days", () => {
  assert.equal(espnDate(Date.parse("2026-09-26T00:30:00Z")), "20260925"); // Fri 8:30 PM ET
  assert.equal(espnDate(Date.parse("2026-09-26T23:30:00Z")), "20260926");
});
