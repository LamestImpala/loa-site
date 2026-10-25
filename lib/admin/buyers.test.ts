// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerLabel, isRedditHandle } from "./buyers.ts";

test("buyer label: reddit handles get u/, email buyers and non-handles don't", () => {
  assert.equal(buyerLabel("amy"), "u/amy");
  assert.equal(buyerLabel("u/amy"), "u/amy", "stray prefix not doubled");
  assert.equal(buyerLabel("amy", "amy@example.com"), "amy");
  assert.equal(buyerLabel("Jane Smith"), "Jane Smith");
  assert.equal(buyerLabel("jane@example.com"), "jane@example.com");
  assert.equal(buyerLabel("", "jane@example.com"), "jane@example.com");
  assert.equal(buyerLabel(""), "(no buyer)");
  assert.equal(buyerLabel(null, null, "?"), "?");
  assert.ok(isRedditHandle("Shroom_Hog-1"));
  assert.ok(!isRedditHandle("ab"));
});
