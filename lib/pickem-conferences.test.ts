// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferenceOf, conferenceTag, isPower, unmappedTeams, CONFERENCES } from "./pickem-conferences.ts";

test("resolves Odds API names through the mascot trimmer", () => {
  assert.equal(conferenceOf("Alabama Crimson Tide"), "SEC");
  assert.equal(conferenceOf("Texas A&M Aggies"), "SEC");
  assert.equal(conferenceOf("Louisiana Ragin' Cajuns"), "Sun Belt");
  assert.equal(conferenceOf("Miami (OH) RedHawks"), "MAC");
  assert.equal(conferenceOf("Miami Hurricanes"), "ACC");
  assert.equal(conferenceOf("Hawaii Rainbow Warriors"), "Mountain West");
  assert.equal(conferenceOf("UL Monroe Warhawks"), "Sun Belt");
  assert.equal(conferenceOf("Sam Houston State Bearkats"), "Conference USA");
  assert.equal(conferenceOf("Texas State Bobcats"), "Pac-12");
  assert.equal(conferenceOf("UConn Huskies"), "Independent");
});

test("aliases map to the same school", () => {
  assert.equal(conferenceOf("UMass Minutemen"), "MAC");
  assert.equal(conferenceOf("Massachusetts Minutemen"), "MAC");
  assert.equal(conferenceOf("Sam Houston Bearkats"), "Conference USA");
});

test("unknown schools are FCS and reported", () => {
  assert.equal(conferenceOf("Wofford Terriers"), "FCS");
  assert.deepEqual(unmappedTeams(["Wofford Terriers", "Alabama Crimson Tide", "Wofford Terriers"]), ["Wofford Terriers"]);
});

test("power four plus Notre Dame", () => {
  assert.equal(isPower("Notre Dame Fighting Irish"), true);
  assert.equal(isPower("Oregon Ducks"), true);
  assert.equal(isPower("Boise State Broncos"), false);
});

test("every conference has a tag", () => {
  for (const c of CONFERENCES) assert.ok(conferenceTag(c).length >= 3);
});
