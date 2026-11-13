// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWAP_BOT,
  buyerNudge,
  byLongestWaiting,
  confirmationComment,
  discogsReady,
  groupOrders,
  handDelivered,
  inPayPal,
  needsLabel,
  needsRepush,
  nextJob,
  orderGone,
  orderPhase,
  orderStage,
  orderTimeline,
  pushNotNeeded,
  refundedOrders,
} from "./fulfillment.ts";
import { DAY, invoice, iso, order, rec, shipment } from "./fixtures.ts";

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

test("an order's stage is the first job still open on it", () => {
  const o = order({ id: 1, status: "paid", paypal_invoice_id: "INV-1" });
  const records = [rec({ id: 1, sold: true, order_id: 1 }), rec({ id: 2, sold: true, order_id: 1 })];
  const stage = (shipments: ReturnType<typeof shipment>[], inv = invoice()) =>
    orderStage(groupOrders(records, shipments, [o])[0], inv);
  const box = { order_id: 1, record_ids: [1, 2], paypal_invoice_id: "INV-1" };

  assert.equal(stage([]), "pack");
  assert.equal(stage([shipment({ ...box, record_ids: [1], tracking_code: "9400" })]), "pack");
  assert.equal(stage([shipment({ ...box, tracking_code: null })]), "label");
  assert.equal(stage([shipment({ ...box, tracking_code: "9400", mode: "manual" })]), "push");
  assert.equal(
    stage([shipment({ ...box, tracking_code: "9400", mode: "paypal" })]),
    "sync",
    "a PayPal label needs no push; the fee is still missing"
  );
  assert.equal(
    stage([shipment({ ...box, tracking_code: "9400", mode: "paypal" })], invoice({ paypal_fee: 1.84 })),
    "done"
  );
});

test("an order paid outside PayPal is done once it has tracking", () => {
  const o = order({ id: 1, status: "paid" });
  const records = [rec({ id: 1, sold: true, order_id: 1 })];
  const [g] = groupOrders(records, [shipment({ order_id: 1, record_ids: [1], tracking_code: "9400" })], [o]);
  assert.equal(orderStage(g, undefined), "done");
});

test("a cash sale handed over in person is done with no label, and ready for Discogs", () => {
  const o = order({ id: 28, status: "paid" });
  const records = [rec({ id: 1, sold: true, order_id: 28, discogs_release_id: 99 })];
  const box = shipment({ order_id: 28, record_ids: [1], packed_at: "2026-11-11T23:32:39Z" });
  const handed = { ...box, mode: "hand", carrier: "In person", status: "shipped" as const, sent_at: "2026-11-11T23:40:00Z" };
  assert.equal(needsLabel(box), true);
  assert.equal(needsLabel(handed), false);
  assert.equal(handDelivered(handed), true);
  assert.equal(orderStage(groupOrders(records, [box], [o])[0], undefined), "label");
  const [g] = groupOrders(records, [handed], [o]);
  assert.equal(g.done, true);
  assert.equal(orderStage(g, undefined), "done");
  assert.deepEqual(discogsReady(records, [handed], [o]).map((r) => r.id), [1]);
  assert.deepEqual(discogsReady(records, [box], [o]), [], "not before it changes hands");
});

test("the panel lists open orders longest-waiting first, then finished ones newest first", () => {
  const orders = [
    order({ id: 1, buyer_username: "zed", status: "paid", created_at: "2026-09-10T00:00:00Z" }),
    order({ id: 2, buyer_username: "amy", status: "paid", created_at: "2026-09-12T00:00:00Z" }),
    order({ id: 3, buyer_username: "bob", status: "paid", created_at: "2026-09-01T00:00:00Z" }),
    order({ id: 4, buyer_username: "cat", status: "paid", created_at: "2026-09-02T00:00:00Z" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 2 }),
    rec({ id: 3, sold: true, order_id: 3 }),
    rec({ id: 4, sold: true, order_id: 4 }),
    rec({ id: 5, sold: true, buyer_username: "old", sold_at: "2026-08-20T00:00:00Z" }),
  ];
  const shipments = [
    shipment({ order_id: 3, record_ids: [3], tracking_code: "1", updated_at: "2026-09-03T00:00:00Z" }),
    shipment({ order_id: 4, record_ids: [4], tracking_code: "2", updated_at: "2026-09-05T00:00:00Z" }),
  ];
  assert.deepEqual(
    byLongestWaiting(groupOrders(records, shipments, orders)).map((g) => g.key),
    ["buyer-old", "order-1", "order-2", "order-4", "order-3"]
  );
});

test("a refunded order has no group; the panel lists it apart with the records it kept sold", () => {
  const orders = [
    order({ id: 1, buyer_username: "amy", status: "paid", paypal_invoice_id: "INV-1" }),
    order({ id: 2, buyer_username: "bob", status: "refunded", paypal_invoice_id: "INV-2", refunded_amount: 40, refunded_at: "2026-09-18" }),
    order({ id: 3, buyer_username: "cy", status: "refunded", refunded_at: "2026-09-19" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1 }),
    rec({ id: 2, sold: true, order_id: 2, tracking_number: "9400" }), // shipped before the refund
    rec({ id: 3, sold: false, order_id: null }), // relisted by the refund
  ];
  const shipments = [shipment({ order_id: 2, record_ids: [2], tracking_code: "9400", status: "shipped" })];
  assert.deepEqual(groupOrders(records.filter((r) => r.sold), shipments, orders).map((g) => g.key), ["order-1"]);
  assert.deepEqual(
    refundedOrders(orders, records).map((x) => [x.order.id, x.records.map((r) => r.id)]),
    [[3, []], [2, [2]]],
    "newest refund first"
  );
});

test("Discogs removal waits until the whole order is boxed and tracked", () => {
  const orders = [
    order({ id: 1, status: "paid" }),
    order({ id: 2, status: "paid" }),
    order({ id: 3, status: "refunded" }),
  ];
  const records = [
    rec({ id: 1, sold: true, order_id: 1, discogs_release_id: 10 }),
    rec({ id: 2, sold: true, order_id: 1, discogs_release_id: 20, discogs_removed: true }),
    rec({ id: 3, sold: true, order_id: 1, discogs_release_id: null }),
    rec({ id: 4, sold: true, order_id: 2, discogs_release_id: 40 }), // its box is tracked…
    rec({ id: 5, sold: true, order_id: 2, discogs_release_id: 50 }), // …but this one isn't boxed
    rec({ id: 6, sold: true, order_id: 3, discogs_release_id: 60 }), // shipped, then refunded — gone
    rec({ id: 7, sold: false, discogs_release_id: 70 }),
    rec({ id: 8, sold: true, discogs_release_id: 80 }), // paid, nothing shipped yet
  ];
  const shipments = [
    shipment({ order_id: 1, record_ids: [1, 2, 3], tracking_code: "9400" }),
    shipment({ order_id: 2, record_ids: [4], tracking_code: "9401" }),
  ];
  assert.deepEqual(discogsReady(records, shipments, orders).map((r) => r.id), [1, 6]);
});

// One order's group, straight from the tables.
const groupOf = (
  o: ReturnType<typeof order> | null,
  records: ReturnType<typeof rec>[],
  shipments: ReturnType<typeof shipment>[]
) => groupOrders(records, shipments, o ? [o] : [])[0];

const T = Date.parse("2026-11-12T12:00:00Z");
const labeled = (over: Parameters<typeof shipment>[0] = {}) =>
  shipment({ tracking_code: "9400", status: "shipped", mode: "paypal", ...over });

test("gone means every record boxed and every box out of the house", () => {
  const o = order({ id: 1, status: "paid" });
  const recs = [rec({ id: 1, sold: true, order_id: 1 }), rec({ id: 2, sold: true, order_id: 1 })];
  const sent = iso(T - DAY);
  assert.equal(orderGone(groupOf(o, recs, [])), false, "nothing boxed");
  assert.equal(
    orderGone(groupOf(o, recs, [labeled({ order_id: 1, record_ids: [1], sent_at: sent })])),
    false,
    "one record still loose"
  );
  assert.equal(
    orderGone(groupOf(o, recs, [labeled({ order_id: 1, record_ids: [1, 2] })])),
    false,
    "labeled isn't dropped off"
  );
  assert.equal(
    orderGone(groupOf(o, recs, [labeled({ order_id: 1, record_ids: [1, 2], sent_at: sent })])),
    true
  );
  assert.equal(
    orderGone(
      groupOf(o, recs, [
        shipment({ order_id: 1, record_ids: [1, 2], mode: "hand", status: "shipped", sent_at: sent }),
      ])
    ),
    true,
    "handed over in person"
  );
});

test("the next job walks pack, label, push, drop off, sync, finish", () => {
  const o = order({ id: 1, status: "paid", paypal_invoice_id: "INV-1", completed_at: null });
  const recs = [rec({ id: 1, sold: true, order_id: 1 })];
  const noFee = invoice({ paypal_invoice_id: "INV-1" });
  const withFee = invoice({ paypal_invoice_id: "INV-1", paypal_fee: 1.5 });
  const sent = iso(T - DAY);
  const job = (shipments: ReturnType<typeof shipment>[], inv = noFee, ord = o) =>
    nextJob(groupOf(ord, recs, shipments), inv);

  assert.equal(job([]), "pack");
  assert.equal(job([shipment({ order_id: 1, record_ids: [1] })]), "label");
  assert.equal(
    job([labeled({ order_id: 1, record_ids: [1], mode: "manual", paypal_invoice_id: "INV-1" })]),
    "push"
  );
  assert.equal(job([labeled({ order_id: 1, record_ids: [1] })]), "dropoff", "before the fee");
  assert.equal(job([labeled({ order_id: 1, record_ids: [1], sent_at: sent })]), "sync");
  assert.equal(job([labeled({ order_id: 1, record_ids: [1], sent_at: sent })], withFee), "finish");
  assert.equal(
    job([labeled({ order_id: 1, record_ids: [1], sent_at: sent })], withFee, { ...o, completed_at: iso(T) }),
    "none"
  );
  const unmigrated = { ...o };
  delete unmigrated.completed_at;
  assert.equal(
    job([labeled({ order_id: 1, record_ids: [1], sent_at: sent })], withFee, unmigrated),
    "none",
    "no completed_at column yet: nothing to finish"
  );
});

test("an order's list: shipping, after the sale, done, then the archive", () => {
  const recs = [rec({ id: 1, sold: true, order_id: 1 })];
  const sent = iso(T - 2 * DAY);
  const box = (over: Parameters<typeof shipment>[0] = {}) =>
    labeled({ order_id: 1, record_ids: [1], sent_at: sent, updated_at: sent, ...over });
  const phase = (o: ReturnType<typeof order> | null, s: ReturnType<typeof shipment>[]) =>
    orderPhase(groupOf(o, recs, s), T);
  const open = order({ id: 1, status: "paid", completed_at: null });

  assert.equal(phase(open, [box({ sent_at: null })]), "ship", "labeled, still in the house");
  assert.equal(phase(open, [box()]), "after");
  assert.equal(phase({ ...open, completed_at: iso(T) }, [box()]), "done");
  assert.equal(phase(order({ id: 1, status: "paid" }), [box()]), "done", "column not there yet");
  assert.equal(
    orderPhase(
      groupOf(null, [rec({ id: 9, sold: true, buyer_username: "amy" })], [
        box({ order_id: null, record_ids: [9], buyer_username: "amy" }),
      ]),
      T
    ),
    "done",
    "a pre-orders sale has no order row to mark"
  );
  const old = iso(T - 22 * DAY);
  assert.equal(phase(open, [box({ sent_at: old, updated_at: old })]), "archived", "never marked, aged out");
  assert.equal(
    phase({ ...open, completed_at: iso(T) }, [box({ sent_at: null, updated_at: old })]),
    "ship",
    "a drop-off undone reopens the order, done or not"
  );
});

test("timeline: a shop request invoiced, paid and part-way through the table", () => {
  const o = order({ id: 1, status: "paid", paypal_invoice_id: "INV-1", request_id: 7 });
  const recs = [
    rec({ id: 1, sold: true, order_id: 1, picked_at: "2026-11-05T10:00:00Z" }),
    rec({ id: 2, sold: true, order_id: 1 }),
  ];
  const ctx = {
    request: { created_at: "2026-11-03T08:00:00Z" },
    invoice: { created_at: "2026-11-03T09:00:00Z", paid_at: "2026-11-04T09:00:00Z" },
  };
  const steps = orderTimeline(groupOf(o, recs, []), ctx);
  assert.deepEqual(
    steps.map((s) => [s.key, s.state, s.at, s.detail]),
    [
      ["request", "done", "2026-11-03T08:00:00Z", undefined],
      ["invoice", "done", "2026-11-03T09:00:00Z", undefined],
      ["paid", "done", "2026-11-04T09:00:00Z", undefined],
      ["pulled", "current", "2026-11-05T10:00:00Z", "1 of 2"],
      ["packed", "todo", null, undefined],
      ["labeled", "todo", null, undefined],
      ["sent", "todo", null, undefined],
    ]
  );
  assert.equal(steps.at(-1)!.label, "Dropped off");
});

test("timeline: boxed counts as pulled; labels and drop-offs count box by box", () => {
  const o = order({ id: 1, status: "paid", paypal_invoice_id: "INV-1" });
  const recs = [rec({ id: 1, sold: true, order_id: 1 }), rec({ id: 2, sold: true, order_id: 1 })];
  const a = labeled({ id: 11, order_id: 1, record_ids: [1], packed_at: "2026-11-06T10:00:00Z", sent_at: "2026-11-07T15:00:00Z" });
  const b = shipment({ id: 12, order_id: 1, record_ids: [2], packed_at: "2026-11-06T11:00:00Z" });
  const state = (s: ReturnType<typeof shipment>[]) =>
    Object.fromEntries(orderTimeline(groupOf(o, recs, s), {}).map((x) => [x.key, x]));

  const half = state([a, b]);
  assert.equal(half.request, undefined, "no request on a DM sale");
  assert.equal(half.pulled.state, "done", "never ticked, but both are in boxes");
  assert.deepEqual([half.packed.state, half.packed.at], ["done", "2026-11-06T11:00:00Z"]);
  assert.deepEqual([half.labeled.state, half.labeled.detail], ["current", "1 of 2 boxes"]);
  assert.deepEqual([half.sent.state, half.sent.detail], ["todo", "1 of 2 boxes"]);

  const gone = state([a, { ...b, tracking_code: "9401", sent_at: "2026-11-08T15:00:00Z" }]);
  assert.ok(Object.values(gone).every((x) => x.state === "done"));
  assert.equal(gone.sent.at, "2026-11-08T15:00:00Z", "when the last box left");
});

test("timeline: a cash sale handed over has no invoice or label, and says Handed over", () => {
  const o = order({ id: 1, status: "paid" });
  const recs = [rec({ id: 1, sold: true, order_id: 1, sold_at: "2026-11-11T18:00:00Z" })];
  const at = "2026-11-11T23:40:00Z";
  const steps = orderTimeline(
    groupOf(o, recs, [
      shipment({ order_id: 1, record_ids: [1], mode: "hand", carrier: "In person", status: "shipped", packed_at: at, sent_at: at }),
    ]),
    {}
  );
  assert.deepEqual(
    steps.map((s) => [s.key, s.label, s.state]),
    [
      ["paid", "Paid", "done"],
      ["pulled", "Pulled", "done"],
      ["packed", "Packed", "done"],
      ["sent", "Handed over", "done"],
    ]
  );
  assert.equal(steps[0].at, "2026-11-11T18:00:00Z", "paid when it was marked sold");
});
