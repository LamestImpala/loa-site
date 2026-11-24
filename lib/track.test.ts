// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrackBody } from "./track.ts";

const SID = "3f2b8c1e-5d47-4a9b-8e21-0c6d9f7a1b23";

test("click: a known event on a record parses", () => {
  for (const event of ["photo_open", "discogs_click", "bundle_add", "buy_request"]) {
    assert.deepEqual(parseTrackBody({ record_id: 118, event, session_id: SID }), {
      kind: "event",
      recordId: 118,
      event,
      sessionId: SID,
    });
  }
});

test("click: anything else is refused", () => {
  const ok = { record_id: 118, event: "photo_open", session_id: SID };
  const bad: unknown[] = [
    null,
    undefined,
    "photo_open",
    42,
    [],
    {},
    { ...ok, event: "page_view" },
    { ...ok, event: 7 },
    { ...ok, event: undefined },
    { ...ok, record_id: "118" },
    { ...ok, record_id: 0 },
    { ...ok, record_id: -3 },
    { ...ok, record_id: 1.5 },
    { ...ok, record_id: null },
    { ...ok, session_id: "not-a-uuid" },
    { ...ok, session_id: `${SID}; drop table records` },
    { ...ok, session_id: 12 },
    { record_id: 118, event: "photo_open" },
  ];
  for (const body of bad) assert.equal(parseTrackBody(body), null, JSON.stringify(body));
});

test("visit: catalog and record pages parse, the referrer is lowercased", () => {
  assert.deepEqual(parseTrackBody({ event: "visit", path: "/records", session_id: SID }), {
    kind: "visit",
    sessionId: SID,
    path: "/records",
    recordId: null,
    referrerHost: null,
  });
  assert.deepEqual(
    parseTrackBody({
      event: "visit",
      path: "/records/r/118-eric-clapton-life-in-12-bars",
      record_id: 118,
      referrer_host: "Old.Reddit.com",
      session_id: SID,
    }),
    {
      kind: "visit",
      sessionId: SID,
      path: "/records/r/118-eric-clapton-life-in-12-bars",
      recordId: 118,
      referrerHost: "old.reddit.com",
    }
  );
  // sendBeacon's JSON drops undefined; an explicit null means the same.
  const nulls = parseTrackBody({
    event: "visit",
    path: "/records/reviews",
    record_id: null,
    referrer_host: null,
    session_id: SID,
  });
  assert.equal(nulls?.kind, "visit");
});

test("visit: anything else is refused", () => {
  const ok = { event: "visit", path: "/records", session_id: SID };
  const bad: unknown[] = [
    { ...ok, path: "/admin" },
    { ...ok, path: "/recordsx" },
    { ...ok, path: "/records/<script>" },
    { ...ok, path: "/records?x=1" },
    { ...ok, path: "/records/a b" },
    { ...ok, path: `/records/${"a".repeat(200)}` },
    { ...ok, path: 5 },
    { event: "visit", session_id: SID },
    { ...ok, session_id: "nope" },
    { ...ok, record_id: "118" },
    { ...ok, record_id: 0 },
    { ...ok, referrer_host: "evil.com/path" },
    { ...ok, referrer_host: "a b" },
    { ...ok, referrer_host: "a".repeat(101) },
    { ...ok, referrer_host: 9 },
    { ...ok, referrer_host: "" },
  ];
  for (const body of bad) assert.equal(parseTrackBody(body), null, JSON.stringify(body));
});
