// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminNotificationEmail,
  adminPaidNotificationEmail,
  buyerConfirmationEmail,
  parseOrderRequestBody,
} from "./order-request.ts";

const good = { record_ids: [3, 1, 3], buyer_email: " Jane@Example.com ", buyer_name: " Jane ", message: "" };

test("order request body: ids deduped, email lowercased, blanks become null", () => {
  const r = parseOrderRequestBody(good);
  assert.ok(r.ok && !("honeypot" in r));
  if (r.ok && "body" in r) {
    assert.deepEqual(r.body, {
      recordIds: [3, 1],
      buyerName: "Jane",
      buyerEmail: "jane@example.com",
      message: null,
    });
  }
});

test("order request body: rejects bad ids and emails; honeypot short-circuits", () => {
  assert.equal(parseOrderRequestBody({ ...good, record_ids: [] }).ok, false);
  assert.equal(parseOrderRequestBody({ ...good, record_ids: [1.5] }).ok, false);
  assert.equal(parseOrderRequestBody({ ...good, record_ids: Array.from({ length: 41 }, (_, i) => i + 1) }).ok, false);
  assert.equal(parseOrderRequestBody({ ...good, buyer_email: "nope" }).ok, false);
  assert.equal(parseOrderRequestBody({ ...good, buyer_email: "a b@c.d" }).ok, false);
  assert.equal(parseOrderRequestBody(null).ok, false);
  const bot = parseOrderRequestBody({ ...good, website: "http://spam" });
  assert.ok(bot.ok && "honeypot" in bot);
});

test("order request body: name and note are trimmed and capped", () => {
  const r = parseOrderRequestBody({ ...good, buyer_name: "x".repeat(100), message: " y".repeat(600) });
  assert.ok(r.ok && "body" in r);
  if (r.ok && "body" in r) {
    assert.equal(r.body.buyerName?.length, 80);
    assert.equal(r.body.message?.length, 1000);
  }
});

const args = {
  refCode: "CR-AB23",
  buyerName: "Jane",
  buyerEmail: "jane@example.com",
  message: "Can you hold till Friday?",
  items: [
    { artist: "Can", title: "Ege Bamyasi", media: "NM", sleeve: "VG+", price: 30 },
    { artist: "Neu!", title: "Neu! 2", media: "VG+", sleeve: "VG", price: 20 },
  ],
};

test("admin notification: who, what, total, ref, and reply-to the buyer", () => {
  const m = adminNotificationEmail(args);
  assert.equal(m.to, "brandoncgillihan@gmail.com");
  assert.equal(m.replyTo, "jane@example.com");
  assert.equal(m.subject, "New record request CR-AB23 from Jane — $56");
  assert.match(m.text, /Jane <jane@example.com> wants to buy 2 records \(Ref: CR-AB23\)/);
  assert.match(m.text, /1\. Can — Ege Bamyasi/);
  assert.match(m.text, /Shipping: \$6\nTotal: \$56/);
  assert.match(m.text, /Their note:\nCan you hold till Friday\?/);
  assert.match(m.text, /https:\/\/www\.lateonsetaudiophile\.com\/admin\/sell#requests/);
  assert.match(m.html, /<blockquote>Can you hold till Friday\?<\/blockquote>/);
});

test("buyer confirmation: greets by name, carries the ref and quote, replies go to orders@", () => {
  const m = buyerConfirmationEmail(args);
  assert.equal(m.to, "jane@example.com");
  assert.equal(m.replyTo, "orders@curiouserrecords.com");
  assert.equal(m.subject, "Got your record request (Ref CR-AB23)");
  assert.match(m.text, /^Hi Jane!/);
  assert.match(m.text, /Ref: CR-AB23/);
  assert.match(m.text, /Total: \$56/);
  const anon = buyerConfirmationEmail({ ...args, buyerName: null, message: null });
  assert.match(anon.text, /^Hi!/);
  assert.ok(!anon.text.includes("Your note"));
  assert.ok(!anon.html.includes("<script"), "html escaped");
  const sneaky = buyerConfirmationEmail({ ...args, message: "<script>x</script>" });
  assert.ok(!sneaky.html.includes("<script>"));
});

test("buyer confirmation: carries the away notice only when a pause is set", () => {
  const shippingPause = { from: "2026-11-03", until: "2026-11-11", shipsOn: "2026-11-12", note: "" };
  const m = buyerConfirmationEmail({ ...args, shippingPause });
  assert.match(m.text, /\nHeads up: I'm away Nov 3–11\. Anything requested in that window ships Thursday, Nov 12\.\n/);
  assert.match(m.html, /<p><strong>Heads up: I'm away Nov 3–11\. Anything requested in that window ships Thursday, Nov 12\.<\/strong><\/p>/);
  assert.doesNotMatch(buyerConfirmationEmail(args).text, /I'm away/);
  assert.doesNotMatch(adminNotificationEmail({ ...args, shippingPause }).text, /I'm away/);
});

test("paid notice: who paid, what to pull, and the pick list on the admin host", () => {
  const m = adminPaidNotificationEmail({
    buyer: "Jane",
    buyerEmail: "jane@example.com",
    invoiceId: "INV2-AAAA",
    total: 56,
    items: [
      { artist: "Can", title: "Ege Bamyasi", price: 30 },
      { artist: "Neu!", title: "Neu! 2", price: null },
    ],
  });
  assert.equal(m.to, "brandoncgillihan@gmail.com");
  assert.equal(m.replyTo, "jane@example.com");
  assert.equal(m.subject, "Paid: Jane — $56 (2 items)");
  assert.match(m.text, /Jane <jane@example.com> paid PayPal invoice INV2-AAAA \(\$56\)\./);
  assert.match(m.text, /1\. Can — Ege Bamyasi — \$30\n2\. Neu! — Neu! 2\n/);
  assert.match(m.text, /https:\/\/www\.lateonsetaudiophile\.com\/admin\/pick/);
});

test("paid notice: a Reddit buyer has no reply-to; an order with nothing left says so", () => {
  const m = adminPaidNotificationEmail({
    buyer: "amy<b>",
    buyerEmail: null,
    invoiceId: "INV2-BBBB",
    total: null,
    items: [],
  });
  assert.equal("replyTo" in m, false);
  assert.equal(m.subject, "Paid: amy<b>");
  assert.match(m.text, /^u\/amy<b> paid PayPal invoice INV2-BBBB\./);
  assert.match(m.text, /already sold or moved/);
  assert.match(m.text, /\/admin\/ship/);
  assert.match(m.html, /u\/amy&lt;b&gt; paid/);
});
