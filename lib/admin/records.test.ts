// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { poster, rec } from "./fixtures.ts";
import {
  INVOICE_HOLD_UNTIL,
  PHOTO_NUDGE_PRICE,
  PRICE_RUN_GRACE_HOURS,
  awaitsPriceRun,
  holdActive,
  invoiceHold,
  isDraft,
  needsPhotos,
  publishBlock,
  reserved,
  withDraftCleared,
} from "./records.ts";

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

test("a draft is flagged, off the shop and unsold; publishing ends it for good", () => {
  assert.equal(isDraft(rec({ draft: true, listed: false })), true);
  assert.equal(isDraft(rec({ draft: true, listed: true })), false);
  assert.equal(isDraft(rec({ draft: true, listed: false, sold: true })), false);
  assert.equal(isDraft(rec({ listed: false })), false, "hidden on purpose");
  assert.equal(isDraft(rec({ draft: undefined, listed: false })), false, "column not there yet");
});

test("a draft needs a price, and a record its grades, before it can be published", () => {
  assert.equal(publishBlock(rec({ price: 25 })), null);
  assert.equal(publishBlock(rec({ price: 0 })), "set a price above $0 first");
  assert.equal(publishBlock(rec({ price: 25, media: "" })), "grade the media and sleeve first");
  assert.equal(publishBlock(rec({ price: 25, sleeve: "" })), "grade the media and sleeve first");
  assert.equal(publishBlock(poster({ price: 120 })), null, "posters have no grades");
  assert.equal(publishBlock(poster({ price: 0 })), "set a price above $0 first");
});

test("the price run takes a $0 draft record with a Discogs release, for a day and a half", () => {
  const added = "2026-09-22T06:00:00Z";
  const draft = { draft: true, listed: false, price: 0, discogs_release_id: 99, created_at: added };
  assert.equal(awaitsPriceRun(rec(draft), NOW), true);
  assert.equal(awaitsPriceRun(rec({ ...draft, price: 20 }), NOW), false, "priced by hand");
  assert.equal(awaitsPriceRun(rec({ ...draft, manual_price: true }), NOW), false);
  assert.equal(awaitsPriceRun(rec({ ...draft, discogs_release_id: null }), NOW), false);
  assert.equal(awaitsPriceRun(poster({ ...draft }), NOW), false, "the run prices records only");
  assert.equal(awaitsPriceRun(rec({ ...draft, listed: true }), NOW), false, "not a draft");
  const late = Date.parse(added) + PRICE_RUN_GRACE_HOURS * 3600 * 1000;
  assert.equal(awaitsPriceRun(rec(draft), late - 1), true);
  assert.equal(awaitsPriceRun(rec(draft), late), false, "the run found no price: the seller's job now");
});

test("needs photos: on the shop, unsold, at the nudge price, with only a stock cover", () => {
  assert.equal(needsPhotos(rec({ price: PHOTO_NUDGE_PRICE })), true);
  assert.equal(needsPhotos(rec({ price: PHOTO_NUDGE_PRICE - 1 })), false);
  assert.equal(needsPhotos(rec({ price: 90, photo_urls: ["a.jpg"] })), false);
  assert.equal(needsPhotos(rec({ price: 90, sold: true })), false);
  assert.equal(needsPhotos(rec({ price: 90, listed: false })), false);
});

test("a draft leaves Draft, still hidden, once its price and grades are in", () => {
  const draft = rec({ draft: true, listed: false, price: 0, media: "VG+", sleeve: "VG+" });
  // The price was the last thing missing: out of Draft, not on the shop.
  assert.deepEqual(withDraftCleared(draft, { price: 30 }), { price: 30, draft: false });
  // Still $0 — stays a draft.
  assert.deepEqual(withDraftCleared(draft, { notes: "x" }), { notes: "x" });

  const ungraded = rec({ draft: true, listed: false, price: 30, media: "", sleeve: "" });
  assert.deepEqual(withDraftCleared(ungraded, { media: "VG+" }), { media: "VG+" });
  const halfGraded = { ...ungraded, media: "VG+" };
  assert.deepEqual(withDraftCleared(halfGraded, { sleeve: "VG" }), { sleeve: "VG", draft: false });

  // Posters and gear need only a price.
  const p = poster({ draft: true, listed: false, price: 0 });
  assert.deepEqual(withDraftCleared(p, { price: 20 }), { price: 20, draft: false });

  // Not a draft (already shown, or hidden later): the edit goes through as is.
  assert.deepEqual(withDraftCleared(rec({ draft: false, listed: false, price: 5 }), { price: 9 }), { price: 9 });
  // An explicit draft value (publishing) wins.
  assert.deepEqual(withDraftCleared(draft, { listed: true, draft: false }), { listed: true, draft: false });
});
