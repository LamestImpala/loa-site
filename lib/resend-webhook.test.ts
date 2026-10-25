// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { signSvix, verifySvixSignature } from "./resend-webhook.ts";

const secret = "whsec_" + Buffer.from("a-32-byte-test-signing-key-here!").toString("base64");
const body = '{"type":"email.received","data":{"email_id":"abc"}}';
const headers = (sig: string, ts = "1700000000") => ({
  id: "msg_123",
  timestamp: ts,
  signature: sig,
});
const now = 1700000000;

test("svix: a correctly signed body verifies, any other does not", () => {
  const sig = signSvix(secret, "msg_123", "1700000000", body);
  assert.ok(verifySvixSignature(secret, headers(`v1,${sig}`), body, now));
  assert.ok(!verifySvixSignature(secret, headers(`v1,${sig}`), body + " ", now), "body changed");
  assert.ok(!verifySvixSignature(secret, headers(`v1,${sig}`.replace(/.$/, "A")), body, now), "sig changed");
  assert.ok(!verifySvixSignature("whsec_" + Buffer.from("other-key").toString("base64"), headers(`v1,${sig}`), body, now), "wrong secret");
});

test("svix: several signatures during rotation — one match is enough; unknown versions are skipped", () => {
  const sig = signSvix(secret, "msg_123", "1700000000", body);
  assert.ok(verifySvixSignature(secret, headers(`v1,AAAA v1,${sig}`), body, now));
  assert.ok(!verifySvixSignature(secret, headers(`v2,${sig}`), body, now));
});

test("svix: stale or missing timestamps and headers are rejected", () => {
  const sig = signSvix(secret, "msg_123", "1700000000", body);
  assert.ok(!verifySvixSignature(secret, headers(`v1,${sig}`), body, now + 6 * 60), "too old");
  assert.ok(!verifySvixSignature(secret, { ...headers(`v1,${sig}`), timestamp: null }, body, now));
  assert.ok(!verifySvixSignature(secret, { ...headers(`v1,${sig}`), id: null }, body, now));
  assert.ok(!verifySvixSignature("", headers(`v1,${sig}`), body, now), "no secret configured");
});
