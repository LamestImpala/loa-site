// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boxesToTrack,
  cleanTrackingNumber,
  deliveredDay,
  fetchShippoTrack,
  parseShippoTrack,
  shippoCarrier,
  trackingLabel,
  trackingUpdate,
} from "./delivery.ts";
import { sweepDeliveries, type Notify } from "./delivery-db.ts";
import { fakeSupabase } from "./admin/fake-supabase.ts";

const now = new Date("2026-11-28T18:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

// Shaped like Shippo's GET /tracks answer for the example box (#25).
const deliveredBody = {
  carrier: "usps",
  tracking_number: "9449050206217052340403",
  tracking_status: {
    status: "DELIVERED",
    status_details: "Delivered, Front Door/Porch",
    status_date: "2026-11-27T23:49:00Z",
    location: { city: "OLYMPIA", state: "WA", zip: "98502", country: "US" },
  },
  tracking_history: [
    { status: "PRE_TRANSIT", status_date: "2026-11-23T10:00:00Z" },
    { status: "TRANSIT", status_date: "2026-11-24T10:00:00Z" },
    { status: "DELIVERED", status_date: "2026-11-27T23:49:00Z" },
  ],
};

test("carrier tokens: blank and USPS ask usps; unknown carriers aren't asked", () => {
  assert.equal(shippoCarrier("USPS"), "usps");
  assert.equal(shippoCarrier(""), "usps");
  assert.equal(shippoCarrier(null), "usps");
  assert.equal(shippoCarrier("UPS"), "ups");
  assert.equal(shippoCarrier("FedEx"), "fedex");
  assert.equal(shippoCarrier("Pigeon"), null);
});

test("tracking numbers typed with spaces are cleaned", () => {
  assert.equal(cleanTrackingNumber("9449 0502 0621 7052 2121 68"), "9449050206217052212168");
  assert.equal(cleanTrackingNumber(null), "");
});

test("which boxes are asked about", () => {
  const box = (over: Record<string, unknown>) => ({
    id: 1,
    sent_at: daysAgo(5),
    tracking_code: "9400",
    carrier: "USPS",
    mode: "paypal",
    delivered_at: null,
    ...over,
  });
  const boxes = [
    box({ id: 1 }), // asked
    box({ id: 2, sent_at: null }), // still home
    box({ id: 3, delivered_at: daysAgo(1) }), // already delivered
    box({ id: 4, mode: "hand", tracking_code: null }), // handed over
    box({ id: 5, tracking_code: " " }), // no number
    box({ id: 6, sent_at: daysAgo(40) }), // too old
    box({ id: 7, carrier: "Pigeon" }), // can't ask
  ];
  assert.deepEqual(
    boxesToTrack(boxes, now).map((b) => b.id),
    [1]
  );
});

test("a delivered answer: status, the carrier's words with the place, the date", () => {
  assert.deepEqual(parseShippoTrack(deliveredBody, now), {
    status: "DELIVERED",
    detail: "Delivered, Front Door/Porch — OLYMPIA, WA",
    deliveredAt: "2026-11-27T23:49:00.000Z",
  });
  assert.equal(deliveredDay("2026-11-27T23:49:00Z"), "Nov 27", "4:49 pm in Arizona, not 'Nov 28' UTC");
});

test("an in-transit answer has no delivery date; unknown statuses read UNKNOWN", () => {
  const moving = parseShippoTrack({
    tracking_status: { status: "TRANSIT", status_details: "Arrived at USPS Facility", location: null },
    tracking_history: [],
  });
  assert.deepEqual(moving, { status: "TRANSIT", detail: "Arrived at USPS Facility", deliveredAt: null });
  assert.equal(parseShippoTrack({ tracking_status: { status: "WEIRD" }, tracking_history: [] })?.status, "UNKNOWN");
  assert.equal(parseShippoTrack({ tracking_status: null, tracking_history: [] })?.status, "UNKNOWN");
  assert.equal(parseShippoTrack("<html>"), null);
  assert.equal(parseShippoTrack({ detail: "Not found" }), null);
});

test("Shippo's test dates have no zone and are read as UTC", () => {
  const r = parseShippoTrack({
    tracking_status: { status: "DELIVERED", status_date: "2018-07-29T16:44:42.586" },
    tracking_history: [],
  });
  assert.equal(r?.deliveredAt, "2018-07-29T16:44:42.586Z");
});

test("delivered with no date: the history's delivered scan, else now", () => {
  const r = parseShippoTrack(
    {
      tracking_status: { status: "DELIVERED" },
      tracking_history: [{ status: "DELIVERED", status_date: "2026-11-26T15:00:00Z" }],
    },
    now
  );
  assert.equal(r?.deliveredAt, "2026-11-26T15:00:00.000Z");
  const bare = parseShippoTrack({ tracking_status: { status: "DELIVERED" }, tracking_history: [] }, now);
  assert.equal(bare?.deliveredAt, now.toISOString());
});

test("asking Shippo: the path, the token header, and errors thrown", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const ok = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(deliveredBody), { status: 200 });
  }) as typeof fetch;
  const r = await fetchShippoTrack("usps", "9449050206217052340403", { key: "shippo_test_x", fetch: ok });
  assert.equal(r.status, "DELIVERED");
  assert.deepEqual(calls, [
    {
      url: "https://api.goshippo.com/tracks/usps/9449050206217052340403",
      auth: "ShippoToken shippo_test_x",
    },
  ]);

  const denied = (async () => new Response("Invalid token", { status: 401 })) as typeof fetch;
  await assert.rejects(fetchShippoTrack("usps", "1", { key: "k", fetch: denied }), /Shippo 401: Invalid token/);
  await assert.rejects(fetchShippoTrack("usps", "1", { key: "", fetch: denied }), /SHIPPO_API_KEY/);
});

test("the row update only sets delivered_at when delivered", () => {
  assert.deepEqual(trackingUpdate({ status: "TRANSIT", detail: null, deliveredAt: null }, now), {
    tracking_status: "TRANSIT",
    tracking_detail: null,
    tracking_checked_at: now.toISOString(),
  });
  assert.equal(
    trackingUpdate({ status: "DELIVERED", detail: null, deliveredAt: daysAgo(1) }, now).delivered_at,
    daysAgo(1)
  );
  assert.equal(trackingLabel("TRANSIT"), "In transit");
  assert.equal(trackingLabel("DELIVERED"), null);
});

function shop() {
  return fakeSupabase({
    orders: [
      { id: 24, status: "paid", buyer_email: null, buyer_username: "snookn42", combined_into: null },
      { id: 25, status: "paid", buyer_email: "sander@example.com", buyer_username: "Sander", combined_into: null },
      { id: 26, status: "paid", buyer_email: null, buyer_username: "two_boxes", combined_into: null },
    ],
    shipments: [
      { id: 24, order_id: 24, sent_at: daysAgo(5), tracking_code: "9449 0502 0621 7052 2121 68", carrier: "USPS", mode: "paypal", delivered_at: null },
      { id: 25, order_id: 25, sent_at: daysAgo(5), tracking_code: "9449050206217052340403", carrier: "USPS", mode: "paypal", delivered_at: null },
      { id: 30, order_id: 26, sent_at: daysAgo(5), tracking_code: "A1", carrier: "USPS", mode: "paypal", delivered_at: null },
      { id: 31, order_id: 26, sent_at: daysAgo(5), tracking_code: "A2", carrier: "USPS", mode: "paypal", delivered_at: null },
    ],
    review_invites: [],
    records: [
      { artist: "Ott", title: "Heads", order_id: 24 },
      { artist: "Hole", title: "Celebrity Skin", order_id: 25 },
    ],
  });
}

test("the sweep marks delivered boxes and emails the admin about Reddit sales only", async () => {
  const { client, db } = shop();
  const asked: string[] = [];
  const lookup = async (_c: string, n: string) => {
    asked.push(n);
    return n === "A2" ? { status: "TRANSIT" as const, detail: "In Transit", deliveredAt: null } : parseShippoTrack(deliveredBody, now)!;
  };
  const sent: { subject: string; text: string }[] = [];
  const notify: Notify = async (m) => {
    sent.push(m);
    return { ok: true };
  };
  const r = await sweepDeliveries(client, lookup, { notify, now });

  assert.equal(r.checked, 4);
  assert.ok(asked.includes("9449050206217052212168"), "spaces stripped before asking");
  const row = (id: number) => db.tables.shipments.find((s) => s.id === id)!;
  assert.equal(row(24).delivered_at, "2026-11-27T23:49:00.000Z");
  assert.equal(row(24).tracking_detail, "Delivered, Front Door/Porch — OLYMPIA, WA");
  assert.equal(row(31).delivered_at, null);
  assert.equal(row(31).tracking_status, "TRANSIT");

  // #24 (Reddit, all delivered) gets an email; #25 has an email buyer (the
  // daily job asks); #26 still has a box on the way.
  assert.deepEqual(r.notified, [24]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /u\/snookn42/);
  assert.match(sent[0].text, /Ott – Heads\) was delivered Nov 27 — Delivered, Front Door\/Porch/);
});

test("a dry sweep asks but writes and emails nothing", async () => {
  const { client, db } = shop();
  const notify: Notify = async () => {
    throw new Error("should not email");
  };
  const r = await sweepDeliveries(client, async () => parseShippoTrack(deliveredBody, now)!, {
    dry: true,
    notify,
    now,
  });
  assert.equal(r.delivered.length, 4);
  assert.ok(db.tables.shipments.every((s) => s.delivered_at === null));
});

test("a failed lookup is counted and the rest go on", async () => {
  const { client, db } = shop();
  const r = await sweepDeliveries(
    client,
    async (_c, n) => {
      if (n === "A1") throw new Error("Shippo 500");
      return { status: "TRANSIT", detail: null, deliveredAt: null };
    },
    { now }
  );
  assert.deepEqual(r.failed, [{ shipmentId: 30, error: "Shippo 500" }]);
  assert.equal(db.tables.shipments.filter((s) => s.tracking_status === "TRANSIT").length, 3);
});
