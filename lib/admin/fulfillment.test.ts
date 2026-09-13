// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWAP_BOT,
  buyerNudge,
  confirmationComment,
  groupOrdersByBuyer,
  inPayPal,
  needsRepush,
  pushNotNeeded,
} from "./fulfillment.ts";
import { rec, shipment } from "./fixtures.ts";

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

test("orders group per buyer, case-insensitively, open before done", () => {
  const records = [
    rec({ id: 1, buyer_username: "Zed", paypal_invoice_id: "INV-1" }),
    rec({ id: 2, buyer_username: "zed ", paypal_invoice_id: "INV-1" }),
    rec({ id: 3, buyer_username: "amy", paypal_invoice_id: "INV-2" }),
    rec({ id: 4, buyer_username: "amy", paypal_invoice_id: "INV-3" }),
    rec({ id: 5, buyer_username: "" }),
    rec({ id: 6, buyer_username: "bob" }),
  ];
  const shipments = [
    shipment({ id: 10, buyer_username: "ZED", record_ids: [1, 2], tracking_code: "9400", updated_at: "2026-09-12T00:00:00Z" }),
    shipment({ id: 11, buyer_username: "amy", record_ids: [3], tracking_code: "9401", updated_at: "2026-09-11T00:00:00Z" }),
    shipment({ id: 12, buyer_username: "amy", record_ids: [4], status: "refunded", tracking_code: "x" }),
    shipment({ id: 13, buyer_username: "bob", record_ids: [6], tracking_code: null, created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" }),
  ];
  const groups = groupOrdersByBuyer(records, shipments);
  assert.deepEqual(
    groups.map((g) => [g.key, g.buyer, g.records.length, g.unassigned.map((r) => r.id), g.invoiceId, g.done]),
    [
      ["(no buyer)", "", 1, [5], "", false],
      ["amy", "amy", 2, [4], "", false],
      ["bob", "bob", 1, [], "", false],
      ["zed", "Zed", 2, [], "INV-1", true],
    ]
  );
  const amy = groups[1];
  assert.deepEqual(amy.shipments.map((s) => s.id), [11], "refunded parcels are ignored");
  assert.equal(amy.invoiceId, "", "two invoices — no single id to sync");
  assert.equal(groups[3].lastActivity, Date.parse("2026-09-12T00:00:00Z"));
  assert.equal(groups[2].lastActivity, Date.parse("2026-09-10T00:00:00Z"), "updated_at over created_at");
  assert.equal(groups[0].lastActivity, 0, "no parcels yet");
});

test("a group is done only when every record is in a tracked parcel", () => {
  const records = [rec({ id: 1, buyer_username: "b" }), rec({ id: 2, buyer_username: "b" })];
  const all = shipment({ buyer_username: "b", record_ids: [1, 2], tracking_code: "1" });
  assert.equal(groupOrdersByBuyer(records, [all])[0].done, true);
  assert.equal(groupOrdersByBuyer(records, [{ ...all, tracking_code: null }])[0].done, false);
  assert.equal(groupOrdersByBuyer(records, [{ ...all, record_ids: [1] }])[0].done, false);
  assert.equal(groupOrdersByBuyer([], [all])[0].done, false, "a parcel with no records is not an order");
});
