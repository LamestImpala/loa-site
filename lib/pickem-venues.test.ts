// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { NFL_TEAMS } from "./pickem-logos.ts";
import { gameVenue, homeVenue, NFL_HOME_VENUES, utcOffsetHours, venueByName } from "./pickem-venues.ts";

test("every NFL team has a home stadium with real coordinates and a time zone", () => {
  for (const team of NFL_TEAMS) {
    const v = homeVenue("nfl", team);
    assert.ok(v, team);
    assert.ok(v.lat > 24 && v.lat < 49 && v.lon > -125 && v.lon < -66, `${team} ${v.lat},${v.lon}`);
    assert.doesNotThrow(() => utcOffsetHours(v.tz, new Date()), v.tz);
  }
  assert.equal(Object.keys(NFL_HOME_VENUES).length, 32);
  assert.equal(homeVenue("nfl", "Detroit Lions")?.dome, true);
  assert.equal(homeVenue("nfl", "Green Bay Packers")?.dome, false);
  assert.equal(homeVenue("nfl", "Not A Team"), undefined);
});

test("venueByName matches ESPN's spelling loosely, for neutral sites", () => {
  assert.equal(venueByName("nfl", "Tottenham Hotspur Stadium")?.tz, "Europe/London");
  assert.equal(venueByName("nfl", "Estadio Santiago Bernabeu")?.dome, true); // accent dropped
  assert.equal(venueByName("nfl", "lambeau field")?.name, "Lambeau Field");
  assert.equal(venueByName("nfl", "Somewhere Else"), undefined);
});

test("gameVenue: the home stadium unless ESPN says neutral; ESPN's indoor flag wins", () => {
  assert.equal(gameVenue("nfl", "Jacksonville Jaguars")?.name, "EverBank Stadium");
  assert.equal(gameVenue("nfl", "Jacksonville Jaguars", { neutral: true, name: "Wembley Stadium", indoor: false })?.name, "Wembley Stadium");
  assert.equal(gameVenue("nfl", "Jacksonville Jaguars", { neutral: true, name: "Unknown Park", indoor: null }), undefined);
  assert.equal(gameVenue("nfl", "Arizona Cardinals", { neutral: false, name: "State Farm Stadium", indoor: false })?.dome, false); // roof open
});

test("utcOffsetHours follows daylight saving", () => {
  assert.equal(utcOffsetHours("America/Chicago", new Date("2026-10-15T12:00:00Z")), -5);
  assert.equal(utcOffsetHours("America/Chicago", new Date("2026-11-15T12:00:00Z")), -6);
  assert.equal(utcOffsetHours("America/Phoenix", new Date("2026-10-15T12:00:00Z")), -7);
  assert.equal(utcOffsetHours("Asia/Kolkata", new Date("2026-10-15T12:00:00Z")), 5.5);
  assert.equal(utcOffsetHours("UTC", new Date()), 0);
});
