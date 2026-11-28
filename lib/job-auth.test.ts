// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminToken,
  authorizeJob,
  bearerToken,
  requireAdmin,
  sameSecret,
  type EmailLookup,
} from "./job-auth.ts";
import { ADMIN_EMAIL } from "./supabase.ts";

// An unsigned token shaped like Supabase's. The auth server is what tells
// real from forged; here `lookup` plays it.
function fakeToken(payload: unknown): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.sig`;
}

const req = (token?: string) =>
  new Request("https://shop.test/api/x", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

const owner: EmailLookup = async () => ADMIN_EMAIL;
const stranger: EmailLookup = async () => "player@example.com";
const rejected: EmailLookup = async () => null;
// A lookup that must not be reached.
const unreachable: EmailLookup = async () => {
  throw new Error("the auth server should not have been asked");
};

const aal1 = fakeToken({ aal: "aal1", email: ADMIN_EMAIL });
const aal2 = fakeToken({ aal: "aal2", email: ADMIN_EMAIL });

test("bearer token: with or without the scheme, trimmed, empty when missing", () => {
  assert.equal(bearerToken(req("abc")), "abc");
  assert.equal(bearerToken(new Request("https://shop.test", { headers: { authorization: "bearer  abc " } })), "abc");
  assert.equal(bearerToken(new Request("https://shop.test", { headers: { authorization: "abc" } })), "abc");
  assert.equal(bearerToken(req()), "");
});

test("admin token: the owner past the second step, and nobody else", async () => {
  assert.equal(await adminToken(req(aal2), owner), aal2);
  // No token at all.
  assert.equal(await adminToken(req(), unreachable), null);
  // The owner's password or magic link alone: refused before asking.
  assert.equal(await adminToken(req(aal1), unreachable), null);
  // A token with no level, or junk.
  assert.equal(await adminToken(req(fakeToken({ email: ADMIN_EMAIL })), unreachable), null);
  assert.equal(await adminToken(req("not-a-token"), unreachable), null);
  // Another account that has its own authenticator (a pick'em player).
  assert.equal(await adminToken(req(fakeToken({ aal: "aal2" })), stranger), null);
  // A forged token claiming everything: the auth server doesn't know it.
  assert.equal(await adminToken(req(aal2), rejected), null);
});

test("require admin: a client for the owner, null for the rest", async () => {
  assert.ok(await requireAdmin(req(aal2), owner));
  assert.equal(await requireAdmin(req(aal1), owner), null);
  assert.equal(await requireAdmin(req(aal2), stranger), null);
  assert.equal(await requireAdmin(req(), owner), null);
});

test("authorize job: the cron secret still works, the owner needs the second step", async () => {
  const before = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "cron-secret-for-this-test";
    assert.equal(await authorizeJob(req("cron-secret-for-this-test"), unreachable), true);
    assert.equal(await authorizeJob(req("wrong-secret"), unreachable), false);
    // Near misses: a prefix, a longer string, one character off.
    assert.equal(await authorizeJob(req("cron-secret-for-this-tes"), unreachable), false);
    assert.equal(await authorizeJob(req("cron-secret-for-this-test!"), unreachable), false);
    assert.equal(await authorizeJob(req("cron-secret-for-this-tesT"), unreachable), false);
    assert.equal(await authorizeJob(req(), unreachable), false);
    assert.equal(await authorizeJob(req(aal2), owner), true);
    assert.equal(await authorizeJob(req(aal1), owner), false);
    assert.equal(await authorizeJob(req(aal2), stranger), false);
    // No secret configured: an empty token must not match it.
    delete process.env.CRON_SECRET;
    assert.equal(await authorizeJob(req(""), unreachable), false);
    assert.equal(await authorizeJob(req(aal2), owner), true);
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});

test("same secret: equal strings only, whatever their lengths", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  // Different lengths must answer false, not throw.
  assert.equal(sameSecret("abc", "abcd"), false);
  assert.equal(sameSecret("", "abc"), false);
  assert.equal(sameSecret("", ""), true);
  assert.equal(sameSecret("clé-secrète", "clé-secrète"), true);
});
