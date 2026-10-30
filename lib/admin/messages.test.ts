// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyText,
  findRefCode,
  latestReplyTo,
  messageSummary,
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
