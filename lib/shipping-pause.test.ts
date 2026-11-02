// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeShippingPause,
  formatDayRange,
  parseShippingPause,
  shippingPauseSentence,
  shippingPauseShort,
  todayInPhoenix,
} from "./shipping-pause.ts";

const nov = JSON.stringify({ from: "2026-11-03", until: "2026-11-11", shipsOn: "2026-11-12", note: "" });

test("shipping pause: parses a good value and trims the note", () => {
  const p = parseShippingPause(JSON.stringify({ from: "2026-11-03", until: "2026-11-11", shipsOn: "2026-11-12", note: "  Thanks for your patience!  " }));
  assert.deepEqual(p, { from: "2026-11-03", until: "2026-11-11", shipsOn: "2026-11-12", note: "Thanks for your patience!" });
  assert.equal(parseShippingPause(nov)?.note, "");
});

test("shipping pause: blank, junk, bad dates and bad ordering read as no pause", () => {
  assert.equal(parseShippingPause(""), null);
  assert.equal(parseShippingPause("   "), null);
  assert.equal(parseShippingPause(null), null);
  assert.equal(parseShippingPause("not json"), null);
  assert.equal(parseShippingPause("[]"), null);
  assert.equal(parseShippingPause(JSON.stringify({ from: "2026-11-3", until: "2026-11-11", shipsOn: "2026-11-12" })), null);
  assert.equal(parseShippingPause(JSON.stringify({ from: "2026-02-30", until: "2026-03-02", shipsOn: "2026-03-03" })), null);
  // until before from
  assert.equal(parseShippingPause(JSON.stringify({ from: "2026-11-11", until: "2026-11-03", shipsOn: "2026-11-12" })), null);
  // ships on the last away day
  assert.equal(parseShippingPause(JSON.stringify({ from: "2026-11-03", until: "2026-11-11", shipsOn: "2026-11-11" })), null);
});

test("shipping pause: today in Phoenix is fixed at UTC-7", () => {
  assert.equal(todayInPhoenix(new Date("2026-11-12T06:59:00Z")), "2026-11-11");
  assert.equal(todayInPhoenix(new Date("2026-11-12T07:00:00Z")), "2026-11-12");
});

test("shipping pause: active before and during the window, gone from the ship day", () => {
  const p = parseShippingPause(nov);
  assert.ok(p);
  assert.equal(activeShippingPause(p, new Date("2026-11-01T12:00:00-07:00")), p);
  assert.equal(activeShippingPause(p, new Date("2026-11-03T00:00:00-07:00")), p);
  assert.equal(activeShippingPause(p, new Date("2026-11-11T23:59:00-07:00")), p);
  assert.equal(activeShippingPause(p, new Date("2026-11-12T00:01:00-07:00")), null);
  assert.equal(activeShippingPause(null, new Date()), null);
});

test("shipping pause: date ranges collapse within a month", () => {
  assert.equal(formatDayRange("2026-11-03", "2026-11-11"), "Nov 3–11");
  assert.equal(formatDayRange("2026-11-28", "2026-12-03"), "Nov 28 – Dec 3");
  assert.equal(formatDayRange("2026-11-03", "2026-11-03"), "Nov 3");
});

test("shipping pause: the customer sentence", () => {
  const p = parseShippingPause(nov)!;
  assert.equal(
    shippingPauseSentence(p),
    "Heads up: I'm away Nov 3–11. Anything requested in that window ships Thursday, Nov 12."
  );
  assert.equal(
    shippingPauseSentence({ ...p, note: "Thanks for your patience!" }),
    "Heads up: I'm away Nov 3–11. Anything requested in that window ships Thursday, Nov 12. Thanks for your patience!"
  );
  assert.equal(
    shippingPauseSentence({ from: "2026-11-03", until: "2026-11-03", shipsOn: "2026-11-04", note: "" }),
    "Heads up: I'm away Nov 3. Anything requested that day ships Wednesday, Nov 4."
  );
  assert.equal(shippingPauseShort(p), "I'm away until Nov 11, so it'll ship Thursday, Nov 12.");
});
