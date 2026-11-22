// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { DAY, iso, order, rec, shipment } from "./fixtures.ts";
import { askableOrders, parseImportedReview, recordsByOrder, recordsBySale } from "./reviews.ts";
import { addImportedReview, ensureReviewInvite, updateReview } from "./reviews-db.ts";
import type { ReviewInvite } from "../supabase.ts";

const now = Date.parse("2026-11-20T15:00:00Z");
const invite = (over: Partial<ReviewInvite>): ReviewInvite => ({
  id: 1,
  order_id: 1,
  token: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
  email: null,
  sent_at: null,
  used_at: null,
  created_at: iso(now),
  ...over,
});

test("askable orders: paid, every box out in the last 60 days, no review yet", () => {
  const orders = [
    order({ id: 1, status: "paid", buyer_email: "a@example.com" }), // auto-emailed later
    order({ id: 2, status: "paid" }), // Reddit buyer, copy the link
    order({ id: 3, status: "paid" }), // box still home
    order({ id: 4, status: "paid" }), // too long ago
    order({ id: 5, status: "paid" }), // reviewed
    order({ id: 6, status: "paid" }), // link used
    order({ id: 7, status: "refunded" }),
    order({ id: 8, status: "paid", buyer_email: "h@example.com" }), // already emailed
    order({ id: 9, status: "paid" }), // handed over in person yesterday
  ];
  const shipments = [
    shipment({ order_id: 1, sent_at: iso(now - 3 * DAY) }),
    shipment({ order_id: 2, sent_at: iso(now - 5 * DAY) }),
    shipment({ order_id: 3, sent_at: null }),
    shipment({ order_id: 4, sent_at: iso(now - 90 * DAY) }),
    shipment({ order_id: 5, sent_at: iso(now - 5 * DAY) }),
    shipment({ order_id: 6, sent_at: iso(now - 5 * DAY) }),
    shipment({ order_id: 7, sent_at: iso(now - 5 * DAY) }),
    shipment({ order_id: 8, sent_at: iso(now - 12 * DAY) }),
    shipment({ order_id: 9, sent_at: iso(now - DAY), mode: "hand" }),
  ];
  const invites = [
    invite({ id: 6, order_id: 6, used_at: iso(now - DAY) }),
    invite({ id: 8, order_id: 8, email: "h@example.com", sent_at: iso(now - 2 * DAY) }),
  ];
  const got = askableOrders(orders, shipments, invites, [{ order_id: 5 }], now);
  assert.deepEqual(
    got.map((a) => [a.order.id, a.invite?.id ?? null, a.autoEmailOn, a.inPerson]),
    [
      [9, null, null, true],
      [1, null, iso(now + 7 * DAY), false],
      [2, null, null, false],
      [8, 8, null, false],
    ]
  );
});

const form = {
  source: "discogs",
  sourceUrl: "https://www.discogs.com/seller/x/reviews",
  reviewerName: " vinylfan ",
  rating: "5",
  body: " Fast shipping, accurate grading. ",
  reviewedOn: "2026-09-12",
};

test("imported review: trimmed, optional stars and link, no future dates", () => {
  assert.deepEqual(parseImportedReview(form, "2026-11-01"), {
    ok: true,
    row: {
      source: "discogs",
      source_url: "https://www.discogs.com/seller/x/reviews",
      reviewer_name: "vinylfan",
      rating: 5,
      body: "Fast shipping, accurate grading.",
      reviewed_on: "2026-09-12",
    },
  });
  const plain = parseImportedReview({ ...form, rating: "", sourceUrl: "", reviewedOn: "" }, "2026-11-01");
  assert.ok(plain.ok);
  if (plain.ok) {
    assert.equal(plain.row.rating, null);
    assert.equal(plain.row.source_url, null);
    assert.equal(plain.row.reviewed_on, "2026-11-01");
  }
  assert.equal(parseImportedReview({ ...form, source: "site" }, "2026-11-01").ok, false);
  assert.equal(parseImportedReview({ ...form, rating: "6" }, "2026-11-01").ok, false);
  assert.equal(parseImportedReview({ ...form, body: " " }, "2026-11-01").ok, false);
  assert.equal(parseImportedReview({ ...form, sourceUrl: "javascript:alert(1)" }, "2026-11-01").ok, false);
  assert.equal(parseImportedReview({ ...form, reviewedOn: "2026-12-01" }, "2026-11-01").ok, false);
});

test("review link: made once, then reused", async () => {
  const { client, db } = fakeSupabase({ review_invites: [] });
  const first = await ensureReviewInvite(client, 7);
  const again = await ensureReviewInvite(client, 7);
  assert.equal(first.id, again.id);
  assert.equal(db.tables.review_invites.length, 1);
});

test("review writes: publish, feature, import as published", async () => {
  const { client, db } = fakeSupabase({
    shop_reviews: [{ id: 3, status: "pending", featured: false, reviewer_name: "Sam" }],
  });
  const saved = await updateReview(client, 3, { status: "published", featured: true });
  assert.equal(saved.status, "published");
  assert.equal(db.tables.shop_reviews[0].featured, true);
  const parsed = parseImportedReview(form, "2026-11-01");
  assert.ok(parsed.ok);
  if (parsed.ok) {
    const imported = await addImportedReview(client, parsed.row);
    assert.equal(imported.status, "published");
    assert.equal(db.tables.shop_reviews.length, 2);
  }
  await assert.rejects(updateReview(client, 99, { status: "hidden" }));
});

test("records by order: grouped, sorted by artist then title, loose records skipped", () => {
  const map = recordsByOrder([
    rec({ id: 1, order_id: 7, artist: "Neu!", title: "Neu! 2" }),
    rec({ id: 2, order_id: 7, artist: "Can", title: "Tago Mago" }),
    rec({ id: 3, order_id: 7, artist: "Can", title: "Ege Bamyasi" }),
    rec({ id: 4, order_id: null }),
  ]);
  assert.deepEqual(map.get(7)?.map((r) => r.id), [3, 2, 1]);
  assert.equal(map.size, 1);
});

test("combined orders are one row: last box out, any order's link or review counts", () => {
  const orders = [
    order({ id: 27, status: "paid", buyer_username: "Danny Ross", buyer_email: "d@example.com" }),
    order({ id: 29, status: "paid", buyer_username: "Danny", buyer_email: "d@example.com", combined_into: 27 }),
    order({ id: 30, status: "paid" }),
  ];
  const shipments = [
    shipment({ order_id: 27, sent_at: iso(now - 9 * DAY) }),
    shipment({ order_id: 29, sent_at: iso(now - 7 * DAY) }),
    shipment({ order_id: 30, sent_at: iso(now - 8 * DAY) }),
  ];
  const got = askableOrders(orders, shipments, [], [], now);
  assert.deepEqual(got.map((a) => a.order.id), [27, 30]);
  assert.deepEqual(got[0].members.map((o) => o.id), [27, 29]);
  assert.equal(got[0].lastSent, iso(now - 7 * DAY));
  assert.equal(got[0].autoEmailOn, iso(now + 3 * DAY), "ten days after the sale's last box");
  assert.deepEqual(got[1].members.map((o) => o.id), [30]);

  // A link copied for the second order is the sale's link.
  const copied = invite({ id: 5, order_id: 29 });
  const asked = askableOrders(orders, shipments, [copied], [], now);
  assert.equal(asked[0].invite, copied);
  assert.equal(asked[0].autoEmailOn, null);

  // Reviewed (or the link used) on either order: the sale is done.
  assert.deepEqual(askableOrders(orders, shipments, [], [{ order_id: 29 }], now).map((a) => a.order.id), [30]);
  assert.deepEqual(
    askableOrders(orders, shipments, [invite({ order_id: 29, used_at: iso(now) })], [], now).map((a) => a.order.id),
    [30]
  );

  // One of its boxes still home: nothing to ask yet.
  const waiting = [...shipments.slice(0, 1), shipment({ order_id: 29, sent_at: null }), shipments[2]];
  assert.deepEqual(askableOrders(orders, waiting, [], [], now).map((a) => a.order.id), [30]);
});

test("a combined sale's orders each list the whole sale's records", () => {
  const records = [
    rec({ id: 1, artist: "Natalie Merchant", title: "Tigerlily", order_id: 27 }),
    rec({ id: 2, artist: "Helmet", title: "Betty", order_id: 29 }),
    rec({ id: 3, artist: "Wire", title: "154", order_id: 30 }),
  ];
  const orders = [{ id: 27, combined_into: null }, { id: 29, combined_into: 27 }, { id: 30, combined_into: null }];
  const bought = recordsBySale(records, orders);
  assert.deepEqual(bought.get(27)!.map((r) => r.id), [2, 1]);
  assert.deepEqual(bought.get(29)!.map((r) => r.id), [2, 1]);
  assert.deepEqual(bought.get(30)!.map((r) => r.id), [3]);
});
