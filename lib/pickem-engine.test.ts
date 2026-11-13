// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closingEv,
  compactBooks,
  coverProbs,
  engineStake,
  ENGINE_BOOKS,
  findPlays,
  landingRate,
  quoteEv,
  SYNC_BOOKS,
  withoutSharp,
  type BookSnapshot,
} from "./pickem-engine.ts";
import { PUSH_RATES } from "./pickem-push-rates.ts";

const NOW = Date.parse("2026-11-15T16:00:00Z");
const FRESH = "2026-11-15T15:50:00Z";
const STALE = "2026-11-15T11:00:00Z";
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const sums = (p: { win: number; push: number; loss: number }) => near(p.win + p.push + p.loss, 1);

test("the sync asks for ten books, one region's worth, and plays are only at regulated ones", () => {
  assert.equal(SYNC_BOOKS.length, 10);
  assert.ok(SYNC_BOOKS.includes("pinnacle"));
  assert.ok(ENGINE_BOOKS.every((b) => SYNC_BOOKS.includes(b)));
  assert.ok(!ENGINE_BOOKS.includes("pinnacle") && !ENGINE_BOOKS.includes("lowvig") && !ENGINE_BOOKS.includes("bovada"));
});

test("coverProbs at Pinnacle's own half-point number is Pinnacle's fair chance", () => {
  const p = coverProbs("nfl", "spread", -3.5, 0.52, -3.5);
  near(p.win, 0.52);
  assert.equal(p.push, 0);
  sums(p);
});

test("a half point through 3 is worth more than one through 5 in the NFL", () => {
  const through3 = coverProbs("nfl", "spread", -3.5, 0.5, -2.5).win - 0.5;
  const through5 = coverProbs("nfl", "spread", -5.5, 0.5, -4.5).win - 0.5;
  near(through3, PUSH_RATES.nfl.margin[3]);
  near(through5, PUSH_RATES.nfl.margin[5]);
  assert.ok(through3 > 2 * through5);
});

test("coverProbs on and off a whole number: the push goes to a win a half point better and a loss a half point worse", () => {
  const push3 = PUSH_RATES.nfl.margin[3];
  const on = coverProbs("nfl", "spread", -3, 0.5, -3);
  near(on.push, push3);
  near(on.win, 0.5 * (1 - push3));
  sums(on);
  const better = coverProbs("nfl", "spread", -3, 0.5, -2.5);
  near(better.win, on.win + push3);
  assert.equal(better.push, 0);
  sums(better);
  const worse = coverProbs("nfl", "spread", -3, 0.5, -3.5);
  near(worse.win, on.win);
  near(worse.loss, on.loss + push3);
  sums(worse);
});

test("coverProbs works the same for the dog, the over and the under", () => {
  // Dog +3 at Pinnacle, +3.5 at the book: the favourite winning by exactly 3 now covers.
  near(coverProbs("nfl", "spread", 3, 0.5, 3.5).win, 0.5 * (1 - PUSH_RATES.nfl.margin[3]) + PUSH_RATES.nfl.margin[3]);
  // Over 44.5 at Pinnacle, over 43.5 at the book (an over's handicap is minus the total): a 44 now wins.
  near(coverProbs("nfl", "total", -44.5, 0.5, -43.5).win, 0.5 + PUSH_RATES.nfl.total);
  // Under 44.5 at Pinnacle, under 45.5 at the book: a 45 now wins.
  near(coverProbs("nfl", "total", 44.5, 0.5, 45.5).win, 0.5 + PUSH_RATES.nfl.total);
  // And a worse number costs the same.
  near(coverProbs("nfl", "total", 44.5, 0.5, 43.5).win, 0.5 - PUSH_RATES.nfl.total);
});

test("landingRate falls back to a flat rate for a margin the table lacks", () => {
  assert.equal(landingRate("nfl", "spread", -3), PUSH_RATES.nfl.margin[3]);
  assert.equal(landingRate("nfl", "spread", 40), 0.03);
  assert.equal(landingRate("ncaaf", "total", 55), PUSH_RATES.ncaaf.total);
});

test("quoteEv: a coin flip loses at -110, breaks even at +100 and wins at +105", () => {
  const flip = { win: 0.5, loss: 0.5 };
  assert.ok(quoteEv(flip, -110) < 0);
  near(quoteEv(flip, 100), 0);
  assert.ok(quoteEv(flip, 105) > 0);
});

test("engineStake steps at 2%, 3.5% and 5%", () => {
  assert.deepEqual([0.019, 0.02, 0.034, 0.035, 0.05, 0.2].map(engineStake), [0, 1, 1, 2, 3, 3]);
});

// Pinnacle has the home team -3 at even prices both ways; everything else is built around that.
const snapshot = (books: BookSnapshot): BookSnapshot => ({ pinnacle: { u: FRESH, s: [-3, -105, -105], t: [44.5, -105, -105] }, ...books });

test("findPlays takes the best regulated quote, at that book's line and price", () => {
  const { plays, skipped } = findPlays(
    "nfl",
    "g1",
    snapshot({
      draftkings: { u: FRESH, s: [-2.5, -110, -110], t: [44.5, -110, -110] },
      fanduel: { u: FRESH, s: [-3, -110, -110], t: [44.5, -112, -108] },
      // Offshore: a better number still, and not bettable.
      lowvig: { u: FRESH, s: [-2, 100, -120], t: [43, -105, -105] },
    }),
    NOW,
    { draftkings: "DraftKings" }
  );
  assert.equal(plays.length, 1);
  const p = plays[0];
  assert.deepEqual([p.game_id, p.market, p.selection, p.book_key, p.book, p.line, p.price], ["g1", "spread", "home", "draftkings", "DraftKings", -2.5, -110]);
  near(p.win_prob, 0.5 * (1 - PUSH_RATES.nfl.margin[3]) + PUSH_RATES.nfl.margin[3], 1e-4);
  assert.ok(p.ev > 0.035 && p.ev < 0.06);
  assert.equal(p.tier, "play");
  assert.equal(p.stake, engineStake(p.ev));
  assert.deepEqual(p.pinnacle, { line: -3, price: -105, other: -105, fair: 0.5, updated_at: FRESH });
  // The total had bettable quotes and none of them was worth 2%.
  assert.deepEqual(skipped, { no_edge: 1 });
});

test("findPlays records a price that beats Pinnacle's by less than 2% as a lean at no stake", () => {
  // The same number as Pinnacle at a better price than its fair even money.
  const { plays } = findPlays("nfl", "g1", snapshot({ betmgm: { u: FRESH, s: [-3, 102, -125] } }), NOW);
  assert.equal(plays.length, 1);
  assert.deepEqual([plays[0].tier, plays[0].stake, plays[0].selection, plays[0].price], ["lean", 0, "home", 102]);
  assert.ok(plays[0].ev > 0 && plays[0].ev < 0.02);
});

test("findPlays gives one play a market even when both sides qualify at different books", () => {
  const { plays } = findPlays(
    "nfl",
    "g1",
    snapshot({ draftkings: { u: FRESH, s: [-2.5, -110, -110] }, fanduel: { u: FRESH, s: [-3.5, -110, -110] } }),
    NOW
  );
  assert.equal(plays.filter((p) => p.market === "spread").length, 1);
});

test("findPlays says why a market gave nothing", () => {
  const dk = (lines: Partial<BookSnapshot[string]>): BookSnapshot => ({ draftkings: { u: FRESH, ...lines } });
  const reason = (books: BookSnapshot) => findPlays("nfl", "g1", books, NOW).skipped;
  assert.deepEqual(reason({ draftkings: { u: FRESH, s: [-2.5, -110, -110], t: [44.5, -110, -110] } }), { no_pinnacle: 2 });
  assert.deepEqual(reason({ pinnacle: { u: STALE, s: [-3, -105, -105], t: [44.5, -105, -105] }, ...dk({ s: [-2.5, -110, -110] }) }), { stale_pinnacle: 2 });
  assert.deepEqual(reason(snapshot({ lowvig: { u: FRESH, s: [-2.5, -105, -105], t: [44.5, -105, -105] } })), { no_book: 2 });
  assert.deepEqual(reason(snapshot({ draftkings: { u: STALE, s: [-2.5, -110, -110], t: [43.5, -110, -110] } })), { stale_book: 2 });
  // Two and a half points off Pinnacle on the spread, three and a half on the total.
  assert.deepEqual(reason(snapshot(dk({ s: [-0.5, -110, -110], t: [48, -110, -110] }))), { gap: 2 });
  assert.deepEqual(reason(snapshot(dk({ s: [-2.5, -140, 118], t: [44.5, -140, 125] }))), { price: 1, no_edge: 1 });
  assert.deepEqual(reason(snapshot(dk({ s: [-3, -110, -110], t: [44.5, -110, -110] }))), { no_edge: 2 });
});

test("closingEv is positive when the close moved the play's way and negative when it moved against", () => {
  const play = { market: "spread" as const, selection: "home" as const, line: -2.5, price: -110 };
  const toward = closingEv("nfl", play, { pinnacle: { u: FRESH, s: [-3.5, -105, -105] } });
  assert.equal(toward?.close_line, -3.5);
  assert.ok(toward!.close_ev > 0.1);
  const against = closingEv("nfl", play, { pinnacle: { u: FRESH, s: [-1.5, -105, -105] } });
  assert.equal(against?.close_line, -1.5);
  assert.ok(against!.close_ev < -0.05);
  assert.equal(closingEv("nfl", play, { draftkings: { u: FRESH, s: [-3.5, -110, -110] } }), null);
  // An over taken at 43.5 that closed 45.5 at Pinnacle.
  const over = closingEv("nfl", { market: "total", selection: "over", line: 43.5, price: -110 }, { pinnacle: { u: FRESH, t: [45.5, -105, -105] } });
  assert.equal(over?.close_line, 45.5);
  assert.ok(over!.close_ev > 0);
});

const EVENT = {
  id: "g1",
  home_team: "Home",
  away_team: "Away",
  bookmakers: [
    {
      key: "draftkings",
      last_update: FRESH,
      markets: [
        { key: "spreads", outcomes: [{ name: "Away", price: -112, point: 2.5 }, { name: "Home", price: -108, point: -2.5 }] },
        { key: "totals", outcomes: [{ name: "Over", price: -110, point: 44.5 }, { name: "Under", price: -110, point: 44.5 }] },
        { key: "h2h", outcomes: [{ name: "Home", price: -140 }, { name: "Away", price: 120 }] },
      ],
    },
    { key: "pinnacle", last_update: FRESH, markets: [{ key: "spreads", outcomes: [{ name: "Home", price: -105, point: -3 }, { name: "Away", price: -105, point: 3 }] }] },
    { key: "betus", markets: [{ key: "h2h", outcomes: [{ name: "Home", price: -140 }, { name: "Away", price: 120 }] }] },
  ],
};

test("compactBooks keeps each book's spread and total from the home side, and drops a book with neither", () => {
  assert.deepEqual(compactBooks(EVENT), {
    draftkings: { u: FRESH, s: [-2.5, -108, -112], t: [44.5, -110, -110] },
    pinnacle: { u: FRESH, s: [-3, -105, -105] },
  });
});

test("withoutSharp removes Pinnacle, so the board's consensus and best lines never see it", () => {
  assert.deepEqual(withoutSharp(EVENT).bookmakers.map((b) => b.key), ["draftkings", "betus"]);
  assert.equal(EVENT.bookmakers.length, 3);
});
