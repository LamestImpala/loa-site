// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScoped, newsAfter, parseRepickScope, scopeGames } from "./pickem-repick.ts";
import type { NewsItem } from "./pickem-signals.ts";

const item = (date: string | null): NewsItem => ({ team: "home", player: "QB", detail: "out", source: "x", date });
const digest = (researched_at: string, ...dates: (string | null)[]) => ({ injuries: dates.map(item), suspensions: [], coaching: [], researched_at });

// Tuesday 2026-10-13, 14:00 UTC is 10:00 ET: the number pass.
const TUE_CALL = "2026-10-13T14:00:00.000Z";
const FRI_RESEARCH = "2026-10-16T13:45:00.000Z";

test("parseRepickScope: games are split, trimmed and de-duplicated; since is an ISO time or \"call\"", () => {
  assert.deepEqual(parseRepickScope(new URLSearchParams("games=a, b,,a")), { games: ["a", "b"] });
  assert.deepEqual(parseRepickScope(new URLSearchParams("since=2026-10-13T09:00:00-05:00")), { since: TUE_CALL });
  assert.deepEqual(parseRepickScope(new URLSearchParams("since=call&games=a")), { games: ["a"], since: "call" });
  assert.deepEqual(parseRepickScope(new URLSearchParams("force=1")), {});
  assert.ok("error" in parseRepickScope(new URLSearchParams("since=tuesday")));
});

test("isScoped: only a game list or a since limits the run", () => {
  assert.equal(isScoped({}), false);
  assert.equal(isScoped({ games: [] }), false);
  assert.equal(isScoped({ games: ["a"] }), true);
  assert.equal(isScoped({ since: "call" }), true);
});

test("newsAfter: a later digest with an item dated on or after the call's Eastern day", () => {
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-15"), TUE_CALL), "2026-10-15");
  // The afternoon of the call's own day counts: items carry only a day.
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-13"), TUE_CALL), "2026-10-13");
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-12"), TUE_CALL), null);
  assert.equal(newsAfter(digest(FRI_RESEARCH), TUE_CALL), null);
  assert.equal(newsAfter(undefined, TUE_CALL), null);
});

test("newsAfter: an item without a date counts as news from the research time", () => {
  // The first NFL dry run came back with a whole final injury report undated.
  assert.equal(newsAfter(digest(FRI_RESEARCH, null), TUE_CALL), FRI_RESEARCH);
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-12", null), TUE_CALL), FRI_RESEARCH);
  // A dated item on or after the call still names its own date.
  assert.equal(newsAfter(digest(FRI_RESEARCH, null, "2026-10-15"), TUE_CALL), "2026-10-15");
  // Only in a digest researched after the call.
  assert.equal(newsAfter(digest("2026-10-13T13:45:00.000Z", null), TUE_CALL), null);
});

test("newsAfter: the newest item is found by day, so a stray date format cannot hide a newer one", () => {
  // "Oct 15" parses in V8 (as 2001) and sorts after any ISO date as a string.
  assert.equal(newsAfter(digest(FRI_RESEARCH, "Oct 15", "2026-10-15"), TUE_CALL), "2026-10-15");
  assert.equal(newsAfter(digest(FRI_RESEARCH, "not a date"), TUE_CALL), FRI_RESEARCH);
});

test("newsAfter: the digest a call was shown never re-triggers it", () => {
  assert.equal(newsAfter(digest("2026-10-13T13:45:00.000Z", "2026-10-13"), TUE_CALL), null);
  assert.equal(newsAfter(digest(TUE_CALL, "2026-10-13"), TUE_CALL), null);
});

test("newsAfter: a full timestamp on an item is read as its Eastern day", () => {
  // 02:00 UTC Wednesday is still Tuesday night in the East.
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-14T02:00:00Z"), "2026-10-14T14:00:00Z"), null);
  assert.equal(newsAfter(digest(FRI_RESEARCH, "2026-10-14T05:00:00Z"), "2026-10-14T14:00:00Z"), "2026-10-14T05:00:00Z");
});

const game = (id: string, picked_at?: string) => ({ id, house: picked_at === undefined ? null : { picked_at } });
const SLATE = [game("a", TUE_CALL), game("b", TUE_CALL), game("c"), game("d", "2026-10-16T14:00:00.000Z")];
const NEWS: Record<string, ReturnType<typeof digest>> = {
  a: digest(FRI_RESEARCH, "2026-10-15"),
  b: digest(FRI_RESEARCH, "2026-10-12"),
  c: digest(FRI_RESEARCH, "2026-10-15"),
  d: digest(FRI_RESEARCH, "2026-10-15"),
};
const ids = (r: ReturnType<typeof scopeGames>) => r.games.map((g) => g.game.id);

test("scopeGames: games= keeps the named games in slate order and lists ids not on the slate", () => {
  const r = scopeGames(SLATE, { games: ["c", "a", "gone"] }, (id) => NEWS[id]);
  assert.deepEqual(ids(r), ["a", "c"]);
  assert.deepEqual(r.unknown, ["gone"]);
  assert.equal(r.games[0].news, undefined);
});

test("scopeGames: since=<iso> keeps games with news after it, called or not", () => {
  const r = scopeGames(SLATE, { since: TUE_CALL }, (id) => NEWS[id]);
  assert.deepEqual(ids(r), ["a", "c", "d"]);
  assert.equal(r.games[0].news, "2026-10-15");
});

test("scopeGames: since=call measures from each game's own call and leaves uncalled games to the normal run", () => {
  // c has no call; d was re-picked after Friday's research, so that digest is already in its call.
  assert.deepEqual(ids(scopeGames(SLATE, { since: "call" }, (id) => NEWS[id])), ["a"]);
});

test("scopeGames: games= and since= combine", () => {
  assert.deepEqual(ids(scopeGames(SLATE, { games: ["b", "c"], since: TUE_CALL }, (id) => NEWS[id])), ["c"]);
});
