// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { rec } from "./fixtures.ts";
import { INVOICE_HOLD_UNTIL, holdActive, invoiceHold, reserved } from "./records.ts";

const NOW = Date.parse("2026-09-22T12:00:00Z");

test("an invoice hold never lapses; a 48h hold does", () => {
  const invoiced = rec({ hold_until: INVOICE_HOLD_UNTIL });
  // Postgres hands the date back in its own format.
  const fromDb = rec({ hold_until: "9999-12-31T00:00:00+00:00" });
  const running = rec({ hold_until: "2026-09-23T12:00:00Z" });
  const lapsed = rec({ hold_until: "2026-09-21T12:00:00Z" });
  assert.equal(invoiceHold(invoiced), true);
  assert.equal(invoiceHold(fromDb), true);
  assert.equal(invoiceHold(running), false);
  assert.equal(holdActive(invoiced, NOW + 365 * 86400000), true);
  assert.equal(holdActive(running, NOW), true);
  assert.equal(holdActive(lapsed, NOW), false);
});

test("reserved: sold, or held for a buyer right now", () => {
  assert.equal(reserved(rec(), NOW), false);
  assert.equal(reserved(rec({ sold: true }), NOW), true);
  assert.equal(reserved(rec({ hold_until: INVOICE_HOLD_UNTIL }), NOW), true);
  assert.equal(reserved(rec({ hold_until: "2026-09-21T12:00:00Z" }), NOW), false);
});
