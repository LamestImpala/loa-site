// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_SHIPPING_MIN } from "../records.ts";
import type { MarketMap } from "./market.ts";
import {
  REDDIT_BODY_LIMIT,
  SHOP_URL,
  WEEKLY_DROP_COUNT,
  WEEKLY_PICK_COUNT,
  demandRatio,
  dropPct,
  isRecentDrop,
  pickWeekly,
  redditMarkdown,
  redditStaleMarkdown,
  redditUpdateMarkdown,
  redditWeeklyMarkdown,
  shuffle,
} from "./reddit.ts";
import { DAY, iso, rec } from "./fixtures.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const lines = (md: string) => md.split("\n");
const tableRows = (md: string) =>
  lines(md).filter((l) => l.startsWith("| ") && !l.startsWith("| Artist"));

test("full-catalog post lists only listed, unsold records, alphabetically", () => {
  const md = redditMarkdown([
    rec({ id: 1, artist: "Zappa", title: "Hot Rats" }),
    rec({ id: 2, artist: "Beatles", title: "Revolver" }),
    rec({ id: 3, artist: "Can", title: "Ege Bamyasi", sold: true }),
    rec({ id: 4, artist: "Ash", title: "1977", listed: false }),
  ]);
  const rows = tableRows(md);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^\| Beatles \| Revolver \| \$30 \|/);
  assert.match(rows[1], /^\| Zappa \| Hot Rats \|/);
  assert.equal(lines(md)[0], "[For Sale] 2 vinyl records — collection sale, audiophile pressings — PayPal G&S");
  assert.ok(md.includes(SHOP_URL));
  assert.ok(md.includes(`bundles of ${FREE_SHIPPING_MIN}+ records`));
});

test("full-catalog cells escape pipes, collapse whitespace, and link photos", () => {
  const md = redditMarkdown([
    rec({
      artist: "A | B",
      title: "Split\n  title",
      photos: " https://imgur.com/x ",
      notes: "one|two",
    }),
  ]);
  const row = tableRows(md)[0];
  assert.ok(row.includes("| A \\| B |"));
  assert.ok(row.includes("| [Split title](https://imgur.com/x) |"));
  assert.ok(row.includes("| one\\|two |"));
  assert.equal(row.split(" | ").length, 7);
});

test("full-catalog title names the three biggest series", () => {
  const md = redditMarkdown([
    rec({ collection: "VMP" }),
    rec({ collection: "VMP" }),
    rec({ collection: "MoFi" }),
    rec({ collection: "Tone Poet" }),
    rec({ collection: "IVC" }),
    rec({ collection: "IVC" }),
  ]);
  assert.ok(lines(md)[0].includes("(VMP, IVC, MoFi)") || lines(md)[0].includes("(IVC, VMP, MoFi)"));
});

test("weekly post: headline artists by want count, Discogs links, year only", () => {
  const market: MarketMap = {
    1: { forSale: 3, want: 50, have: 10, suggested: null, lowest: null, lowestPlausible: null },
    2: { forSale: 3, want: 900, have: 10, suggested: null, lowest: null, lowestPlausible: null },
    3: { forSale: 3, want: 200, have: 10, suggested: null, lowest: null, lowestPlausible: null },
  };
  const md = redditWeeklyMarkdown(
    [
      rec({ id: 1, artist: "Low", title: "A", discogs_release_id: 111, pressing: "1999 · X" }),
      rec({ id: 2, artist: "High", title: "B", pressing: "no year" }),
      rec({ id: 3, artist: "Mid", title: "C" }),
      rec({ id: 4, artist: "High", title: "D" }), // same artist, not repeated
    ],
    120,
    market
  );
  assert.equal(
    lines(md)[0],
    `[For Sale] Weekly picks — High, Mid, Low — from a 120-record collection sale — PayPal G&S, free shipping on ${FREE_SHIPPING_MIN}+`
  );
  const rows = tableRows(md);
  assert.equal(rows[2], "| Low | [A](https://www.discogs.com/release/111) | $30 | 1999 | NM/VG+ |");
  assert.equal(rows[0], "| High | B | $30 |  | NM/VG+ |");
  assert.ok(!md.includes("Price drops"));
});

test("weekly post leads with price drops when the pick has recent ones", () => {
  const dropped = rec({ id: 1, price: 20, prev_price: 40, updated_at: iso(NOW - 2 * DAY) });
  const stale = rec({ id: 2, price: 20, prev_price: 40, updated_at: iso(NOW - 30 * DAY) });
  assert.equal(isRecentDrop(dropped, NOW), true);
  assert.equal(isRecentDrop(stale, NOW), false);
  assert.equal(isRecentDrop(rec({ price: 40, prev_price: 20, updated_at: iso(NOW) }), NOW), false);
  assert.equal(dropPct(dropped), 0.5);
  const md = redditWeeklyMarkdown([dropped, rec({ id: 3 })], 10, {});
  assert.ok(lines(md)[0].startsWith("[For Sale] Price drops + scarce picks"));
  assert.ok(md.includes("**Price drops** — 1 of these 2 came down in the last two weeks"));
  assert.ok(!md.includes("~~"), "old prices are never shown");
});

test("update body strikes sold rows and counts what's left", () => {
  const md = redditUpdateMarkdown([
    rec({ id: 1, artist: "B", title: "Gone", sold: true }),
    rec({ id: 2, artist: "A", title: "Here" }),
  ]);
  assert.equal(lines(md)[0], `**Weekly update** — 1 of 2 still available — browse everything at ${SHOP_URL}`);
  const rows = tableRows(md);
  assert.equal(rows[0], "| A | Here | $30 | 2020 | NM/VG+ |");
  assert.equal(rows[1], "| ~~B~~ | ~~Gone~~ | **SOLD** | 2020 | NM/VG+ |");
});

test("retire body keeps the posted table shape under a pointer banner", () => {
  const posted = [rec({ id: 1, artist: "Zed", sold: true, notes: "n" }), rec({ id: 2, artist: "Amy" })];
  const post = { id: 9, parent_id: null, title: "t", body: "", record_ids: [1, 2], reddit_url: null, retired_at: null, created_at: "" };
  const full = redditStaleMarkdown({ ...post, kind: "full" }, posted, "https://reddit.com/new");
  const weekly = redditStaleMarkdown({ ...post, kind: "weekly" }, posted, "https://reddit.com/new");
  assert.ok(full.startsWith("**⚠️ This post is outdated — see my [newest post](https://reddit.com/new)"));
  assert.ok(full.includes("| Artist | Title | Price | Pressing | Media | Sleeve | Notes |"));
  assert.equal(tableRows(full)[1], "| ~~Zed~~ | ~~Title 1~~ | **SOLD** | 2020 · Label CAT-1 · US | NM | VG+ | n |");
  assert.equal(tableRows(full)[0], "| Amy | Title 2 | $30 | 2020 · Label CAT-1 · US | NM | VG+ |  |");
  assert.ok(weekly.includes("| Artist | Title | Price | Year | Grade (M/S) |"));
  assert.equal(tableRows(weekly).length, 2);
});

test("demand ratio is wants per copy, never dividing by zero", () => {
  assert.equal(demandRatio({ forSale: 1, want: 10, have: 4, suggested: null, lowest: null, lowestPlausible: null }), 2.5);
  assert.equal(demandRatio({ forSale: 1, want: 10, have: 0, suggested: null, lowest: null, lowestPlausible: null }), 10);
  assert.equal(demandRatio({ forSale: 1, want: null, have: 4, suggested: null, lowest: null, lowestPlausible: null }), null);
  assert.equal(demandRatio(undefined), null);
});

test("shuffle keeps every element, leaves the input alone, and follows the random source", () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffle(input, () => 0);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(shuffle(input, () => 0), out, "deterministic under a fixed source");
  assert.deepEqual(shuffle(input, () => 0.999), input, "j = i every step is the identity");
});

test("weekly picks: drops first, then demand, fresh before last-posted, capped", () => {
  const m = (id: number, want: number, have: number, forSale: number) =>
    [id, { forSale, want, have, suggested: null, lowest: null, lowestPlausible: null }] as const;
  const market: MarketMap = Object.fromEntries([
    m(10, 100, 10, 5), // ratio 10
    m(11, 100, 50, 1), // ratio 2, scarcer
    m(12, 100, 50, 9), // ratio 2
    m(13, 5, 100, 1), // ratio 0.05
    m(20, 1000, 1, 1), // very hot but last posted
  ]);
  const records = [
    rec({ id: 1, price: 10, prev_price: 40, updated_at: iso(NOW - DAY) }), // 75% drop
    rec({ id: 2, price: 30, prev_price: 40, updated_at: iso(NOW - DAY) }), // 25% drop
    rec({ id: 3, price: 30, prev_price: 40, updated_at: iso(NOW - 20 * DAY) }), // too old
    rec({ id: 10 }),
    rec({ id: 11 }),
    rec({ id: 12 }),
    rec({ id: 13 }),
    rec({ id: 14 }), // no snapshot data
    rec({ id: 20 }),
    rec({ id: 30, sold: true }),
    rec({ id: 31, listed: false }),
    rec({ id: 32, hold_until: iso(NOW + DAY) }),
    rec({ id: 33, hold_until: iso(NOW - DAY) }), // expired hold — eligible
  ];
  const picks = pickWeekly(records, market, [20], { now: NOW, random: () => 0.999 });
  const ids = picks.map((r) => r.id);
  assert.deepEqual(ids.slice(0, 2), [1, 2], "biggest recent drops lead");
  assert.deepEqual(ids.slice(2, 6), [10, 11, 12, 13], "then demand ratio, scarcest breaking ties");
  assert.ok(ids.indexOf(20) > ids.indexOf(14), "last-posted only backfills after fresh stock");
  assert.ok(!ids.includes(30) && !ids.includes(31) && !ids.includes(32));
  assert.ok(ids.includes(33) && ids.includes(3));
  assert.equal(new Set(ids).size, ids.length);
});

test("weekly picks cap the drops and the whole pick", () => {
  const records = [
    ...Array.from({ length: 15 }, (_, i) =>
      rec({ id: 100 + i, price: 10, prev_price: 20 + i, updated_at: iso(NOW - DAY) })
    ),
    ...Array.from({ length: 30 }, (_, i) => rec({ id: 200 + i })),
  ];
  const picks = pickWeekly(records, {}, [], { now: NOW, random: () => 0.5 });
  assert.equal(picks.length, WEEKLY_PICK_COUNT);
  // The headline slots hold the steepest cuts in order; the remaining
  // five dropped records compete with everything else on demand.
  assert.deepEqual(
    picks.slice(0, WEEKLY_DROP_COUNT).map((r) => r.id),
    [114, 113, 112, 111, 110, 109, 108, 107, 106, 105]
  );
  assert.equal(REDDIT_BODY_LIMIT, 40000);
});
