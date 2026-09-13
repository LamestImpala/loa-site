// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWAP_BOT,
  buyerNudge,
  confirmationComment,
  groupOrders,
  inPayPal,
  needsRepush,
  pushNotNeeded,
} from "./fulfillment.ts";
import { order, rec, shipment } from "./fixtures.ts";

test("PayPal tracker state per parcel", () => {
  const synced = shipment({ paypal_tracker_id: "T-1", tracking_code: "9400", paypal_tracked_number: "9400" });
  const changed = shipment({ paypal_tracker_id: "T-1", tracking_code: "9401", paypal_tracked_number: "9400" });
  const never = shipment({ tracking_code: "9400" });
  const paypalLabel = shipment({ mode: "paypal", tracking_code: "9400" });
  const paypalKnown = shipment({ mode: "paypal", paypal_tracker_id: "T-1", tracking_code: "9401", paypal_tracked_number: "9400" });
  const noTracking = shipment({ paypal_tracker_id: "T-1", paypal_tracked_number: "9400" });

  assert.deepEqual([inPayPal(synced), needsRepush(synced), pushNotNeeded(synced)], [true, false, false]);
  assert.deepEqual([inPayPal(changed), needsRepush(changed), pushNotNeeded(changed)], [false, true, false]);
  assert.deepEqual([inPayPal(never), needsRepush(never), pushNotNeeded(never)], [false, false, false]);
  assert.deepEqual([inPayPal(paypalLabel), needsRepush(paypalLabel), pushNotNeeded(paypalLabel)], [false, false, true]);
  assert.deepEqual([inPayPal(paypalKnown), needsRepush(paypalKnown), pushNotNeeded(paypalKnown)], [false, true, false], "known parcels keep re-push");
  assert.deepEqual([inPayPal(noTracking), needsRepush(noTracking)], [false, false]);
});

test("trade confirmation: plain-text bot mention first, records alphabetical", () => {
  const text = confirmationComment("amy", [
    rec({ artist: "Zappa", title: "Hot Rats" }),
    rec({ artist: "Beatles", title: "Revolver" }),
  ]);
  const lines = text.split("\n");
  assert.equal(lines[0], SWAP_BOT);
  assert.equal(lines[2], "Confirming my sale to u/amy:");
  assert.deepEqual(lines.slice(4, 6), ["- Beatles — Revolver", "- Zappa — Hot Rats"]);
  assert.ok(lines.at(-1)!.includes("reply to this comment"));
  assert.ok(!text.includes("[u/"), "no hyperlinked mentions — the bot can't see them");
});

test("buyer nudge points at the thread when there is one", () => {
  assert.ok(buyerNudge("amy", "https://reddit.com/t").includes("here: https://reddit.com/t"));
  assert.ok(buyerNudge("amy", "").includes("on the r/VinylCollectors post the sale came from"));
  assert.ok(buyerNudge("amy", "").startsWith("Hey u/amy"));
});

test("orders group by order id; orderless rows fall back to the buyer name", () => {
  const orders = [
    order({ id: 1, buyer_username: "Zed", status: "paid", paypal_invoice_id: "INV-1" }),
    order({ id: 2, buyer_username: "amy", status: "paid", paypal_invoice_id: "INV-2" }),
    order({ id: 3, buyer_username: "amy", status: "paid", paypal_invoice_id: "INV-3" }),
  ];
  const records = [
    rec({ id: 1, buyer_username: "zed", order_id: 1 }),
    rec({ id: 2, buyer_username: "Zed ", order_id: 1 }),
    rec({ id: 3, buyer_username: "amy", order_id: 2 }),
    rec({ id: 4, buyer_username: "amy", order_id: 3 }),
    rec({ id: 5, buyer_username: "" }),
    rec({ id: 6, buyer_username: "Bob", paypal_invoice_id: "INV-6" }),
    rec({ id: 7, buyer_username: "bob", paypal_invoice_id: "INV-7" }),
  ];
  const shipments = [
    shipment({ id: 10, buyer_username: "ZED", order_id: 1, record_ids: [1, 2], tracking_code: "9400", updated_at: "2026-09-12T00:00:00Z" }),
    shipment({ id: 11, buyer_username: "amy", order_id: 2, record_ids: [3], tracking_code: "9401", updated_at: "2026-09-11T00:00:00Z" }),
    shipment({ id: 12, buyer_username: "amy", order_id: 3, record_ids: [4], status: "refunded", tracking_code: "x" }),
    shipment({ id: 13, buyer_username: "bob", record_ids: [6], tracking_code: null, created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" }),
  ];
  const groups = groupOrders(records, shipments, orders);
  assert.deepEqual(
    groups.map((g) => [g.key, g.buyer, g.records.map((r) => r.id), g.unassigned.map((r) => r.id), g.invoiceId, g.done]),
    [
      ["buyer-(no buyer)", "", [5], [5], "", false],
      ["order-3", "amy", [4], [4], "INV-3", false],
      ["buyer-bob", "Bob", [6, 7], [7], "", false],
      ["order-2", "amy", [3], [], "INV-2", true],
      ["order-1", "Zed", [1, 2], [], "INV-1", true],
    ],
    "two orders to one buyer stay apart; the buyer name comes from the order"
  );
  assert.deepEqual(groups[1].shipments, [], "refunded parcels are ignored");
  assert.equal(groups[2].invoiceId, "", "orderless group with two invoices — no single id to sync");
  assert.equal(groups[4].lastActivity, Date.parse("2026-09-12T00:00:00Z"));
  assert.equal(groups[2].lastActivity, Date.parse("2026-09-10T00:00:00Z"), "updated_at over created_at");
  assert.equal(groups[0].lastActivity, 0, "no parcels yet");
});

test("a group is done only when every record is in a tracked parcel", () => {
  const o = order({ id: 1, buyer_username: "b", status: "paid" });
  const records = [rec({ id: 1, order_id: 1 }), rec({ id: 2, order_id: 1 })];
  const all = shipment({ order_id: 1, record_ids: [1, 2], tracking_code: "1" });
  assert.equal(groupOrders(records, [all], [o])[0].done, true);
  assert.equal(groupOrders(records, [{ ...all, tracking_code: null }], [o])[0].done, false);
  assert.equal(groupOrders(records, [{ ...all, record_ids: [1] }], [o])[0].done, false);
  assert.equal(groupOrders([], [all], [o])[0].done, false, "a parcel with no records is not an order");
});
