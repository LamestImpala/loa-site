// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderRequest } from "../supabase.ts";
import {
  activeHoldGroups,
  discogsCandidates,
  finishedRequests,
  pendingInvoiceGroups,
  soldPatch,
} from "./sales.ts";
import { DAY, invoice, iso, rec } from "./fixtures.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const at = new Date(NOW);

test("sold patch: desk buyer beats the hold's buyer beats the row's, holds always clear", () => {
  const held = rec({ price: 45, hold_buyer: "holder", hold_until: iso(NOW + DAY), buyer_username: " old " });
  assert.deepEqual(soldPatch(held, "desk", at), {
    sold: true,
    sold_at: at.toISOString(),
    sold_price: 45,
    buyer_username: "desk",
    hold_buyer: null,
    hold_until: null,
  });
  assert.equal(soldPatch(held, "", at).buyer_username, "holder");
  assert.equal(soldPatch(rec({ buyer_username: " old " }), "", at).buyer_username, "old");
  assert.equal(soldPatch(rec(), "", at).buyer_username, "");
  assert.equal(soldPatch(rec({ price: "12.5" as unknown as number }), "", at).sold_price, 12.5);
});

const request = (id: number, status: OrderRequest["status"], record_ids: number[]): OrderRequest => ({
  id,
  ref_code: `CR-${id}`,
  buyer_username: "b",
  record_ids,
  items: [],
  subtotal: 0,
  shipping: 0,
  total: 0,
  status,
  created_at: "",
  updated_at: "",
});

test("a loaded request finishes once every record is sold, now or earlier", () => {
  const byId = new Map([
    [1, rec({ id: 1 })],
    [2, rec({ id: 2, sold: true })],
    [3, rec({ id: 3 })],
  ]);
  const requests = [
    request(1, "loaded", [1, 2]),
    request(2, "loaded", [1, 3]),
    request(3, "new", [1]),
    request(4, "loaded", [4]), // record not loaded at all
  ];
  const done = finishedRequests(requests, new Set([1]), byId);
  assert.deepEqual(done.map((r) => r.id), [1]);
});

test("Discogs removal is offered only for records that actually sold and still sit in the collection", () => {
  const targets = [
    rec({ id: 1, discogs_release_id: 10 }),
    rec({ id: 2, discogs_release_id: 20, discogs_removed: true }),
    rec({ id: 3, discogs_release_id: null }),
    rec({ id: 4, discogs_release_id: 40 }), // write failed
  ];
  assert.deepEqual(discogsCandidates(targets, new Set([1, 2, 3])).map((r) => r.id), [1]);
});

test("pending invoices: unpaid and uncancelled, records from the stamp or the saved ids", () => {
  const records = [
    rec({ id: 1, paypal_invoice_id: "INV-A", hold_buyer: "amy", hold_until: iso(NOW + DAY) }),
    rec({ id: 2, paypal_invoice_id: "INV-A", hold_until: iso(NOW + 2 * DAY) }),
    rec({ id: 3, paypal_invoice_id: "INV-A", sold: true }),
    rec({ id: 4 }), // INV-B's stamp never landed
    rec({ id: 5, sold: true }),
    rec({ id: 6, paypal_invoice_id: "INV-C" }),
    rec({ id: 7, paypal_invoice_id: "INV-D" }),
  ];
  const groups = pendingInvoiceGroups(records, [
    invoice({ paypal_invoice_id: "INV-A", created_at: "2026-09-10T00:00:00Z" }),
    invoice({ paypal_invoice_id: "INV-B", buyer_username: " bob ", record_ids: [4, 5], created_at: "2026-09-11T00:00:00Z" }),
    invoice({ paypal_invoice_id: "INV-C", paid_at: "2026-09-12T00:00:00Z" }),
    invoice({ paypal_invoice_id: "INV-D", status: "CANCELLED" }),
    invoice({ paypal_invoice_id: "INV-E", record_ids: [5] }), // only a sold record
  ]);
  assert.deepEqual(groups.map((g) => g.invoice.paypal_invoice_id), ["INV-B", "INV-A"], "newest first");
  const [b, a] = groups;
  assert.equal(a.buyer, "amy", "falls back to the hold's buyer");
  assert.deepEqual(a.recs.map((r) => r.id), [1, 2], "sold records drop off the live stamp");
  assert.equal(a.holdUntil, NOW + 2 * DAY, "latest expiry among members");
  assert.equal(a.totals.total, 66, "two records: $60 plus $6 shipping");
  assert.equal(b.buyer, "bob");
  assert.deepEqual(b.recs.map((r) => r.id), [4], "saved ids skip sold records too");
  assert.equal(b.holdUntil, 0);
});

test("active holds group per buyer, skip invoiced orders, soonest expiry first", () => {
  const records = [
    rec({ id: 1, hold_buyer: "zed", hold_until: iso(NOW + 3 * DAY) }),
    rec({ id: 2, hold_buyer: " zed ", hold_until: iso(NOW + DAY) }),
    rec({ id: 3, hold_buyer: "amy", hold_until: iso(NOW + 2 * DAY) }),
    rec({ id: 4, hold_until: iso(NOW + 1000) }),
    rec({ id: 5, hold_buyer: "old", hold_until: iso(NOW - 1) }), // expired
    rec({ id: 6, hold_buyer: "sold", hold_until: iso(NOW + DAY), sold: true }),
    rec({ id: 7, hold_buyer: "inv", hold_until: iso(NOW + DAY), paypal_invoice_id: "INV-A" }),
    rec({ id: 8, hold_buyer: "paid", hold_until: iso(NOW + DAY), paypal_invoice_id: "INV-OLD" }),
  ];
  const groups = activeHoldGroups(records, new Set(["INV-A"]), NOW);
  assert.deepEqual(
    groups.map((g) => [g.buyer, g.recs.map((r) => r.id), g.until]),
    [
      ["(no buyer name)", [4], NOW + 1000],
      ["zed", [1, 2], NOW + DAY],
      ["amy", [3], NOW + 2 * DAY],
      ["paid", [8], NOW + DAY],
    ].sort((x, y) => (x[2] as number) - (y[2] as number))
  );
});
