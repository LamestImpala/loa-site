// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyText,
  findRefCode,
  latestEmailToOrder,
  latestReplyTo,
  messageSummary,
  orderEmailSubject,
  paymentReceivedText,
  replyGreeting,
  replySubject,
  requestForRef,
  requestReplySubject,
} from "./messages.ts";

test("ref code: Ref: line in the body, bare code in a reply subject, none otherwise", () => {
  assert.equal(findRefCode("hello", "…\nRef: cr-ab23\n"), "CR-AB23");
  assert.equal(findRefCode("Re: Got your record request (Ref CR-XY89)", null), "CR-XY89");
  assert.equal(findRefCode("CR-AB10 looks like one but has a 1 and 0", "nope"), null);
  assert.equal(requestForRef("CR-AB23", [{ id: 7, ref_code: "cr-ab23" }]), 7);
  assert.equal(requestForRef(null, [{ id: 7, ref_code: "CR-AB23" }]), null);
});

test("body text: prefers text, strips html safely", () => {
  assert.equal(bodyText({ text_body: "hi\r\nthere ", html_body: "<p>x</p>" }), "hi\nthere");
  assert.equal(
    bodyText({ text_body: null, html_body: "<style>p{}</style><p>Hi &amp; bye</p><script>evil()</script><div>Two<br>lines</div>" }),
    "Hi & bye\nTwo\nlines"
  );
});

test("summary: one line, quoted replies dropped, capped with an ellipsis", () => {
  const long = "a".repeat(400);
  assert.equal(messageSummary({ text_body: long, html_body: null }).length, 300);
  assert.equal(
    messageSummary({ text_body: "Yes please!\n\nOn Tue, Oct 21, 2026 at 3:00 PM Curiouser Records <orders@x.com> wrote:\n> quote", html_body: null }),
    "Yes please!"
  );
});

test("reply subject", () => {
  assert.equal(replySubject("Records"), "Re: Records");
  assert.equal(replySubject("RE: Records"), "RE: Records");
  assert.equal(replySubject(""), "Re: your record request");
});

test("request reply: greeting by first name, threaded subject with the ref code", () => {
  assert.equal(replyGreeting("Tommy Black"), "Hi Tommy!\n\n");
  assert.equal(replyGreeting("  "), "Hi!\n\n");
  assert.equal(replyGreeting(null), "Hi!\n\n");
  assert.equal(requestReplySubject("cr-822j"), "Re: Got your record request (Ref CR-822J)");
  assert.equal(findRefCode(requestReplySubject("CR-822J"), null), "CR-822J");
});

test("latest reply to a request: newest outbound row for that request only", () => {
  const sent = [
    { direction: "out" as const, request_id: 5, received_at: "2026-10-30T01:00:00Z" },
    { direction: "out" as const, request_id: 5, received_at: "2026-10-30T03:00:00Z" },
    { direction: "in" as const, request_id: 5, received_at: "2026-10-30T09:00:00Z" },
    { direction: "out" as const, request_id: 6, received_at: "2026-10-30T09:00:00Z" },
  ];
  assert.equal(latestReplyTo(sent, 5)?.received_at, "2026-10-30T03:00:00Z");
  assert.equal(latestReplyTo(sent, 7), null);
});

test("paid-order email: subject threads with the request when there is one", () => {
  assert.equal(orderEmailSubject("cr-822j"), "Re: Got your record request (Ref CR-822J)");
  assert.equal(orderEmailSubject(null), "Your Curiouser Records order");
});

test("payment received draft: names the records and the ship day", () => {
  const one = paymentReceivedText({ name: "Tommy Black", titles: ["Can – Tago Mago"] });
  assert.match(one, /^Hi Tommy!\n\nGot your payment for Can – Tago Mago — thank you!/);
  assert.match(one, /next couple of days/);
  const three = paymentReceivedText({
    name: null,
    titles: ["A", "B", "C"],
    shipsOn: "Thursday, Nov 12",
  });
  assert.match(three, /^Hi!\n\nGot your payment for A, B and C/);
  assert.match(three, /It'll ship Thursday, Nov 12, and PayPal/);
  assert.match(paymentReceivedText({ name: "x", titles: [] }), /payment for your order/);
});

test("latest email to an order: newest outbound row for that order only", () => {
  const sent = [
    { direction: "out" as const, order_id: 7, received_at: "2026-11-01T00:00:00Z" },
    { direction: "out" as const, order_id: 7, received_at: "2026-11-03T00:00:00Z" },
    { direction: "in" as const, order_id: 7, received_at: "2026-11-05T00:00:00Z" },
    { direction: "out" as const, order_id: 8, received_at: "2026-11-06T00:00:00Z" },
  ];
  assert.equal(latestEmailToOrder(sent, 7)?.received_at, "2026-11-03T00:00:00Z");
  assert.equal(latestEmailToOrder(sent, 9), null);
});
