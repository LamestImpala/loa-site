// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCode,
  groupSecret,
  nextFactorName,
  tokenAal,
  twoStepFor,
  verifiedTotp,
} from "./mfa.ts";

// An unsigned token shaped like Supabase's: header.payload.signature, each
// part base64url without padding.
function fakeToken(payload: unknown): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.sig`;
}

const totp = (id: string, status: string, friendly_name?: string) => ({
  id,
  factor_type: "totp",
  status,
  friendly_name,
});

test("token aal: reads the claim, null for anything that isn't a token with one", () => {
  assert.equal(tokenAal(fakeToken({ aal: "aal1", email: "a@b.c" })), "aal1");
  assert.equal(tokenAal(fakeToken({ aal: "aal2" })), "aal2");
  // base64url characters (- and _) and non-ASCII text in the payload
  assert.equal(tokenAal(fakeToken({ note: "??>>~~ ünï", aal: "aal2" })), "aal2");
  assert.equal(tokenAal(fakeToken({ email: "a@b.c" })), null);
  assert.equal(tokenAal(fakeToken({ aal: 2 })), null);
  assert.equal(tokenAal(fakeToken("aal2")), null);
  assert.equal(tokenAal(""), null);
  assert.equal(tokenAal(null), null);
  assert.equal(tokenAal(undefined), null);
  assert.equal(tokenAal("not-a-token"), null);
  assert.equal(tokenAal("a.%%%.c"), null);
});

test("verified totp: only confirmed authenticator apps count", () => {
  const list = [
    totp("a", "verified"),
    totp("b", "unverified"),
    { id: "c", factor_type: "phone", status: "verified" },
  ];
  assert.deepEqual(verifiedTotp(list).map((f) => f.id), ["a"]);
  assert.deepEqual(verifiedTotp(null), []);
  assert.deepEqual(verifiedTotp(undefined), []);
});

test("two-step: only a session that has given a code gets in", () => {
  // No authenticator yet: set one up first.
  assert.equal(twoStepFor("aal1", []), "setup");
  assert.equal(twoStepFor("aal1", null), "setup");
  // Started but never confirmed: same as none.
  assert.equal(twoStepFor("aal1", [totp("a", "unverified")]), "setup");
  assert.equal(twoStepFor(null, []), "setup");
  // Set up, session is password- or magic-link-only: ask.
  assert.equal(twoStepFor("aal1", [totp("a", "verified")]), "challenge");
  // A token with no readable level is treated as not having passed.
  assert.equal(twoStepFor(null, [totp("a", "verified")]), "challenge");
  // Code already given this session.
  assert.equal(twoStepFor("aal2", [totp("a", "verified")]), "ok");
});

test("clean code: digits only, six at most", () => {
  assert.equal(cleanCode("123456"), "123456");
  assert.equal(cleanCode(" 123 456 "), "123456");
  assert.equal(cleanCode("12-34-56-78"), "123456");
  assert.equal(cleanCode("abc"), "");
});

test("next factor name: never one the account already has", () => {
  assert.equal(nextFactorName([]), "Authenticator app");
  assert.equal(nextFactorName(null), "Authenticator app");
  assert.equal(nextFactorName([totp("a", "verified", "Phone")]), "Authenticator app");
  assert.equal(
    nextFactorName([totp("a", "verified", "authenticator APP ")]),
    "Authenticator app 2"
  );
  assert.equal(
    nextFactorName([
      totp("a", "verified", "Authenticator app"),
      totp("b", "unverified", "Authenticator app 2"),
    ]),
    "Authenticator app 3"
  );
});

test("group secret: fours, no trailing space", () => {
  assert.equal(groupSecret("ABCDEFGHIJKLMNOP"), "ABCD EFGH IJKL MNOP");
  assert.equal(groupSecret("ABCDEFGHIJ"), "ABCD EFGH IJ");
  assert.equal(groupSecret("ABCD EFGH"), "ABCD EFGH");
  assert.equal(groupSecret(""), "");
});
