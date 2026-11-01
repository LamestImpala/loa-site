// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminReviewNotificationEmail,
  boughtPhrase,
  buyerFirstName,
  ordersToInvite,
  parseReviewBody,
  publishedReviewUrl,
  ratingLine,
  reviewMonth,
  reviewDmText,
  reviewRequestEmail,
  stars,
  toReviewQuotes,
  toReviewSummary,
} from "./review.ts";

const token = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const good = { token, rating: 5, body: "  Spot-on grading, packed like a bank vault. ", name: " Sam K. " };

test("review body: trimmed, token lowercased", () => {
  const r = parseReviewBody({ ...good, token: token.toUpperCase() });
  assert.ok(r.ok && "review" in r);
  if (r.ok && "review" in r) {
    assert.deepEqual(r.review, {
      token,
      rating: 5,
      body: "Spot-on grading, packed like a bank vault.",
      name: "Sam K.",
    });
  }
});

test("review body: rejects bad tokens, ratings, empty text; honeypot short-circuits", () => {
  assert.equal(parseReviewBody(null).ok, false);
  assert.equal(parseReviewBody({ ...good, token: "nope" }).ok, false);
  assert.equal(parseReviewBody({ ...good, rating: 0 }).ok, false);
  assert.equal(parseReviewBody({ ...good, rating: 6 }).ok, false);
  assert.equal(parseReviewBody({ ...good, rating: 4.5 }).ok, false);
  assert.equal(parseReviewBody({ ...good, rating: "5" }).ok, false);
  assert.equal(parseReviewBody({ ...good, body: "   " }).ok, false);
  assert.equal(parseReviewBody({ ...good, name: "" }).ok, false);
  const bot = parseReviewBody({ ...good, website: "http://spam" });
  assert.ok(bot.ok && "honeypot" in bot);
});

test("review body: text and name are capped", () => {
  const r = parseReviewBody({ ...good, body: "x".repeat(2000), name: "y".repeat(100) });
  assert.ok(r.ok && "review" in r);
  if (r.ok && "review" in r) {
    assert.equal(r.review.body.length, 1200);
    assert.equal(r.review.name.length, 60);
  }
});

const now = new Date("2026-11-20T15:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

test("orders to invite: paid, emailed buyer, box out 10-30 days, not yet invited", () => {
  const orders = [
    { id: 1, status: "paid" as const, buyer_email: "A@Example.com" }, // due
    { id: 2, status: "paid" as const, buyer_email: null }, // Reddit buyer: no email
    { id: 3, status: "paid" as const, buyer_email: "c@example.com" }, // too recent
    { id: 4, status: "paid" as const, buyer_email: "d@example.com" }, // too old
    { id: 5, status: "paid" as const, buyer_email: "e@example.com" }, // already invited
    { id: 6, status: "refunded" as const, buyer_email: "f@example.com" }, // refunded
    { id: 7, status: "paid" as const, buyer_email: "g@example.com" }, // second box still home
    { id: 8, status: "paid" as const, buyer_email: "h@example.com" }, // nothing shipped
  ];
  const shipments = [
    { order_id: 1, sent_at: daysAgo(12) },
    { order_id: 2, sent_at: daysAgo(12) },
    { order_id: 3, sent_at: daysAgo(4) },
    { order_id: 4, sent_at: daysAgo(45) },
    { order_id: 5, sent_at: daysAgo(12) },
    { order_id: 6, sent_at: daysAgo(12) },
    { order_id: 7, sent_at: daysAgo(15) },
    { order_id: 7, sent_at: null },
    { order_id: null, sent_at: daysAgo(12) },
  ];
  const invites = [{ order_id: 5 }];
  assert.deepEqual(ordersToInvite(orders, shipments, invites, now), [
    { orderId: 1, email: "a@example.com" },
  ]);
});

test("orders to invite: the last box out sets the clock", () => {
  const orders = [{ id: 1, status: "paid" as const, buyer_email: "a@example.com" }];
  const shipments = [
    { order_id: 1, sent_at: daysAgo(20) },
    { order_id: 1, sent_at: daysAgo(5) },
  ];
  assert.deepEqual(ordersToInvite(orders, shipments, [], now), []);
});

test("review request email: greets by first name, carries the link, replies to orders@", () => {
  const url = `https://curiouserrecords.com/review/${token}`;
  const m = reviewRequestEmail({ to: "a@example.com", firstName: "Jane", url });
  assert.equal(m.to, "a@example.com");
  assert.equal(m.replyTo, "orders@curiouserrecords.com");
  assert.match(m.text, /^Hi Jane,/);
  assert.ok(m.text.includes(url));
  assert.ok(m.html.includes(`href="${url}"`));
  assert.match(reviewRequestEmail({ to: "a@example.com", firstName: null, url }).text, /^Hi,/);
});

test("admin review notification: stars, text, escaped html, link to the admin", () => {
  const m = adminReviewNotificationEmail({ rating: 4, body: "Great <b>shop</b>", name: "Sam" });
  assert.equal(m.to, "brandoncgillihan@gmail.com");
  assert.equal(m.subject, "New 4-star review from Sam");
  assert.match(m.text, /★★★★☆/);
  assert.match(m.text, /admin#reviews/);
  assert.ok(m.html.includes("Great &lt;b&gt;shop&lt;/b&gt;"));
});

test("stars clamps and rounds", () => {
  assert.equal(stars(5), "★★★★★");
  assert.equal(stars(3.6), "★★★★☆");
  assert.equal(stars(9), "★★★★★");
});

test("review summary: nothing published is null; average over rated reviews", () => {
  assert.equal(toReviewSummary(null), null);
  assert.equal(toReviewSummary({ count: 0, rated_count: 0, average: null, quotes: [] }), null);
  const s = toReviewSummary({
    count: 3,
    rated_count: 2,
    average: "4.5",
    quotes: [
      { id: 7, reviewer_name: "Sam", rating: 5, body: "Great", source: "discogs", reviewed_on: "2026-10-02", owner_reply: null },
    ],
  });
  assert.ok(s);
  assert.equal(s.average, 4.5);
  assert.equal(s.quotes[0].reviewerName, "Sam");
  assert.equal(s.quotes[0].source, "discogs");
  assert.equal(ratingLine(s), "4.5 out of 5 from 2 reviews");
  assert.equal(ratingLine({ ...s, ratedCount: 1, average: 5 }), "5.0 out of 5 from 1 review");
  assert.equal(ratingLine({ ...s, ratedCount: 0, average: null }), "3 reviews");
});

test("published reviews list: typed, empty on a failed call", () => {
  assert.deepEqual(toReviewQuotes(null), []);
  assert.deepEqual(toReviewQuotes({ error: "x" }), []);
  const list = toReviewQuotes([
    { id: 9, reviewer_name: "Ana", rating: null, body: "Packed well", source: "reddit", reviewed_on: "2026-10-30", owner_reply: "Thanks!" },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].rating, null);
  assert.equal(list[0].ownerReply, "Thanks!");
  assert.equal(publishedReviewUrl(9), "https://curiouserrecords.com/reviews#review-9");
});

test("review month", () => {
  assert.equal(reviewMonth("2026-10-02"), "Oct 2026");
  assert.equal(reviewMonth("garbage"), "");
});

test("buyer first name: PayPal ship-to name, else an email buyer's typed name, never a handle", () => {
  const base = { ship_to: null, buyer_email: null, buyer_username: "vinyl_dude" };
  assert.equal(buyerFirstName(base), null);
  assert.equal(buyerFirstName({ ...base, buyer_email: "j@x.co", buyer_username: "Jane Doe" }), "Jane");
  const shipTo = { name: " Sam  Kim ", line1: null, line2: null, city: null, state: null, postal_code: null, country_code: null };
  assert.equal(buyerFirstName({ ...base, ship_to: shipTo }), "Sam");
  assert.equal(buyerFirstName({ ...base, ship_to: { ...shipTo, name: "Neal, Hallett" } }), "Neal");
  assert.equal(buyerFirstName({ ...base, ship_to: { ...shipTo, name: "Jean-Luc O'Neil" } }), "Jean-Luc");
  assert.equal(buyerFirstName({ ...base, ship_to: { ...shipTo, name: ", ." } }), null);
});

const pj = { artist: "Pearl Jam", title: "Benaroya Hall" };
const ts = { artist: "Taylor Swift", title: "Lover" };

test("bought phrase: one by name, two joined, more counted", () => {
  assert.equal(boughtPhrase([pj]), "Pearl Jam – Benaroya Hall");
  assert.equal(boughtPhrase([pj, ts]), "Pearl Jam – Benaroya Hall and Taylor Swift – Lover");
  assert.equal(boughtPhrase([pj, ts, pj]), "your 3 records");
  assert.equal(boughtPhrase([ts, ts, ts]), "your 3 Taylor Swift records");
  const poster = { artist: "Pearl Jam", title: "Wrigley", kind: "poster" as const };
  assert.equal(boughtPhrase([pj, ts, poster]), "your 3 items");
  assert.equal(boughtPhrase([poster, poster, poster]), "your 3 Pearl Jam posters");
  assert.equal(boughtPhrase([]), "your records");
});

test("review DM: first name, the record, the link, and an out", () => {
  const url = `https://curiouserrecords.com/review/${token}`;
  const one = reviewDmText({ firstName: "Nicholas", records: [pj], url });
  assert.match(one, /^Hey Nicholas, hope Pearl Jam – Benaroya Hall arrived safely and sounds great!/);
  assert.ok(one.includes(`\n\n${url}\n\n`));
  assert.match(one, /reply here and I'll make it right/);
  const many = reviewDmText({ firstName: null, records: [pj, ts, pj], url });
  assert.match(many, /^Hey there, hope your 3 records arrived safely and sound great!/);
});
