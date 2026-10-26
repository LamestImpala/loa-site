// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanDiscogsName,
  groupBySide,
  idFromSlug,
  recordPath,
  relatedGroups,
  releaseDetailsFromDiscogs,
  splitPressing,
  trackRecordLine,
} from "./record-info.ts";
import type { DbRecord } from "./supabase.ts";

test("record path: id prefix plus a readable slug", () => {
  assert.equal(
    recordPath({ id: 42, artist: "Beyoncé & Jay-Z", title: "Everything Is Love" }),
    "/r/42-beyonce-and-jay-z-everything-is-love"
  );
  assert.equal(recordPath({ id: 7, artist: "", title: "!!!" }), "/r/7");
});

test("idFromSlug reads the leading id only", () => {
  assert.equal(idFromSlug("42-anything-here"), 42);
  assert.equal(idFromSlug("42"), 42);
  assert.equal(idFromSlug("abc-42"), null);
  assert.equal(idFromSlug("0-zero"), null);
});

test("Discogs (n) suffixes are stripped, other parens kept", () => {
  assert.equal(cleanDiscogsName("Fonograf (3) B003283601"), "Fonograf B003283601");
  assert.equal(cleanDiscogsName("Hyperspace (2020)"), "Hyperspace (2020)");
  assert.equal(cleanDiscogsName("Live (Deluxe)"), "Live (Deluxe)");
});

test("pressing line splits into year, label and formats", () => {
  assert.deepEqual(splitPressing("2021 · Fonograf (3) B003283601 · Limited Edition"), {
    year: "2021",
    label: "Fonograf B003283601",
    formats: "Limited Edition",
  });
  assert.deepEqual(splitPressing("Columbia KC 1234"), {
    year: null,
    label: "Columbia KC 1234",
    formats: null,
  });
});

test("release details: headings dropped, index tracks flattened, barcode digits", () => {
  const d = releaseDetailsFromDiscogs({
    country: "US",
    styles: ["Indie Rock"],
    identifiers: [{ type: "Barcode", value: "0 93624-83453 3" }],
    tracklist: [
      { type_: "heading", title: "Side A" },
      { type_: "track", position: "A1", title: "One", duration: "3:01" },
      {
        type_: "index",
        title: "Suite",
        sub_tracks: [{ type_: "track", position: "B1a", title: "Part 1", duration: "" }],
      },
    ],
  });
  assert.deepEqual(d, {
    country: "US",
    styles: ["Indie Rock"],
    barcode: "093624834533",
    tracklist: [
      { position: "A1", title: "One", duration: "3:01" },
      { position: "B1a", title: "Part 1", duration: "" },
    ],
  });
});

test("tracks group by side letter; numeric positions stay one group", () => {
  const sides = groupBySide([
    { position: "A1", title: "a", duration: "" },
    { position: "A2", title: "b", duration: "" },
    { position: "B1", title: "c", duration: "" },
  ]);
  assert.deepEqual(sides.map((s) => [s.side, s.tracks.length]), [["A", 2], ["B", 1]]);
  assert.equal(groupBySide([{ position: "1", title: "x", duration: "" }])[0].side, "");
});

function rec(over: Partial<DbRecord>): DbRecord {
  return {
    id: 1, artist: "A", title: "T", pressing: "", media: "NM", sleeve: "NM", price: 20,
    notes: "", photos: "", discogs_release_id: null, cover_image: "", genres: ["Rock"],
    collection: null, photo_urls: [], hold_until: null, sold: false, listed: true,
    updated_at: "2026-01-01T00:00:00Z", ...over,
  } as DbRecord;
}

test("related groups: same artist first, no repeats, sold and held excluded", () => {
  const current = rec({ id: 1, artist: "Beck", collection: "VMP" });
  const all = [
    current,
    rec({ id: 2, artist: "Beck" }),
    rec({ id: 3, artist: "Beck", sold: true }),
    rec({ id: 4, artist: "Other", collection: "VMP" }),
    rec({ id: 5, artist: "Third", hold_until: "2999-01-01T00:00:00Z" }),
    rec({ id: 6, artist: "Fourth", price: 21 }),
  ];
  const groups = relatedGroups(current, all, 4, Date.parse("2026-10-25"));
  assert.deepEqual(
    groups.map((g) => [g.title, g.records.map((r) => r.id)]),
    [
      ["More by Beck", [2]],
      ["More from the VMP shelf", [4]],
      ["More Rock around $20", [6]],
    ]
  );
});

test("track record line: hidden below the minimum, month and year in Phoenix time", () => {
  assert.equal(trackRecordLine(null), null);
  assert.equal(trackRecordLine({ soldCount: 3, firstSale: null }), null);
  assert.equal(
    trackRecordLine({ soldCount: 45, firstSale: "2026-08-01T03:00:00Z" }),
    "45 records sold since July 2026"
  );
  assert.equal(trackRecordLine({ soldCount: 12, firstSale: null }), "12 records sold");
});
