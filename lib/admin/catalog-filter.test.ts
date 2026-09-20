// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordInterest } from "../supabase.ts";
import type { MarketMap } from "./market.ts";
import {
  DEFAULT_FILTERS,
  OFF_MARKET_HIGH,
  OFF_MARKET_LOW,
  filterRecords,
  filtersFromQuery,
  filtersToQuery,
  sortRecords,
  type CatalogFilters,
} from "./catalog-filter.ts";
import { DAY, iso, rec } from "./fixtures.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ctx = { interest: {}, market: {}, now: NOW };
const ids = (list: { id: number }[]) => list.map((r) => r.id);
const withF = (over: Partial<CatalogFilters>) => ({ ...DEFAULT_FILTERS, ...over });

const catalog = [
  rec({ id: 1, artist: "Beatles", title: "Revolver", genres: ["Rock", "Pop"], collection: "VMP" }),
  rec({ id: 2, artist: "Coltrane", title: "A Love Supreme", genres: ["Jazz"], collection: null, listed: false }),
  rec({ id: 3, artist: "2Pac", title: "All Eyez", pressing: "1996 · Death Row", genres: ["Hip Hop"], sold: true }),
  rec({ id: 4, artist: "beach house", title: "Bloom", genres: ["Rock"], collection: "MoFi" }),
];

test("the default filters pass everything through untouched", () => {
  assert.deepEqual(ids(filterRecords(catalog, DEFAULT_FILTERS, ctx)), [1, 2, 3, 4]);
});

test("search matches artist, title, pressing, genres, and series, case-insensitively", () => {
  assert.deepEqual(ids(filterRecords(catalog, withF({ search: "  BEAT" }), ctx)), [1]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ search: "supreme" }), ctx)), [2]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ search: "death row" }), ctx)), [3]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ search: "rock" }), ctx)), [1, 4]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ search: "mofi" }), ctx)), [4]);
});

test("genre, series, letter, shown, and sold filters", () => {
  assert.deepEqual(ids(filterRecords(catalog, withF({ genre: "Rock" }), ctx)), [1, 4]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ collection: "VMP" }), ctx)), [1]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ collection: "none" }), ctx)), [2, 3]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ letter: "B" }), ctx)), [1, 4]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ letter: "#" }), ctx)), [3]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ shown: "shown" }), ctx)), [1, 3, 4]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ shown: "hidden" }), ctx)), [2]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ sold: "sold" }), ctx)), [3]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ sold: "unsold" }), ctx)), [1, 2, 4]);
  assert.deepEqual(ids(filterRecords(catalog, withF({ genre: "Rock", letter: "B", search: "bloom" }), ctx)), [4]);
});

test("clicked-no-request: looked at, never asked about, still buyable", () => {
  const i = (record_id: number, interest_sessions: number, request_sessions: number): RecordInterest => ({
    record_id,
    interest_events: interest_sessions,
    interest_sessions,
    request_events: request_sessions,
    request_sessions,
    last_event_at: "",
  });
  const records = [
    rec({ id: 1 }),
    rec({ id: 2 }), // no interest row
    rec({ id: 3 }), // zero sessions
    rec({ id: 4 }), // requested
    rec({ id: 5, sold: true }),
    rec({ id: 6, hold_until: iso(NOW + DAY) }),
    rec({ id: 7, hold_until: iso(NOW - DAY) }), // expired hold still counts
  ];
  const interest = Object.fromEntries(
    [i(1, 3, 0), i(3, 0, 0), i(4, 3, 1), i(5, 3, 0), i(6, 3, 0), i(7, 3, 0)].map((x) => [x.record_id, x])
  );
  assert.deepEqual(
    ids(filterRecords(records, withF({ interest: "clicked-no-request" }), { ...ctx, interest })),
    [1, 7]
  );
});

test("manual-off-market: hand-priced listings outside 60–130% of the grade suggestion", () => {
  const stats = (suggested: number | null) => ({ forSale: 1, want: 1, have: 1, suggested, lowest: null, lowestPlausible: null });
  const market: MarketMap = {
    1: stats(100), 2: stats(100), 3: stats(100), 4: stats(100), 5: stats(100), 6: stats(null), 7: stats(100), 8: stats(100),
  };
  const records = [
    rec({ id: 1, manual_price: true, price: 100 * OFF_MARKET_HIGH }), // boundary: in range
    rec({ id: 2, manual_price: true, price: 131 }),
    rec({ id: 3, manual_price: true, price: 100 * OFF_MARKET_LOW }), // boundary: in range
    rec({ id: 4, manual_price: true, price: 59 }),
    rec({ id: 5, manual_price: false, price: 200 }), // the run already handles it
    rec({ id: 6, manual_price: true, price: 200 }), // no suggestion to compare against
    rec({ id: 7, manual_price: true, price: 200, sold: true }),
    rec({ id: 8, manual_price: true, price: 200, listed: false }),
  ];
  assert.deepEqual(ids(filterRecords(records, withF({ interest: "manual-off-market" }), { ...ctx, market })), [2, 4]);
});

test("sorts: artist keeps the incoming order; the rest break ties alphabetically", () => {
  const list = [
    rec({ id: 1, artist: "B", title: "x", price: 20, created_at: "2026-09-02T00:00:00Z" }),
    rec({ id: 2, artist: "A", title: "y", price: 20, created_at: "2026-09-03T00:00:00Z" }),
    rec({ id: 3, artist: "C", title: "z", price: 50, created_at: "2026-09-03T00:00:00Z" }),
    rec({ id: 4, artist: "D", title: "w", price: 5, created_at: undefined }),
  ];
  const interest = {
    1: { record_id: 1, interest_events: 0, interest_sessions: 2, request_events: 0, request_sessions: 0, last_event_at: "" },
    3: { record_id: 3, interest_events: 0, interest_sessions: 9, request_events: 0, request_sessions: 0, last_event_at: "" },
  };
  assert.equal(sortRecords(list, "artist", {}), list, "same array, no copy");
  assert.deepEqual(ids(sortRecords(list, "price-desc", {})), [3, 2, 1, 4]);
  assert.deepEqual(ids(sortRecords(list, "price-asc", {})), [4, 2, 1, 3]);
  assert.deepEqual(ids(sortRecords(list, "interest", interest)), [3, 1, 2, 4]);
  assert.deepEqual(ids(sortRecords(list, "added", {})), [3, 2, 1, 4], "newest first, higher id wins a tie");
  assert.deepEqual(ids(list), [1, 2, 3, 4], "input untouched");
});

test("the catalog view round-trips through the URL, defaults left out", () => {
  assert.equal(filtersToQuery(DEFAULT_FILTERS, "artist").toString(), "");
  const view: CatalogFilters = {
    search: "pink floyd",
    genre: "Rock",
    collection: "none",
    letter: "P",
    shown: "hidden",
    sold: "unsold",
    interest: "clicked-no-request",
  };
  const query = filtersToQuery(view, "price-desc");
  assert.equal(
    query.toString(),
    "q=pink+floyd&genre=Rock&collection=none&letter=P&shown=hidden&sold=unsold&interest=clicked-no-request&sort=price-desc"
  );
  assert.deepEqual(filtersFromQuery(query), { filters: view, sort: "price-desc" });
});

test("unrecognised URL values fall back to the defaults", () => {
  const parsed = filtersFromQuery(
    new URLSearchParams("shown=maybe&sold=&interest=x&sort=random&record=12")
  );
  assert.deepEqual(parsed, { filters: DEFAULT_FILTERS, sort: "artist" });
});
