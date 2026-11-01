// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { confidenceRecord, legLabel, legLineAndPrice, parlayAmericanOdds, type CalibrationRow, type HousePicks, type PickemGame } from "./pickem.ts";
import {
  buildParlays,
  candidateLegs,
  CONF_LOGIT_STEP,
  estimatedProbability,
  fairProbability,
  impliedProbability,
  parlaySignature,
} from "./pickem-parlays.ts";

const NOW = Date.parse("2026-09-12T15:00:00Z");

type Opts = Partial<PickemGame> & { conf?: [number, number, number]; picks?: HousePicks };

function game(id: string, opts: Opts = {}): PickemGame {
  const [cs, ct, cm] = opts.conf ?? [6, 6, 6];
  const house: HousePicks = opts.picks ?? {
    spread: { pick: "home", confidence: cs, why: "" },
    total: { pick: "under", confidence: ct, why: "" },
    ml: { pick: "home", confidence: cm, why: "" },
  };
  return {
    id,
    league: "ncaaf",
    season: 2026,
    week: 2,
    commence_time: new Date(NOW + 3 * 3600_000).toISOString(),
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
      spread_home: { point: -9, price: -110, book: "BetMGM" },
      spread_away: { point: 9, price: -115, book: "BetRivers" },
      over: { point: 47, price: -115, book: "DraftKings" },
      under: { point: 47, price: -114, book: "BetRivers" },
      ml_home: { point: null, price: -350, book: "FanDuel" },
      ml_away: { point: null, price: 310, book: "BetRivers" },
    },
    house,
    home_score: null,
    away_score: null,
    completed: false,
    lines_updated_at: null,
    ...opts,
  };
}

test("implied and fair probabilities", () => {
  assert.ok(Math.abs(impliedProbability(-110) - 0.5238) < 0.001);
  assert.equal(impliedProbability(150), 0.4);
  assert.equal(fairProbability(-110, -110), 0.5);
  assert.ok(Math.abs(fairProbability(-110, null) - 0.5238) < 0.001);
  assert.equal(fairProbability(200, 200), impliedProbability(200)); // pair sums below 1: no de-vig
});

test("confidence nudges the fair number on a logit scale", () => {
  assert.equal(estimatedProbability(0.5, 5), 0.5);
  assert.equal(estimatedProbability(0.5, 4), 0.5);
  assert.ok(Math.abs(estimatedProbability(0.5, 6) - 0.541) < 0.002);
  assert.ok(Math.abs(estimatedProbability(0.5, 8) - 0.621) < 0.002);
  const ps = [5, 6, 7, 8, 9, 10].map((c) => estimatedProbability(0.5, c));
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i] > ps[i - 1]);
});

test("moved helpers: labels and locked prices", () => {
  const g = game("a");
  assert.equal(legLabel(g, "spread", "home"), "Alabama -9");
  assert.equal(legLabel(g, "spread", "away"), "Kentucky +9");
  assert.equal(legLabel(g, "total", "over"), "Over 47 (Kentucky @ Alabama)");
  assert.equal(legLabel(g, "ml", "away"), "Kentucky ML");
  assert.deepEqual(legLineAndPrice(g, "ml", "home"), { line: null, price: -380 });
  assert.deepEqual(legLineAndPrice(g, "spread", "away"), { line: 9, price: -115 });
  assert.deepEqual(legLineAndPrice(game("b", { best: {} }), "total", "over"), { line: 47, price: -110 });
});

test("one leg per game, only with edge, never a price out of range", () => {
  const legs = candidateLegs([game("a", { conf: [7, 8, 9] })], NOW);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].market, "total"); // the -380 moneyline at conf 9 scores below the -114 under at conf 8
  assert.equal(candidateLegs([game("b", { conf: [5, 5, 5] })], NOW).length, 0);
  const noML = game("c", { conf: [5, 5, 9], ml_home: -450 });
  assert.equal(candidateLegs([noML], NOW).length, 0);
  const dog = game("d", { conf: [5, 5, 9], ml_home: 350, ml_away: -450 });
  assert.equal(candidateLegs([dog], NOW).length, 0);
});

test("no legs from started, finished or pickless games", () => {
  const started = game("s", { commence_time: new Date(NOW - 60_000).toISOString() });
  const done = game("f", { completed: true });
  const none = game("n", { house: null });
  assert.equal(candidateLegs([started, done, none], NOW).length, 0);
});

test("parlays nest, price correctly and stop when the slate runs out", () => {
  const games = ["a", "b", "c", "d", "e"].map((id, i) =>
    game(id, { conf: [6 + (i % 3), 6, 6], commence_time: new Date(NOW + (i + 1) * 3600_000).toISOString() })
  );
  const parlays = buildParlays(games, NOW);
  assert.deepEqual(parlays.map((p) => p.leg_count), [2, 3, 4, 5]);
  for (let i = 1; i < parlays.length; i++) {
    const prev = new Set(parlays[i - 1].legs.map((l) => l.game_id));
    for (const l of parlays[i - 1].legs) assert.ok(parlays[i].legs.some((x) => x.game_id === l.game_id));
    assert.equal(prev.size, parlays[i - 1].leg_count);
  }
  for (const p of parlays) {
    assert.equal(p.american_odds, parlayAmericanOdds(p.legs.map((l) => l.price)));
    assert.ok(p.hit_probability > 0 && p.hit_probability < 1);
    assert.equal(p.locks_at, p.legs.map((l) => games.find((g) => g.id === l.game_id)!.commence_time).sort()[0]);
    assert.ok(p.legs.every((l) => typeof l.confidence === "number"));
    assert.match(p.note, /House puts it at/);
  }
  assert.ok(parlays[3].hit_probability < parlays[0].hit_probability);
});

test("deterministic and signature is order-free", () => {
  const games = ["a", "b", "c"].map((id) => game(id));
  assert.deepEqual(buildParlays(games, NOW), buildParlays(games, NOW));
  assert.equal(
    parlaySignature([{ game_id: "b", market: "ml", selection: "home" }, { game_id: "a", market: "spread", selection: "away" }]),
    parlaySignature([{ game_id: "a", market: "spread", selection: "away" }, { game_id: "b", market: "ml", selection: "home" }])
  );
});

// ---------------------------------------------------------------------------
// Observed calibration

function cal(confidence: number, calls: number, wins: number, losses: number, over: Partial<CalibrationRow> = {}): CalibrationRow {
  return {
    league: "ncaaf", season: 2026, market: "spread", confidence, basis: "matchup", prompt_version: "v1",
    calls, wins, losses, pushes: calls - wins - losses, win_pct: null, clv_calls: 0, clv_points: 0, avg_clv: null, units: 0, units_flat: 0,
    ...over,
  };
}

test("estimatedProbability: an observed win rate replaces the asserted step once a confidence has 50 calls", () => {
  const record = confidenceRecord([cal(6, 60, 31, 27), cal(7, 49, 40, 9)], "ncaaf", 2026);
  // 6s: 31-27 is 53.4%, so a fair coin becomes 53.4%, not the asserted ~54%.
  assert.ok(Math.abs(estimatedProbability(0.5, 6, record) - 31 / 58) < 1e-9);
  // 7s: 49 calls is not enough; the step still applies.
  assert.equal(estimatedProbability(0.5, 7, record), estimatedProbability(0.5, 7));
  assert.ok(Math.abs(estimatedProbability(0.5, 7) - 1 / (1 + Math.exp(-2 * CONF_LOGIT_STEP))) < 1e-9);
});

test("estimatedProbability: a confidence that has lost to the number pulls the fair probability down", () => {
  const record = confidenceRecord([cal(6, 100, 45, 55)], "ncaaf", 2026);
  assert.ok(estimatedProbability(0.5, 6, record) < 0.5);
  // The same shift applies on the logit scale to any price: a 70% favorite stays above 65%.
  assert.ok(estimatedProbability(0.7, 6, record) > 0.65 && estimatedProbability(0.7, 6, record) < 0.7);
});

test("buildParlays: legs a losing record no longer backs drop out of the candidates", () => {
  const games = ["a", "b", "c"].map((id) => game(id, { conf: [6, 6, 5] }));
  assert.ok(candidateLegs(games, NOW).length > 0);
  const losing = [cal(6, 100, 45, 55), cal(6, 100, 45, 55, { market: "total" })];
  assert.deepEqual(candidateLegs(games, NOW, losing), []);
  // Another league's record is ignored.
  assert.ok(candidateLegs(games, NOW, losing.map((r) => ({ ...r, league: "nfl" as const }))).length > 0);
});

test("buildParlays: with no edge on the board the best legs still post, at a negative expected value", () => {
  const games = ["a", "b", "c"].map((id) => game(id, { conf: [6, 6, 5] }));
  const losing = [cal(6, 100, 45, 55), cal(6, 100, 45, 55, { market: "total" })];
  const parlays = buildParlays(games, NOW, losing);
  assert.deepEqual(parlays.map((p) => p.leg_count), [2, 3]);
  for (const p of parlays) assert.match(p.note, /-\d+% expected value/);
});

test("buildParlays: legs with edge rank ahead of legs without", () => {
  const games = [game("a", { conf: [5, 5, 5] }), game("b", { conf: [8, 5, 5] }), game("c", { conf: [5, 5, 5] }), game("d", { conf: [9, 5, 5] })];
  const [two] = buildParlays(games, NOW);
  assert.deepEqual(two.legs.map((l) => l.game_id).sort(), ["b", "d"]);
});
