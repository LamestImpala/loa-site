// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderRequest } from "../supabase.ts";
import { discogsCandidates, finishedRequests, soldPatch } from "./sales.ts";
import { DAY, iso, rec } from "./fixtures.ts";

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
    picked_at: null,
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
