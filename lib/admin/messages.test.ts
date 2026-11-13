// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyText,
  findRefCode,
  latestEmailToOrder,
  latestReplyTo,
  looseThreads,
  messageSummary,
  orderEmailSubject,
  paymentReceivedText,
  replyGreeting,
  replySubject,
  requestForRef,
  requestReplySubject,
  threadFor,
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

const mail = (
  id: number,
  direction: "in" | "out",
  at: string,
  over: Partial<{
    request_id: number | null;
    ref_code: string | null;
    from_email: string;
    from_name: string | null;
    to_email: string;
    status: "new" | "read" | "replied" | "archived";
    order_id: number | null;
  }> = {}
) => ({
  id,
  direction,
  received_at: at,
  request_id: null,
  ref_code: null,
  from_email: direction === "in" ? "amy@example.com" : "orders@curiouserrecords.com",
  from_name: direction === "in" ? "Amy" : "Curiouser Records",
  to_email: direction === "in" ? "orders@curiouserrecords.com" : "amy@example.com",
  status: (direction === "in" ? "read" : "archived") as "new" | "read" | "replied" | "archived",
  order_id: null,
  ...over,
});

test("a request's thread: its mail both ways, oldest first, by id or by ref code", () => {
  const req = { id: 5, ref_code: "CR-AB23" };
  const inbound = [
    mail(3, "in", "2026-11-03T00:00:00Z", { request_id: 5 }),
    mail(1, "in", "2026-11-01T00:00:00Z", { ref_code: "cr-ab23" }), // not filed, ref matches
    mail(4, "in", "2026-11-04T00:00:00Z", { request_id: 6, ref_code: "CR-AB23" }), // filed elsewhere
    mail(5, "in", "2026-11-05T00:00:00Z"), // no tie to the request
  ];
  const sent = [
    mail(2, "out", "2026-11-02T00:00:00Z", { request_id: 5 }),
    mail(3, "in", "2026-11-03T00:00:00Z", { request_id: 5 }), // the same row twice
    mail(6, "out", "2026-11-06T00:00:00Z", { request_id: 6 }),
  ];
  assert.deepEqual(threadFor(req, inbound, sent).map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(threadFor({ id: 9, ref_code: "CR-ZZZZ" }, inbound, sent), []);
});

test("loose mail: one conversation per sender, minus what an open request already shows", () => {
  const open = [{ id: 5, ref_code: "CR-AB23" }];
  const inbound = [
    mail(1, "in", "2026-11-01T00:00:00Z", { request_id: 5 }), // in the request's card
    mail(2, "in", "2026-11-02T00:00:00Z", { status: "new" }),
    mail(3, "in", "2026-11-04T00:00:00Z", { from_email: "Amy@Example.com", from_name: null, status: "new" }),
    mail(4, "in", "2026-11-03T00:00:00Z", { from_email: "bo@example.com", from_name: "Bo", request_id: 8 }), // closed request
  ];
  const sent = [
    mail(10, "out", "2026-11-02T12:00:00Z"), // answer to Amy
    mail(11, "out", "2026-11-02T13:00:00Z", { request_id: 5 }), // the request's thread
    mail(12, "out", "2026-11-02T14:00:00Z", { order_id: 3 }), // a paid-order note
    mail(13, "out", "2026-11-02T15:00:00Z", { to_email: "cy@example.com" }), // nobody wrote in
  ];
  const threads = looseThreads(inbound, sent, open);
  assert.deepEqual(threads.map((t) => t.email), ["amy@example.com", "bo@example.com"]);
  assert.deepEqual(threads[0].messages.map((m) => m.id), [2, 10, 3]);
  assert.equal(threads[0].latestIn.id, 3);
  assert.equal(threads[0].name, "Amy", "falls back to a name from an earlier message");
  assert.equal(threads[0].newCount, 2);
  assert.equal(threads[1].newCount, 0);
  assert.deepEqual(looseThreads([], sent, open), []);
});
