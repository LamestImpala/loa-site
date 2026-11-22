// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineCandidates,
  combinePlan,
  combineSupported,
  orderNumbers,
  sameBuyer,
  saleGroups,
  saleInvite,
  saleMates,
  saleReviewContext,
  saleShipping,
  splitPlan,
} from "./combined.ts";
import { DAY, iso, order, shipment } from "./fixtures.ts";

const T = Date.parse("2026-11-12T12:00:00Z");
const paid = (id: number, over: Parameters<typeof order>[0] = {}) =>
  order({ id, status: "paid", combined_into: null, created_at: iso(T), ...over });

test("sale groups: the first order leads, the ones combined into it follow", () => {
  const orders = [paid(29, { combined_into: 27 }), paid(30), paid(27), paid(28, { combined_into: 27 })];
  const groups = saleGroups(orders);
  assert.deepEqual([...groups.keys()].sort(), [27, 30]);
  assert.deepEqual(groups.get(27)!.map((o) => o.id), [27, 28, 29]);
  assert.deepEqual(groups.get(30)!.map((o) => o.id), [30]);
});

test("sale groups: a stray chain still lands in one sale", () => {
  const orders = [paid(1), paid(2, { combined_into: 1 }), paid(3, { combined_into: 2 })];
  assert.deepEqual(saleGroups(orders).get(1)!.map((o) => o.id), [1, 2, 3]);
});

test("combine: the lower-numbered sale stays first whichever order was clicked", () => {
  const orders = [paid(27), paid(29)];
  const plan = { ok: true, rootId: 27, ids: [29] };
  assert.deepEqual(combinePlan(orders, 27, 29), plan);
  assert.deepEqual(combinePlan(orders, 29, 27), plan);
});

test("combine: a whole sale moves over, so no chain is stored", () => {
  const orders = [paid(27), paid(29), paid(31, { combined_into: 29 })];
  // Clicking a member of the 29 sale still moves all of it under 27.
  assert.deepEqual(combinePlan(orders, 31, 27), { ok: true, rootId: 27, ids: [29, 31] });
});

test("combine: refused for the same order, one sale, or an unpaid order", () => {
  const orders = [
    paid(1),
    paid(2, { combined_into: 1 }),
    order({ id: 3, status: "invoiced" }),
    order({ id: 4, status: "refunded" }),
  ];
  assert.match((combinePlan(orders, 1, 1) as { error: string }).error, /different order/);
  assert.match((combinePlan(orders, 1, 2) as { error: string }).error, /already one sale/);
  assert.match((combinePlan(orders, 1, 3) as { error: string }).error, /Only paid orders/);
  assert.match((combinePlan(orders, 4, 1) as { error: string }).error, /Only paid orders/);
  assert.match((combinePlan(orders, 1, 99) as { error: string }).error, /not found/);
});

test("split: a combined order leaves alone; the first order lets everything go", () => {
  const orders = [paid(1), paid(2, { combined_into: 1 }), paid(3, { combined_into: 1 }), paid(4)];
  assert.deepEqual(splitPlan(orders, 2), [2]);
  assert.deepEqual(splitPlan(orders, 1), [2, 3]);
  assert.deepEqual(splitPlan(orders, 4), []);
});

test("sale mates: the other orders of the sale, from either side", () => {
  const orders = [paid(1), paid(2, { combined_into: 1 }), paid(3)];
  assert.deepEqual(saleMates(orders[0], orders).map((o) => o.id), [2]);
  assert.deepEqual(saleMates(orders[1], orders).map((o) => o.id), [1]);
  assert.deepEqual(saleMates(orders[2], orders), []);
});

test("same buyer: shared email, address or Reddit handle, placed within two weeks", () => {
  const shipTo = {
    name: "Daniel Ross",
    line1: "12 Elm St",
    line2: null,
    city: "Austin",
    state: "TX",
    postal_code: "78701",
    country_code: "US",
  };
  const a = paid(27, { buyer_username: "Danny Ross", buyer_email: "D@Example.com" });
  assert.ok(sameBuyer(a, paid(29, { buyer_username: "Danny", buyer_email: "d@example.com " })));
  assert.ok(
    sameBuyer(
      paid(1, { ship_to: shipTo }),
      paid(2, { ship_to: { ...shipTo, name: "daniel ross", city: "ATX" } })
    )
  );
  assert.ok(sameBuyer(paid(1, { buyer_username: "vinyl_amy" }), paid(2, { buyer_username: "Vinyl_Amy" })));
  // A typed name isn't a handle: two email buyers called Danny aren't one person.
  assert.ok(
    !sameBuyer(
      paid(1, { buyer_username: "Danny", buyer_email: "a@example.com" }),
      paid(2, { buyer_username: "Danny", buyer_email: "b@example.com" })
    )
  );
  // A repeat customer a month later isn't flagged.
  assert.ok(!sameBuyer(a, paid(40, { buyer_email: "d@example.com", created_at: iso(T + 30 * DAY) })));
  assert.ok(!sameBuyer(paid(1), paid(2, { buyer_username: "someone_else" })));
});

test("candidates: paid sales outside this one, likely same buyer first", () => {
  const orders = [
    paid(27, { buyer_email: "d@example.com" }),
    paid(29, { buyer_email: "d@example.com", created_at: iso(T + DAY) }),
    paid(30, { buyer_username: "other_one", created_at: iso(T + 2 * DAY) }),
    paid(31, { buyer_username: "other_two", combined_into: 30, created_at: iso(T + 3 * DAY) }),
    order({ id: 32, status: "invoiced" }),
    order({ id: 33, status: "cancelled" }),
  ];
  const got = combineCandidates(orders[0], orders);
  assert.deepEqual(
    got.map((c) => [c.order.id, c.ids, c.same]),
    [
      [29, [29], true],
      [30, [30, 31], false],
    ]
  );
  // Once combined, the sale's own orders stop being offered.
  const combined = orders.map((o) => (o.id === 29 ? { ...o, combined_into: 27 } : o));
  assert.deepEqual(combineCandidates(combined[0], combined).map((c) => c.order.id), [30]);
});

test("sale shipping: the last box out, and a box (or paid order) still home", () => {
  const orders = [paid(1), paid(2, { combined_into: 1 }), paid(3), order({ id: 4, status: "refunded", combined_into: 3 })];
  const early = iso(T - 5 * DAY);
  const late = iso(T - 2 * DAY);
  const shipping = saleShipping(orders, [
    shipment({ order_id: 1, sent_at: early }),
    shipment({ order_id: 2, sent_at: late, mode: "hand" }),
    shipment({ order_id: 3, sent_at: early, mode: "hand" }),
    shipment({ order_id: 4, sent_at: null }), // refunded: doesn't hold the sale up
  ]);
  assert.deepEqual(shipping.get(1), { lastSent: late, unsent: false, mailed: true });
  assert.deepEqual(shipping.get(3), { lastSent: early, unsent: false, mailed: false });
  // A paid order with no box yet keeps the sale waiting.
  assert.equal(saleShipping(orders, [shipment({ order_id: 1, sent_at: early })]).get(1)!.unsent, true);
});

test("sale invite: the used link, else the emailed one, else the oldest", () => {
  const inv = (order_id: number, over: object = {}) => ({
    order_id,
    sent_at: null as string | null,
    used_at: null as string | null,
    created_at: iso(T),
    ...over,
  });
  const copied = inv(1, { created_at: iso(T - DAY) });
  const emailed = inv(2, { sent_at: iso(T) });
  const used = inv(3, { used_at: iso(T) });
  assert.equal(saleInvite([copied, emailed, used], [1, 2, 3]), used);
  assert.equal(saleInvite([copied, emailed, used], [1, 2]), emailed);
  assert.equal(saleInvite([inv(2), copied], [1, 2]), copied);
  assert.equal(saleInvite([used], [1, 2]), null);
});

test("review context: null for an order on its own, the sale's state when combined", () => {
  const orders = [
    paid(1),
    paid(2, { combined_into: 1, buyer_email: "a@example.com" }),
    paid(3),
  ];
  const sent = iso(T - DAY);
  const shipments = [shipment({ order_id: 1, sent_at: sent }), shipment({ order_id: 2, sent_at: null })];
  assert.equal(saleReviewContext(orders[2], orders, shipments), null);
  assert.deepEqual(saleReviewContext(orders[1], orders, shipments), {
    orderIds: [2, 1],
    lastSent: sent,
    unsent: true,
    email: true,
  });
});

test("combine is offered only once the column exists", () => {
  assert.ok(combineSupported(paid(1)));
  assert.ok(!combineSupported(order({ id: 1 })));
  assert.ok(!combineSupported(null));
  assert.equal(orderNumbers([27, 29]), "#27 + #29");
});
