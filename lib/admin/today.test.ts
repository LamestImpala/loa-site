// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { movedInboxHash, movedShipHash, todayCount, todayGroups } from "./today.ts";
import { worklist, type Worklist } from "./worklist.ts";

const NONE: Worklist = worklist(
  { records: [], shipments: [], invoices: [], orders: [], orderRequests: [] },
  0
);

test("nothing waiting: four empty groups in the order a sale moves", () => {
  const groups = todayGroups(NONE);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Sell", "Ship", "Stock", "After the sale"]
  );
  assert.ok(groups.every((g) => g.rows.length === 0 && g.count === 0));
  assert.equal(todayCount(groups), 0);
});

test("every job in the worklist has exactly one row", () => {
  const all = Object.fromEntries(
    Object.keys(NONE).map((k) => [k, 1])
  ) as Worklist;
  // One expired hold + one stale invoice + one order simply waiting.
  const groups = todayGroups({ ...all, openOrders: 3 });
  const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
  assert.equal(new Set(keys).size, keys.length);
  // One row per worklist count; openOrders shows as "awaiting payment".
  assert.equal(keys.length, Object.keys(NONE).length);
  assert.ok(groups.flatMap((g) => g.rows).every((r) => r.href.startsWith("/admin")));
});

test("orders waiting on the buyer are shown but not counted", () => {
  const [sell] = todayGroups({ ...NONE, openOrders: 4, expiredHolds: 1, staleInvoices: 1 });
  assert.deepEqual(
    sell.rows.map((r) => [r.key, r.n]),
    [
      ["expired", 1],
      ["stale", 1],
      ["waiting", 2],
    ]
  );
  assert.equal(sell.count, 2);
  assert.equal(sell.rows[2].label, "orders awaiting payment");
});

test("rows read as a sentence after their number, singular and plural", () => {
  const one = todayGroups({ ...NONE, newRequests: 1, needLabels: 1, pendingReviews: 1 });
  const many = todayGroups({ ...NONE, newRequests: 2, needLabels: 2, pendingReviews: 2 });
  const label = (gs: typeof one, key: string) =>
    gs.flatMap((g) => g.rows).find((r) => r.key === key)?.label;
  assert.equal(label(one, "requests"), "new request");
  assert.equal(label(many, "requests"), "new requests");
  assert.equal(label(one, "labels"), "box needs a label");
  assert.equal(label(many, "labels"), "boxes need a label");
  assert.equal(label(one, "reviews"), "review to publish");
});

test("rows link to the exact spot the job is cleared", () => {
  const rows = todayGroups({
    ...NONE,
    newRequests: 1,
    newMessages: 1,
    toSend: 1,
    toPush: 1,
    toSync: 1,
    toFinish: 1,
    pendingReviews: 1,
    priceApprovals: 1,
    draftsToPublish: 1,
  }).flatMap((g) => g.rows);
  const href = (key: string) => rows.find((r) => r.key === key)?.href;
  assert.equal(href("requests"), "/admin/sell#requests");
  assert.equal(href("messages"), "/admin/sell#messages");
  assert.equal(href("send"), "/admin/ship#drop-off");
  assert.equal(href("push"), "/admin/ship/orders");
  assert.equal(href("sync"), "/admin/ship/orders");
  assert.equal(href("finish"), "/admin/ship/orders#after-sale");
  assert.equal(href("reviews"), "/admin/reviews");
  assert.equal(href("prices"), "/admin/pricing");
  assert.equal(href("drafts"), "/admin/catalog?status=draft");
});

test("old Inbox anchors forward to where the section moved", () => {
  assert.equal(movedInboxHash("#requests"), "/admin/sell#requests");
  assert.equal(movedInboxHash("#open-orders"), "/admin/sell#open-orders");
  assert.equal(movedInboxHash("#messages"), "/admin/sell#messages");
  assert.equal(movedInboxHash("#paste-dm"), "/admin/sell#paste-dm");
  assert.equal(movedInboxHash("#reviews"), "/admin/reviews");
  assert.equal(movedInboxHash("#numbers"), null);
  assert.equal(movedInboxHash(""), null);
});

test("the order cards moved off the Drop off page to Orders", () => {
  assert.equal(movedShipHash("#fulfillment"), "/admin/ship/orders");
  assert.equal(movedShipHash("#drop-off"), null);
  assert.equal(movedShipHash(""), null);
});

test("shipped orders to mark done read as a sentence and count as the seller's move", () => {
  const after = (n: number) => todayGroups({ ...NONE, toFinish: n })[3];
  assert.equal(after(1).rows[0].label, "shipped order to mark done");
  assert.equal(after(2).rows[0].label, "shipped orders to mark done");
  assert.equal(after(2).count, 2);
  assert.equal(after(2).href, "/admin/ship/orders");
});
