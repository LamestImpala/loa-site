// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { betPayload, fmtMoney, importable, reviewSlip, ticketResult, wagerNet, type SlipGame, type SlipLeg } from "./pickem-slip.ts";

const NOW = Date.parse("2026-10-04T14:00:00Z");

function game(id: string, away: string, home: string, opts: Partial<SlipGame> = {}): SlipGame {
  return {
    id,
    league: "nfl",
    commence_time: new Date(NOW + 3 * 3600_000).toISOString(),
    home_team: home,
    away_team: away,
    spread_home: -3,
    total: 44.5,
    ml_home: -160,
    ml_away: 135,
    ...opts,
  };
}

const GAMES = [
  game("jax-cin", "Jacksonville Jaguars", "Cincinnati Bengals"),
  game("lar-phi", "Los Angeles Rams", "Philadelphia Eagles", { spread_home: 3 }),
  game("ten-bal", "Tennessee Titans", "Baltimore Ravens", { total: 43 }),
  game("early", "Miami Dolphins", "Minnesota Vikings", { commence_time: new Date(NOW - 3600_000).toISOString() }),
];

function leg(over: Partial<SlipLeg>): SlipLeg {
  return { game_id: "jax-cin", market: "spread", selection: "away", line: 2.5, price: -103, raw_text: "raw", unsupported: null, ...over };
}

test("a parlay with every leg on the board is a ticket at the slip's numbers", () => {
  const { book, bets } = reviewSlip(
    {
      book: " Caesars ",
      bets: [
        {
          kind: "parlay",
          stake: 10,
          american_odds: 596,
          legs: [
            leg({}),
            leg({ game_id: "lar-phi", selection: "home", line: 3.5, price: -107 }),
            leg({ game_id: "ten-bal", market: "total", selection: "under", line: 42.5, price: -110 }),
          ],
        },
      ],
    },
    GAMES,
    NOW
  );
  assert.equal(book, "Caesars");
  const [bet] = bets;
  assert.equal(bet.ticket, true);
  assert.equal(bet.american_odds, 596);
  assert.deepEqual(bet.legs.map((l) => l.label), ["Jaguars +2.5", "Eagles +3.5", "Under 42.5 (Titans @ Ravens)"]);
  // The board's number for the same side sits beside the slip's.
  assert.deepEqual(bet.legs.map((l) => l.board), [3, 3, 43]);
  const payload = betPayload(bet, book);
  assert.equal(payload.leg_count, 3);
  assert.deepEqual(payload.legs[0], { game_id: "jax-cin", market: "spread", selection: "away", line: 2.5, price: -103, label: "Jaguars +2.5" });
});

test("a leg that cannot be imported stops the ticket but not the other legs", () => {
  const cases: [Partial<SlipLeg>, string][] = [
    [{ game_id: "early" }, "started"],
    [{ game_id: null }, "not_on_board"],
    [{ game_id: "nope" }, "not_on_board"],
    [{ unsupported: "player prop" }, "unsupported"],
    [{ selection: "over" }, "invalid"],
    [{ market: "total", selection: "home", line: 44 }, "invalid"],
    [{ line: null }, "invalid"],
    [{ price: -50 }, "invalid"],
  ];
  for (const [bad, status] of cases) {
    const { bets } = reviewSlip({ book: null, bets: [{ kind: "parlay", stake: 5, american_odds: 260, legs: [leg({}), leg(bad)] }] }, GAMES, NOW);
    assert.equal(bets[0].legs[1].status, status, JSON.stringify(bad));
    assert.equal(bets[0].ticket, false);
    assert.equal(importable(bets[0]), true);
    assert.equal(betPayload(bets[0], null).legs.length, 1);
    assert.equal(betPayload(bets[0], null).leg_count, 2);
  }
});

test("a moneyline carries no line, and a missing ticket price is computed from the legs", () => {
  const { bets } = reviewSlip(
    {
      book: null,
      bets: [{ kind: "parlay", stake: null, american_odds: null, legs: [leg({ market: "ml", selection: "home", line: -3, price: -160 }), leg({ game_id: "lar-phi", price: 100 })] }],
    },
    GAMES,
    NOW
  );
  assert.equal(bets[0].legs[0].line, null);
  assert.equal(bets[0].legs[0].label, "Bengals ML");
  assert.equal(bets[0].american_odds, 225);
});

test("a straight bet with several legs becomes several bets without the stake", () => {
  const one = reviewSlip({ book: null, bets: [{ kind: "straight", stake: 25, american_odds: null, legs: [leg({})] }] }, GAMES, NOW);
  assert.equal(one.bets.length, 1);
  assert.equal(one.bets[0].stake, 25);
  const two = reviewSlip({ book: null, bets: [{ kind: "straight", stake: 25, american_odds: null, legs: [leg({}), leg({ game_id: "lar-phi" })] }] }, GAMES, NOW);
  assert.deepEqual(two.bets.map((b) => [b.kind, b.stake, b.legs.length]), [["straight", null, 1], ["straight", null, 1]]);
});

test("nothing to save when no leg is on the board", () => {
  const { bets } = reviewSlip({ book: null, bets: [{ kind: "straight", stake: 5, american_odds: null, legs: [leg({ game_id: "early" })] }] }, GAMES, NOW);
  assert.equal(importable(bets[0]), false);
});

test("ticket grade and dollars", () => {
  assert.equal(ticketResult(["win", "win"]), "win");
  assert.equal(ticketResult(["win", null]), null);
  assert.equal(ticketResult(["loss", null]), "loss");
  assert.equal(ticketResult(["win", "push"]), "push");
  assert.equal(wagerNet(10, 4974, "win"), 497.4);
  assert.equal(wagerNet(10, -110, "win"), 9.09);
  assert.equal(wagerNet(10, -110, "loss"), -10);
  assert.equal(wagerNet(10, -110, "push"), 0);
  assert.equal(wagerNet(10, -110, null), null);
  assert.equal(fmtMoney(497.4), "$497.40");
  assert.equal(fmtMoney(-10), "-$10");
});
