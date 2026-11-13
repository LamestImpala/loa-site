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
  filtersActive,
  filtersFromQuery,
  filtersToQuery,
  sortRecords,
  type CatalogFilters,
} from "./catalog-filter.ts";
import { DAY, gear, iso, poster, rec } from "./fixtures.ts";

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

test("kind filter: records, posters or equipment; search reaches a poster's details", () => {
  const mixed = [...catalog, poster({ id: 5, details: { venue: "Wrigley Field", city: "Chicago" } }), gear({ id: 6 })];
  assert.deepEqual(ids(filterRecords(mixed, DEFAULT_FILTERS, ctx)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(filterRecords(mixed, withF({ kind: "record" }), ctx)), [1, 2, 3, 4]);
  assert.deepEqual(ids(filterRecords(mixed, withF({ kind: "poster" }), ctx)), [5]);
  assert.deepEqual(ids(filterRecords(mixed, withF({ kind: "gear" }), ctx)), [6]);
  assert.deepEqual(ids(filterRecords(mixed, withF({ search: "wrigley" }), ctx)), [5]);
  assert.deepEqual(ids(filterRecords(mixed, withF({ search: "very good" }), ctx)), [6]);
  const q = filtersToQuery(withF({ kind: "poster" }), "artist");
  assert.equal(q.get("kind"), "poster");
  assert.equal(filtersFromQuery(q).filters.kind, "poster");
  assert.equal(filtersFromQuery(new URLSearchParams("kind=bogus")).filters.kind, "all");
});

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
    kind: "record",
    genre: "Rock",
    collection: "none",
    letter: "P",
    shown: "hidden",
    sold: "unsold",
    interest: "clicked-no-request",
    status: "draft",
  };
  const query = filtersToQuery(view, "price-desc");
  assert.equal(
    query.toString(),
    "q=pink+floyd&kind=record&genre=Rock&collection=none&letter=P&shown=hidden&sold=unsold&interest=clicked-no-request&status=draft&sort=price-desc"
  );
  assert.deepEqual(filtersFromQuery(query), { filters: view, sort: "price-desc" });
});

test("unrecognised URL values fall back to the defaults", () => {
  const parsed = filtersFromQuery(
    new URLSearchParams("shown=maybe&sold=&interest=x&status=nope&sort=random&record=12")
  );
  assert.deepEqual(parsed, { filters: DEFAULT_FILTERS, sort: "artist" });
});

test("status filter: drafts, held, needs photos and $0", () => {
  const records = [
    rec({ id: 1, price: 60 }), // on the shop, $40+, stock cover only
    rec({ id: 2, price: 60, photo_urls: ["a.jpg"] }),
    rec({ id: 3, price: 0, listed: false, draft: true }), // waiting for its first price
    rec({ id: 4, price: 25, listed: false, draft: true }),
    rec({ id: 5, price: 25, listed: false }), // hidden on purpose, not a draft
    rec({ id: 6, price: 25, hold_until: iso(NOW + DAY) }),
    rec({ id: 7, price: 25, hold_until: iso(NOW - DAY) }), // hold lapsed
    rec({ id: 8, price: 0, sold: true }), // a sold record's price is history
    rec({ id: 9, price: 25, listed: true, draft: true }), // published: the flag no longer counts
  ];
  const by = (status: CatalogFilters["status"]) => ids(filterRecords(records, withF({ status }), ctx));
  assert.deepEqual(by("draft"), [3, 4]);
  assert.deepEqual(by("held"), [6]);
  assert.deepEqual(by("needs-photos"), [1]);
  assert.deepEqual(by("unpriced"), [3]);
  assert.deepEqual(by("all"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("filtersActive: anything narrowing the list, but not the sort", () => {
  assert.equal(filtersActive(DEFAULT_FILTERS), false);
  assert.equal(filtersActive(withF({ status: "held" })), true);
  assert.equal(filtersActive(withF({ search: "x" })), true);
  assert.equal(filtersActive(withF({ letter: "B" })), true);
});
