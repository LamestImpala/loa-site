// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { logoUrl, NFL_TEAMS } from "./pickem-logos.ts";
import { knownSchools } from "./pickem-conferences.ts";

test("every NFL team has a logo", () => {
  assert.equal(NFL_TEAMS.length, 32);
  for (const t of NFL_TEAMS) {
    assert.match(logoUrl("nfl", t) ?? "", /\/nfl\/500-dark\/[a-z]+\.png$/, t);
  }
});

test("every FBS school in the conference map has a logo", () => {
  const missing = knownSchools().filter((s) => logoUrl("ncaaf", `${s} Mascots`) == null);
  assert.deepEqual(missing, []);
});

test("Odds API spellings that differ from ESPN's still resolve", () => {
  for (const name of ["Appalachian State Mountaineers", "Hawaii Rainbow Warriors", "Sam Houston State Bearkats", "San Jose State Spartans"]) {
    assert.match(logoUrl("ncaaf", name) ?? "", /\/ncaa\/500-dark\/\d+\.png$/, name);
  }
});

test("unknown teams have no logo", () => {
  assert.equal(logoUrl("nfl", "London Monarchs"), null);
  assert.equal(logoUrl("ncaaf", "Faber College Mongooses"), null);
});
