// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_TIER_META, houseStake, houseTier, type HousePicks, type PickemGame } from "./pickem.ts";
import { buildHouseCard, callLineAndPrice, fmtRecord, HOUSE_CARD_SIZE, housePlays, houseWeekRecord, playLabel, playUnits } from "./pickem-house.ts";

test("houseTier: 5 and below pass, 6 leans, 7 likes, 8 and up are best bets", () => {
  assert.equal(houseTier(1), "pass");
  assert.equal(houseTier(4), "pass");
  assert.equal(houseTier(5), "pass");
  assert.equal(houseTier(6), "lean");
  assert.equal(houseTier(7), "like");
  assert.equal(houseTier(8), "best");
  assert.equal(houseTier(10), "best");
});

test("houseStake: nothing on a pass, then 1, 2 and 3 units", () => {
  assert.equal(houseStake(5), 0);
  assert.equal(houseStake(1), 0);
  assert.equal(houseStake(6), 1);
  assert.equal(houseStake(7), 2);
  assert.equal(houseStake(8), 3);
  assert.equal(houseStake(10), 3);
});

test("every non-pass tier has display copy", () => {
  for (const c of [6, 7, 8]) {
    const tier = houseTier(c);
    assert.notEqual(tier, "pass");
    const meta = HOUSE_TIER_META[tier as Exclude<ReturnType<typeof houseTier>, "pass">];
    assert.ok(meta.pill && meta.verb && meta.pct);
  }
});

// ---------------------------------------------------------------------------
// The house as a player

const KICK = "2026-09-26T19:30:00Z";

function game(id: string, over: Partial<PickemGame> = {}): PickemGame {
  return {
    id,
    league: "ncaaf",
    season: 2026,
    week: 4,
    commence_time: KICK,
    home_team: "Alabama Crimson Tide",
    away_team: "Kentucky Wildcats",
    spread_home: -9,
    total: 47,
    ml_home: -380,
    ml_away: 290,
    open_spread_home: -9.5,
    open_total: 47,
    open_ml_home: -350,
    open_ml_away: 300,
    best: {
      spread_home: { point: -9, price: -105, book: "FanDuel" },
      spread_away: { point: 9, price: -115, book: "DraftKings" },
      over: { point: 47, price: -108, book: "BetMGM" },
      under: { point: 47, price: -112, book: "Caesars" },
      ml_home: { point: null, price: -370, book: "FanDuel" },
      ml_away: { point: null, price: 300, book: "BetRivers" },
    },
    house: null,
    home_score: null,
    away_score: null,
    completed: false,
    lines_updated_at: null,
    ...over,
  };
}

const legacyHouse: HousePicks = {
  spread: { pick: "home", confidence: 6, why: "" },
  total: { pick: "under", confidence: 5, why: "" },
  ml: { pick: "home", confidence: 7, why: "" },
};

const lockedHouse: HousePicks = {
  spread: { pick: "home", confidence: 8, why: "lock", line: -9.5, price: -110 },
  total: { pick: "over", confidence: 6, why: "", line: 46.5, price: -105 },
  ml: { pick: "away", confidence: 5, why: "", line: null, price: 300 },
};

test("callLineAndPrice: a legacy call takes the game's current best number, a locked call keeps its own", () => {
  const g = game("g", { house: legacyHouse });
  assert.deepEqual(callLineAndPrice(g, "spread", legacyHouse.spread), { line: -9, price: -105 });
  assert.deepEqual(callLineAndPrice(g, "total", legacyHouse.total), { line: 47, price: -112 });
  assert.deepEqual(callLineAndPrice(g, "ml", legacyHouse.ml), { line: null, price: -380 });
  assert.deepEqual(callLineAndPrice(g, "spread", lockedHouse.spread), { line: -9.5, price: -110 });
  assert.deepEqual(callLineAndPrice(g, "ml", lockedHouse.ml), { line: null, price: 300 });
});

test("playLabel uses the play's own number", () => {
  const g = game("g");
  assert.equal(playLabel(g, "spread", "home", -9.5), "Alabama -9.5");
  assert.equal(playLabel(g, "spread", "away", 9.5), "Kentucky +9.5");
  assert.equal(playLabel(g, "spread", "home", 0), "Alabama PK");
  assert.equal(playLabel(g, "total", "under", 46.5), "Under 46.5 (Kentucky @ Alabama)");
  assert.equal(playLabel(g, "ml", "away", null), "Kentucky ML");
});

test("housePlays: passes are skipped, tiers and stakes come from confidence, results grade against the locked line", () => {
  // Final 30-21: Alabama wins by 9. Locked spread -9.5 loses, current spread -9 would push.
  const g = game("g", { house: lockedHouse, home_score: 30, away_score: 21, completed: true });
  const plays = housePlays([g]);
  assert.deepEqual(plays.map((p) => [p.market, p.tier, p.stake, p.result]), [
    ["spread", "best", 3, "loss"],
    ["total", "lean", 1, "win"], // 51 over 46.5
  ]);
  assert.equal(plays[0].label, "Alabama -9.5");
});

test("housePlays: a legacy call grades against the current line and a bad selection is ignored", () => {
  const bad: HousePicks = { ...legacyHouse, total: { pick: "home", confidence: 7, why: "" } };
  const g = game("g", { house: bad, home_score: 30, away_score: 21, completed: true });
  const plays = housePlays([g]);
  assert.deepEqual(plays.map((p) => [p.market, p.line, p.price, p.result]), [
    ["spread", -9, -105, "push"],
    ["ml", null, -380, "win"],
  ]);
});

test("playUnits mirrors pickem_units times the stake", () => {
  assert.ok(Math.abs(playUnits("win", -110, 3) - 2.7272727) < 1e-6);
  assert.equal(playUnits("loss", -110, 3), -3);
  assert.equal(playUnits("push", -110, 3), 0);
  assert.equal(playUnits("win", 200, 1), 2);
  assert.equal(playUnits(null, -110, 1), 0);
});

test("houseWeekRecord counts completed plays only and stakes units by tier", () => {
  const done = game("a", { house: lockedHouse, home_score: 30, away_score: 21, completed: true }); // best -3, lean +0.952
  const live = game("b", { house: lockedHouse, home_score: 14, away_score: 0, completed: false }); // ignored
  const pending = game("c", { house: legacyHouse });
  const rec = houseWeekRecord([done, live, pending]);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 1);
  assert.equal(rec.pushes, 0);
  assert.ok(Math.abs(rec.units - (-3 + 100 / 105)) < 1e-6);
  assert.equal(fmtRecord(rec), "1-1");
  assert.equal(fmtRecord({ wins: 2, losses: 0, pushes: 1, units: 0 }), "2-0-1");
});

// ---------------------------------------------------------------------------
// The House Card

function withHouse(id: string, conf: [number, number, number], over: Partial<PickemGame> = {}, kickOffset = 0): PickemGame {
  const [cs, ct, cm] = conf;
  return game(id, {
    commence_time: new Date(Date.parse(KICK) + kickOffset * 3600_000).toISOString(),
    house: {
      spread: { pick: "home", confidence: cs, why: `${id} spread`, line: -9, price: -110 },
      total: { pick: "under", confidence: ct, why: `${id} total`, line: 47, price: -110 },
      ml: { pick: "away", confidence: cm, why: `${id} ml`, line: null, price: 300 },
    },
    ...over,
  });
}

test("buildHouseCard: not posted without house calls, and empty when the house passes everywhere", () => {
  assert.deepEqual(buildHouseCard([game("a"), game("b")]).posted, false);
  const allPass = buildHouseCard([withHouse("a", [5, 5, 5]), withHouse("b", [5, 5, 5])]);
  assert.equal(allPass.posted, true);
  assert.deepEqual(allPass.plays, []);
  assert.equal(allPass.stayAway?.game_id, "a"); // both -9; earliest kickoff wins the tie
});

test("buildHouseCard: one play per game, ranked by tier before edge, capped by league", () => {
  const games = [
    withHouse("a", [6, 6, 5]), // lean
    withHouse("b", [7, 5, 5]), // like
    withHouse("c", [8, 6, 5]), // best, plus a lean on the total
    withHouse("d", [6, 5, 5]),
    withHouse("e", [5, 6, 5]),
    withHouse("f", [6, 5, 5]),
    withHouse("g", [6, 5, 5]),
  ];
  const card = buildHouseCard(games);
  assert.equal(card.plays.length, HOUSE_CARD_SIZE.ncaaf);
  assert.deepEqual(card.plays.slice(0, 2).map((p) => [p.game_id, p.market, p.confidence]), [["c", "spread", 8], ["b", "spread", 7]]);
  assert.deepEqual(card.plays[0].tags, ["lock"]);
  assert.ok(card.plays.slice(2).every((p) => p.confidence === 6));
  assert.equal(new Set(card.plays.map((p) => p.game_id)).size, card.plays.length);
  assert.equal(card.stayAway, null);
  // NFL card is three deep.
  assert.equal(buildHouseCard(games.map((g) => ({ ...g, league: "nfl" as const }))).plays.length, HOUSE_CARD_SIZE.nfl);
});

test("buildHouseCard: a top play at 6 is not a lock; the best plus-money play is the upset and joins the card when it ranks lower", () => {
  const games = [
    withHouse("a", [6, 5, 5]),
    withHouse("b", [6, 5, 5]),
    withHouse("c", [6, 5, 5]),
    withHouse("d", [6, 5, 5]),
    withHouse("e", [6, 5, 5]),
    // The only plus-money play, a lean at +100 against -130: less edge than a -110 lean, so it ranks sixth.
    withHouse("f", [5, 5, 6], { ml_home: -130, ml_away: 100 }),
  ];
  games[5].house!.ml.price = 100;
  const card = buildHouseCard(games);
  assert.ok(card.plays.every((p) => !p.tags.includes("lock")));
  assert.equal(card.plays.length, HOUSE_CARD_SIZE.ncaaf + 1);
  const upset = card.plays.at(-1)!;
  assert.equal(upset.game_id, "f");
  assert.equal(upset.market, "ml");
  assert.deepEqual(upset.tags, ["upset"]);
});

test("buildHouseCard: a plus-money lock stays the lock and the next dog is the upset", () => {
  const games = [withHouse("a", [5, 5, 8]), withHouse("b", [5, 5, 6])];
  const card = buildHouseCard(games);
  assert.deepEqual(card.plays.map((p) => [p.game_id, p.tags]), [["a", ["lock"]], ["b", ["upset"]]]);
});

test("buildHouseCard: stay-away is the closest game the house passes on all three ways", () => {
  const games = [
    withHouse("a", [5, 5, 5], { spread_home: -14 }),
    withHouse("b", [5, 5, 5], { spread_home: 2.5 }),
    withHouse("c", [5, 5, 5], { spread_home: -1 , house: undefined as never }), // no house at all: ignored
    withHouse("d", [6, 5, 5], { spread_home: -1 }), // has a play: not a stay-away
  ];
  games[2] = game("c", { spread_home: -1 });
  const card = buildHouseCard(games);
  assert.equal(card.stayAway?.game_id, "b");
  assert.equal(card.stayAway?.spread_home, 2.5);
  assert.equal(card.stayAway?.why, "b spread");
});

test("buildHouseCard: the record in the header is the week record", () => {
  const done = withHouse("a", [8, 6, 5], { home_score: 30, away_score: 21, completed: true }); // spread -9 pushes, under 47 wins (51? no: 51 > 47 loses)
  const card = buildHouseCard([done]);
  assert.deepEqual(card.record, houseWeekRecord([done]));
  assert.equal(card.record.pushes, 1);
  assert.equal(card.record.losses, 1);
});
