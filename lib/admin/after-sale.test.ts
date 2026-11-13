// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSaleChecklist, openAfterSale } from "./after-sale.ts";
import { groupOrders } from "./fulfillment.ts";
import { DAY, gear, iso, order, rec, shipment } from "./fixtures.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const SENT = iso(NOW - 2 * DAY);

const shipped = (
  o: ReturnType<typeof order>,
  records: ReturnType<typeof rec>[],
  sentAt: string = SENT
) =>
  groupOrders(
    records,
    [
      shipment({
        order_id: o.id,
        record_ids: records.map((r) => r.id),
        tracking_code: "9400",
        status: "shipped",
        sent_at: sentAt,
      }),
    ],
    [o]
  )[0];

const none = { invites: [], reviews: [] };
const states = (items: ReturnType<typeof afterSaleChecklist>) =>
  Object.fromEntries(items.map((i) => [i.key, i.state]));

test("a Reddit buyer: review to ask, records to take off Discogs, trade to confirm", () => {
  const o = order({ id: 1, status: "paid", buyer_username: "amy", completed_at: null });
  const g = shipped(o, [
    rec({ id: 1, sold: true, order_id: 1, discogs_release_id: 111 }),
    rec({ id: 2, sold: true, order_id: 1, discogs_release_id: 222, discogs_removed: true }),
  ]);
  const items = afterSaleChecklist(g, none, NOW);
  assert.deepEqual(states(items), { review: "todo", discogs: "todo", reddit: "manual" });
  assert.equal(items.find((i) => i.key === "discogs")!.detail, "1 still in your collection");
  assert.deepEqual(
    openAfterSale(items).map((i) => i.key),
    ["review", "discogs"],
    "the Reddit comment can't be seen from here, so it never blocks"
  );
});

test("an email buyer: the review email sends itself, and there's no Reddit step", () => {
  const o = order({ id: 1, status: "paid", buyer_username: "Amy", buyer_email: "amy@example.com", completed_at: null });
  const g = shipped(o, [rec({ id: 1, sold: true, order_id: 1 })]);
  const items = afterSaleChecklist(g, none, NOW);
  assert.deepEqual(states(items), { review: "scheduled" });
  assert.equal(items[0].detail, "emails itself Nov 20", "ten days after the box left");
  assert.deepEqual(openAfterSale(items), []);

  // Past the daily job's window with no invite: it never went.
  const late = shipped(o, [rec({ id: 1, sold: true, order_id: 1 })], iso(NOW - 40 * DAY));
  assert.equal(afterSaleChecklist(late, none, NOW)[0].state, "todo");
});

test("asked already: an emailed or copied link, or the review itself", () => {
  const o = order({ id: 1, status: "paid", buyer_username: "amy", completed_at: null });
  const g = shipped(o, [rec({ id: 1, sold: true, order_id: 1 })]);
  const invite = { order_id: 1, sent_at: null, used_at: null, created_at: "2026-11-11T09:00:00Z" };
  const review = (ctx: Parameters<typeof afterSaleChecklist>[1]) =>
    afterSaleChecklist(g, ctx, NOW).find((i) => i.key === "review")!;

  assert.deepEqual(
    [review({ invites: [invite], reviews: [] }).state, review({ invites: [invite], reviews: [] }).detail],
    ["done", "link copied Nov 11"]
  );
  assert.equal(
    review({ invites: [{ ...invite, sent_at: "2026-11-12T09:00:00Z" }], reviews: [] }).detail,
    "emailed Nov 12"
  );
  assert.equal(review({ invites: [], reviews: [{ order_id: 1 }] }).detail, "review received");
  assert.equal(
    review({ invites: [{ ...invite, order_id: 2 }], reviews: [{ order_id: 2 }] }).state,
    "todo",
    "another order's invite and review don't count"
  );
});

test("Discogs only for records that came from it; all gone reads as done", () => {
  const o = order({ id: 1, status: "paid", buyer_email: "amy@example.com", completed_at: null });
  const noDiscogs = shipped(o, [rec({ id: 1, sold: true, order_id: 1 }), gear({ id: 2, sold: true, order_id: 1 })]);
  assert.equal(afterSaleChecklist(noDiscogs, none, NOW).some((i) => i.key === "discogs"), false);

  const removed = shipped(o, [
    rec({ id: 1, sold: true, order_id: 1, discogs_release_id: 111, discogs_removed: true }),
    rec({ id: 2, sold: true, order_id: 1, discogs_release_id: 222, discogs_removed: true }),
  ]);
  const item = afterSaleChecklist(removed, none, NOW).find((i) => i.key === "discogs")!;
  assert.deepEqual([item.state, item.detail], ["done", "all 2 out of your collection"]);
});

test("marking the order done ticks the Reddit confirmation", () => {
  const o = order({ id: 1, status: "paid", buyer_username: "amy", completed_at: iso(NOW) });
  const g = shipped(o, [rec({ id: 1, sold: true, order_id: 1 })]);
  assert.equal(states(afterSaleChecklist(g, none, NOW)).reddit, "done");
});

test("a sale from before the orders table has no review to ask for", () => {
  const records = [rec({ id: 1, sold: true, buyer_username: "amy" })];
  const g = groupOrders(
    records,
    [shipment({ record_ids: [1], buyer_username: "amy", tracking_code: "9400", sent_at: SENT })],
    []
  )[0];
  assert.deepEqual(Object.keys(states(afterSaleChecklist(g, none, NOW))), ["reddit"]);
});
