// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_TIER_META, houseStake, houseTier } from "./pickem.ts";

test("houseTier: 5 and below pass, 6 leans, 7 likes, 8 and up are best bets", () => {
  assert.equal(houseTier(1), "pass");
  assert.equal(houseTier(4), "pass");
  assert.equal(houseTier(5), "pass");
  assert.equal(houseTier(6), "lean");
  assert.equal(houseTier(7), "like");
  assert.equal(houseTier(8), "best");
  assert.equal(houseTier(10), "best");
});

test("houseStake: nothing on a pass, then 1, 2 and 3 units", () => {
  assert.equal(houseStake(5), 0);
  assert.equal(houseStake(1), 0);
  assert.equal(houseStake(6), 1);
  assert.equal(houseStake(7), 2);
  assert.equal(houseStake(8), 3);
  assert.equal(houseStake(10), 3);
});

test("every non-pass tier has display copy", () => {
  for (const c of [6, 7, 8]) {
    const tier = houseTier(c);
    assert.notEqual(tier, "pass");
    const meta = HOUSE_TIER_META[tier as Exclude<ReturnType<typeof houseTier>, "pass">];
    assert.ok(meta.pill && meta.verb && meta.pct);
  }
});
