// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  carrierWords,
  deliveryBadge,
  deliveryStatus,
  reviewDmDue,
  reviewNote,
} from "./delivery-status.ts";
import type { AfterSaleItem } from "./after-sale.ts";

const sent = "2026-11-23T18:00:00Z";
const checked = "2026-11-28T11:07:52Z";
const box = (over: Record<string, unknown> = {}) => ({
  sent_at: sent,
  mode: "paypal",
  delivered_at: null,
  tracking_status: null,
  tracking_detail: null,
  tracking_checked_at: null,
  ...over,
});

test("carrier words: USPS's sentence, tidied, with the place", () => {
  assert.equal(
    carrierWords("Your shipment has been delivered at the front door. — Olympia, WA"),
    "at the front door, Olympia, WA"
  );
  assert.equal(
    carrierWords("Your shipment has arrived at the USPS facility. — Palmetto, FL"),
    "arrived at the USPS facility, Palmetto, FL"
  );
  assert.equal(carrierWords("Delivered, Front Door/Porch — OLYMPIA, WA"), "Front Door/Porch, OLYMPIA, WA");
  assert.equal(carrierWords("In Transit"), "In Transit");
  assert.equal(carrierWords(null), null);
});

test("no status until tracking has looked; hand-overs never count", () => {
  assert.equal(deliveryStatus([box()]), null);
  assert.equal(deliveryStatus([box({ mode: "hand", tracking_checked_at: checked })]), null);
  assert.equal(deliveryStatus([]), null);
});

test("delivered: every mailed box, dated by the last one", () => {
  const s = deliveryStatus([
    box({
      delivered_at: "2026-11-28T00:49:36Z",
      tracking_status: "DELIVERED",
      tracking_detail: "Your shipment has been delivered at the front door. — Olympia, WA",
      tracking_checked_at: checked,
    }),
  ])!;
  assert.deepEqual(s, {
    kind: "delivered",
    at: "2026-11-28T00:49:36Z",
    where: "at the front door, Olympia, WA",
    delivered: 1,
    total: 1,
  });
  assert.equal(deliveryBadge(s), "Delivered Nov 27", "4:49 pm Pacific is still Nov 27 in Arizona");
});

test("in transit, part-delivered, returning, problem", () => {
  const moving = deliveryStatus([
    box({
      tracking_status: "TRANSIT",
      tracking_detail: "Your shipment has arrived at the USPS facility. — Palmetto, FL",
      tracking_checked_at: checked,
    }),
  ])!;
  assert.equal(moving.kind, "transit");
  assert.equal(moving.where, "arrived at the USPS facility, Palmetto, FL");
  assert.equal(deliveryBadge(moving), "In transit");

  const half = deliveryStatus([
    box({ delivered_at: "2026-11-27T20:00:00Z", tracking_checked_at: checked }),
    box({ tracking_status: "TRANSIT", tracking_checked_at: checked }),
  ])!;
  assert.equal(deliveryBadge(half), "1 of 2 delivered");

  const back = deliveryStatus([box({ tracking_status: "RETURNED", tracking_checked_at: checked })])!;
  assert.equal(deliveryBadge(back), "Returning to you");
  const lost = deliveryStatus([
    box({ tracking_status: "TRANSIT", tracking_checked_at: checked }),
    box({ tracking_status: "FAILURE", tracking_checked_at: checked }),
  ])!;
  assert.equal(lost.kind, "problem", "the worst box decides");
});

const item = (state: AfterSaleItem["state"], detail: string): AfterSaleItem => ({
  key: "review",
  label: "Review asked",
  state,
  detail,
});

test("the banner's review words, and when the Reddit DM is due", () => {
  const delivered = deliveryStatus([box({ delivered_at: "2026-11-27T20:00:00Z", tracking_checked_at: checked })])!;
  const moving = deliveryStatus([box({ tracking_status: "TRANSIT", tracking_checked_at: checked })])!;

  assert.equal(reviewNote(item("scheduled", "delivered Nov 27 · emails itself Dec 1"), delivered), "review email goes Dec 1");
  assert.equal(
    reviewNote(item("scheduled", "emails itself by Dec 3 — 3 days after delivery if sooner"), moving),
    "review email goes by Dec 3"
  );
  assert.equal(reviewNote(item("done", "emailed Nov 20"), delivered), "review emailed Nov 20");
  assert.equal(reviewNote(item("done", "review received"), delivered), "review received");

  const dm = item("todo", "delivered Nov 27 — copy a review DM");
  assert.equal(reviewNote(dm, delivered), "your move: send the review DM");
  assert.ok(reviewDmDue(dm, delivered));
  assert.equal(reviewNote(item("todo", "copy a review DM"), moving), null, "not yet: it's still moving");
  assert.ok(!reviewDmDue(item("todo", "copy a review DM"), moving));
  assert.ok(!reviewDmDue(item("done", "link copied Nov 28"), delivered));
  assert.equal(reviewNote(undefined, delivered), null);
});
