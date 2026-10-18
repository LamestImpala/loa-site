// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalibrationRow } from "./pickem.ts";
import { calibrationTable, FEEDBACK_INTRO, fmtTally, houseFeedback, LAST_WEEK_MAX, lastWeekBlock, lastWeekLabel, recordBlock, type LastWeekRow } from "./pickem-feedback.ts";

function cal(over: Partial<CalibrationRow>): CalibrationRow {
  return {
    league: "ncaaf", season: 2026, market: "spread", confidence: 6, basis: "matchup", prompt_version: "v1",
    calls: 0, wins: 0, losses: 0, pushes: 0, win_pct: null, clv_calls: 0, clv_points: 0, avg_clv: null, units: 0, units_flat: 0,
    ...over,
  };
}

const tally = (calls: number, wins: number, losses: number, extra: Partial<CalibrationRow> = {}) =>
  cal({ calls, wins, losses, pushes: calls - wins - losses, ...extra });

// A season's worth: every confidence 5-8, every basis, every market, two prompts.
const SEASON: CalibrationRow[] = [];
for (const market of ["spread", "total", "ml"] as const) {
  for (const basis of ["news", "matchup", "number", "movement", "none", "untagged"]) {
    for (const prompt_version of ["unversioned", "2026-10-04c"]) {
      SEASON.push(tally(20, 10, 9, { market, basis, prompt_version, confidence: 5, clv_calls: 15, clv_points: -1.5 }));
      SEASON.push(tally(18, 10, 7, { market, basis, prompt_version, confidence: 6, clv_calls: 12, clv_points: 0.5, units: 2.4 }));
      SEASON.push(tally(1, 1, 0, { market, basis, prompt_version, confidence: 7, clv_calls: 1, clv_points: -1, units: 1.8 }));
      SEASON.push(tally(1, 0, 1, { market, basis, prompt_version, confidence: 8, clv_calls: 1, clv_points: -0.5, units: -3 }));
    }
  }
}

test("fmtTally: win rate leaves pushes out, CLV averages over the calls that have one", () => {
  const t = { calls: 30, wins: 16, losses: 12, pushes: 2, clv_calls: 20, clv_points: 3, units: 2.5, units_flat: 2.5 };
  assert.equal(fmtTally(t), "57.1% (16-12-2), CLV +0.15 on 20");
  assert.equal(fmtTally(t, { units: true }), "57.1% (16-12-2), CLV +0.15 on 20, +2.5u at its stakes");
  assert.equal(fmtTally({ ...t, clv_calls: 0, clv_points: 0, pushes: 0, calls: 28 }), "57.1% (16-12)");
});

test("fmtTally: fewer than 25 calls is too few to judge, with no rate shown", () => {
  const t = { calls: 24, wins: 20, losses: 4, pushes: 0, clv_calls: 24, clv_points: 12, units: 30, units_flat: 15 };
  assert.equal(fmtTally(t, { units: true }), "too few to judge (24 calls)");
  assert.equal(fmtTally({ ...t, calls: 1 }), "too few to judge (1 call)");
  assert.match(fmtTally({ ...t, calls: 25, pushes: 1 }), /^83\.3%/);
});

test("recordBlock: by confidence, basis and market, this league only, under 1,500 characters", () => {
  const nfl = SEASON.map((r) => ({ ...r, league: "nfl" as const, calls: 1000, wins: 1000, losses: 0, pushes: 0 }));
  const text = recordBlock("ncaaf", 2026, [...SEASON, ...nfl]);
  assert.ok(text.length < 1500, `${text.length} characters`);
  const lines = text.split("\n");
  assert.match(lines[0], /^YOUR RECORD, College football 2026/);
  // 5s: 2 markets x 6 bases x 2 prompts = 24 rows of 20 calls, 240-216-24.
  assert.equal(lines[2], "  5: 52.6% (240-216-24), CLV -0.10 on 360");
  // 6s carry units; 7s and 8s are too few (24 calls each on spread and total).
  assert.match(lines[3], /^ {2}6: 58\.8% \(240-168-24\), CLV \+0\.04 on 288, \+57\.6u at its stakes$/);
  assert.equal(lines[4], "  7: too few to judge (24 calls)");
  assert.equal(lines[5], "  8: too few to judge (24 calls)");
  // Bases in a fixed order, 6+ only.
  const basisAt = lines.indexOf("By basis, spread and total at 6+:");
  assert.deepEqual(lines.slice(basisAt + 1, basisAt + 7).map((l) => l.trim().split(":")[0]), ["news", "matchup", "number", "movement", "none", "untagged"]);
  assert.equal(lines.at(-1), "  moneyline: 132-96-12, +14.4u at its stakes");
  assert.ok(!text.includes("1000"));
});

test("recordBlock: nothing on record gives nothing", () => {
  assert.equal(recordBlock("ncaaf", 2026, []), "");
  assert.equal(recordBlock("nfl", 2026, SEASON), "");
});

function lw(i: number, over: Partial<LastWeekRow> = {}): LastWeekRow {
  return {
    league: "ncaaf", season: 2026, week: 6, game_id: `g${String(i).padStart(2, "0")}`,
    matchup: "Kentucky Wildcats @ Alabama Crimson Tide", commence_time: "2026-10-10T19:30:00Z",
    market: "spread", selection: "home", confidence: 6, basis: "matchup", line: -9, price: -110,
    close_line: -10.5, clv: 1.5, result: "win", why: "Alabama's front against a thin Kentucky line.",
    ...over,
  };
}

test("lastWeekLabel names the side at the locked number", () => {
  assert.equal(lastWeekLabel("ncaaf", lw(1)), "Alabama -9");
  assert.equal(lastWeekLabel("ncaaf", lw(1, { selection: "away", line: 9 })), "Kentucky +9");
  assert.equal(lastWeekLabel("ncaaf", lw(1, { market: "total", selection: "under", line: 47 })), "Under 47 (Kentucky @ Alabama)");
  assert.equal(lastWeekLabel("nfl", { matchup: "Buffalo Bills @ Kansas City Chiefs", market: "spread", selection: "away", line: 2.5 }), "Bills +2.5");
});

test("lastWeekBlock: plays best CLV first with result and why, passes summarised, moneylines left out", () => {
  const rows = [
    lw(1, { clv: -1, close_line: -8, result: "loss" }),
    lw(2),
    lw(3, { confidence: 5, clv: -0.5 }),
    lw(4, { market: "ml", clv: null }),
    lw(5, { clv: null }), // no locked line
    lw(6, { market: "total", selection: "over", line: 47, close_line: 49, clv: 2, result: null }),
  ];
  const lines = lastWeekBlock("ncaaf", rows).split("\n");
  assert.equal(lines[0], "LAST WEEK (week 6), spread and total calls at 6+, best CLV first:");
  assert.equal(lines[1], "  6 matchup · Over 47 (Kentucky @ Alabama) · closed 49 · CLV +2.0 · no final · Alabama's front against a thin Kentucky line.");
  assert.match(lines[2], /Alabama -9 · closed -10\.5 · CLV \+1\.5 · W ·/);
  assert.match(lines[3], /Alabama -9 · closed -8 · CLV -1\.0 · L ·/);
  assert.equal(lines[4], "  Plays: 1-1, average CLV +0.83 on 3.");
  assert.equal(lines[5], "  Passes (5s): average CLV -0.50 on 1.");
  assert.equal(lines.length, 6);
});

test("lastWeekBlock: a long week shows the best and worst halves", () => {
  const rows = Array.from({ length: 40 }, (_, i) => lw(i, { clv: 20 - i }));
  const lines = lastWeekBlock("ncaaf", rows).split("\n");
  const shown = lines.filter((l) => l.includes(" · CLV "));
  assert.equal(shown.length, LAST_WEEK_MAX);
  assert.match(shown[0], /CLV \+20\.0/);
  assert.match(shown.at(-1)!, /CLV -19\.0/);
  assert.ok(lines.includes("  … 10 more in between …"));
});

test("houseFeedback: the intro, then each block that has data; empty with neither", () => {
  assert.equal(houseFeedback("ncaaf", 2026, [], []), "");
  const text = houseFeedback("ncaaf", 2026, SEASON, [lw(1)]);
  assert.ok(text.startsWith(FEEDBACK_INTRO));
  assert.ok(text.includes("\n\nYOUR RECORD") && text.includes("\n\nLAST WEEK"));
  assert.equal(houseFeedback("ncaaf", 2026, [], [lw(1)]).split("\n\n").length, 2);
});

test("calibrationTable: filter by market, add up by one column, in a fixed order", () => {
  const byConf = calibrationTable(SEASON, { market: "spread", by: "confidence" });
  assert.deepEqual(byConf.map((r) => [r.key, r.tally.calls]), [["5", 240], ["6", 216], ["7", 12], ["8", 12]]);
  const byBasis = calibrationTable(SEASON, { market: "all", by: "basis" });
  assert.deepEqual(byBasis.map((r) => r.key), ["news", "matchup", "number", "movement", "none", "untagged"]);
  assert.equal(byBasis[0].tally.calls, 3 * 2 * (20 + 18 + 1 + 1));
  // Newest prompt first, unversioned last.
  const prompts = [...SEASON, tally(5, 3, 2, { prompt_version: "2026-10-14" })];
  assert.deepEqual(calibrationTable(prompts, { market: "all", by: "prompt_version" }).map((r) => r.key), ["2026-10-14", "2026-10-04c", "unversioned"]);
});
