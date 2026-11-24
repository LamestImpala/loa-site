// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./admin/fake-supabase.ts";
import { clientIp, hitAllowed, ipBucket, overLimit, visitorHash } from "./rate-limit.ts";

test("client ip: Vercel's x-real-ip wins, then the first forwarded hop, else none", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": " 203.0.113.9 ", "x-forwarded-for": "10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })), "198.51.100.4");
  assert.equal(clientIp(new Headers()), null);
});

test("ip bucket: IPv4 whole, IPv6 by its /64, mapped IPv4 unwrapped", () => {
  assert.equal(ipBucket("203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("2001:db8:12:34:aaaa:bbbb:cccc:dddd"), "2001:db8:12:34");
  assert.equal(ipBucket("2001:0DB8:0012:0034::1"), "2001:db8:12:34");
  assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0");
  assert.equal(ipBucket("2001:db8:0:0:1::"), "2001:db8:0:0");
  assert.equal(ipBucket("::1"), "0:0:0:0");
  assert.equal(ipBucket("[2001:db8:12:34::5]"), "2001:db8:12:34");
  assert.equal(ipBucket("fe80::1%en0"), "fe80:0:0:0");
  assert.equal(ipBucket("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("0:0:0:0:0:ffff:203.0.113.9"), "203.0.113.9");
});

test("visitor hash: keyed, stable, never the address, one bucket for a /64", () => {
  const a = visitorHash("203.0.113.9", "secret-a");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, visitorHash("203.0.113.9", "secret-a"));
  assert.notEqual(a, visitorHash("203.0.113.10", "secret-a"));
  assert.notEqual(a, visitorHash("203.0.113.9", "secret-b"), "useless without the secret");
  assert.ok(!a.includes("203"));
  assert.equal(
    visitorHash("2001:db8:12:34::1", "s"),
    visitorHash("2001:db8:12:34:ffff:ffff:ffff:ffff", "s")
  );
  assert.notEqual(visitorHash("2001:db8:12:34::1", "s"), visitorHash("2001:db8:12:35::1", "s"));
  // No address (local dev): one shared visitor, still limited.
  assert.equal(visitorHash(null, "s"), visitorHash(null, "s"));
  assert.notEqual(visitorHash(null, "s"), visitorHash("203.0.113.9", "s"));
});

test("over limit: counts only this value's rows inside the window", async () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const { client } = fakeSupabase({
    hits: [
      { id: 1, who: "a", created_at: at(5) },
      { id: 2, who: "a", created_at: at(30) },
      { id: 3, who: "a", created_at: at(61) }, // outside the hour
      { id: 4, who: "b", created_at: at(1) },
    ],
  });
  const w = { table: "hits", column: "who", value: "a", windowMs: 60 * 60_000 };
  assert.equal(await overLimit(client, { ...w, max: 3 }, now), false);
  assert.equal(await overLimit(client, { ...w, max: 2 }, now), true);
  assert.equal(await overLimit(client, { ...w, value: "b", max: 1 }, now), true);
  assert.equal(await overLimit(client, { ...w, value: "nobody", max: 1 }, now), false);
});

test("over limit: a failed count never blocks", async () => {
  const broken = {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ count: null, error: { message: "column hits.who does not exist" } }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof overLimit>[0];
  const w = { table: "hits", column: "who", value: "a", windowMs: 1000, max: 1 };
  assert.equal(await overLimit(broken, w), false);
});

const limit = { scope: "track", visitor: "v1", windowSeconds: 600, max: 3 };

test("hit allowed: passes the limit to rate_hit and returns its answer", async () => {
  const { client, db } = fakeSupabase({});
  const calls: unknown[] = [];
  let answer = true;
  db.rpcs.rate_hit = (args) => {
    calls.push(args);
    return { data: answer, error: null };
  };
  assert.equal(await hitAllowed(client, limit), true);
  answer = false;
  assert.equal(await hitAllowed(client, limit), false);
  assert.deepEqual(calls[0], {
    p_scope: "track",
    p_visitor: "v1",
    p_max: 3,
    p_window_seconds: 600,
  });
});

test("hit allowed: a failed count never blocks, and a missing function isn't logged", async () => {
  const { client, db } = fakeSupabase({});
  const logged: unknown[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => logged.push(a);
  try {
    // No rate_hit function yet: the code is live before its migration.
    assert.equal(await hitAllowed(client, limit), true);
    assert.equal(logged.length, 0);
    db.rpcs.rate_hit = () => ({ data: null, error: { message: "connection reset" } });
    assert.equal(await hitAllowed(client, limit), true);
    assert.equal(logged.length, 1);
  } finally {
    console.error = realError;
  }
});
