// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { DAY, iso, order, shipment } from "./fixtures.ts";
import { askableOrders, parseImportedReview } from "./reviews.ts";
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
  ];
  const invites = [
    invite({ id: 6, order_id: 6, used_at: iso(now - DAY) }),
    invite({ id: 8, order_id: 8, email: "h@example.com", sent_at: iso(now - 2 * DAY) }),
  ];
  const got = askableOrders(orders, shipments, invites, [{ order_id: 5 }], now);
  assert.deepEqual(
    got.map((a) => [a.order.id, a.invite?.id ?? null, a.autoEmailOn]),
    [
      [1, null, iso(now + 7 * DAY)],
      [2, null, null],
      [8, 8, null],
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
