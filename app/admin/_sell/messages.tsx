"use client";

import { useMemo, useState } from "react";
import type { DbRecord, OrderRequest, ShopMessage, ShopMessageStatus } from "@/lib/supabase";
import { matchLines, parseOrderText } from "@/lib/order-parse";
import {
  bodyText,
  messageSummary,
  replyGreeting,
  replySubject,
  type LooseThread,
} from "@/lib/admin/messages";
import type { PhotoAttachment } from "@/lib/admin/attachments";
import { useAdmin } from "../_shell/admin-provider";
import { PhotoPicker } from "../_shell/photo-picker";
import { Pill } from "../_shell/primitives";
import { buttonClass, inputClass, timeAgo } from "../_shell/ui";
import type { PasteDmState } from "./paste-dm";
import type { Desk } from "./use-desk";

// Mail on the Sell page: the status writes, the thread display and reply
// box every conversation card shares, and the card for mail that belongs
// to no open request.

// Mark mail read, or archive it (with an Undo that puts each message back
// as it was).
export function useMail() {
  const { supabase, setMessages, setClosedMessages, restoreMessages, pushToast } = useAdmin();

  async function setStatus(mail: ShopMessage[], status: ShopMessageStatus) {
    if (mail.length === 0) return true;
    const { error } = await supabase
      .from("shop_messages")
      .update({ status, updated_at: new Date().toISOString() })
      .in(
        "id",
        mail.map((m) => m.id)
      );
    if (error) {
      pushToast("error", `Couldn't update the message: ${error.message}`);
      return false;
    }
    const ids = new Set(mail.map((m) => m.id));
    if (status === "archived") {
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
      setClosedMessages((prev) => [
        ...mail.map((m) => ({ ...m, status })),
        ...prev.filter((m) => !ids.has(m.id)),
      ]);
    } else {
      setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, status } : m)));
    }
    return true;
  }

  const markRead = (mail: ShopMessage[]) =>
    setStatus(
      mail.filter((m) => m.direction === "in" && m.status === "new"),
      "read"
    );

  async function archive(mail: ShopMessage[], who: string) {
    const inbound = mail.filter((m) => m.direction === "in");
    if (!(await setStatus(inbound, "archived"))) return;
    pushToast(
      "info",
      `${inbound.length === 1 ? "Message" : `${inbound.length} messages`} from ${who} archived.`,
      { label: "Undo", onClick: () => void restoreMessages(inbound) }
    );
  }

  return { setStatus, markRead, archive };
}

const SHOWN = 3;

// A conversation, oldest first: who wrote, when, and the gist — click a
// message for all of it. Long threads start at the last few.
export function Thread({ messages, buyer }: { messages: ShopMessage[]; buyer: string }) {
  const [all, setAll] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  if (messages.length === 0) return null;
  const hidden = all ? 0 : Math.max(0, messages.length - SHOWN);
  const shown = messages.slice(hidden);
  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="mt-3 space-y-2">
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-xs text-neutral-400 underline underline-offset-2 hover:text-white"
        >
          Show {hidden} earlier message{hidden === 1 ? "" : "s"}
        </button>
      ) : null}
      {shown.map((m) => {
        const mine = m.direction === "out";
        const open = openIds.has(m.id);
        const summary = messageSummary(m) || "(empty message)";
        return (
          <div
            key={m.id}
            className={`border-l-2 pl-3 text-sm ${
              mine ? "border-white/15" : m.status === "new" ? "border-amber-400" : "border-sky-400/50"
            }`}
          >
            <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span className={mine ? "text-neutral-400" : "text-sky-300"}>
                {mine ? "You" : m.from_name || buyer || m.from_email}
              </span>
              <span>{timeAgo(m.received_at)}</span>
              {!mine && m.status === "new" ? <Pill tone="amber">new</Pill> : null}
              {m.subject?.trim() ? (
                <span className="min-w-0 truncate" title={m.subject}>
                  {m.subject}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => toggle(m.id)}
              aria-expanded={open}
              title={open ? "Show less" : "Show the whole message"}
              className="mt-0.5 block w-full text-left text-neutral-300 transition hover:text-white"
            >
              {open ? (
                <span className="block max-h-96 overflow-auto whitespace-pre-wrap break-words">
                  {bodyText(m) || "(empty message)"}
                </span>
              ) : (
                summary
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// The reply box under a conversation: a draft as orders@, with photos of
// the records in play when there are any.
export function ReplyBox({
  to,
  name,
  records,
  onSend,
  onCancel,
}: {
  to: string;
  name: string | null | undefined;
  records: DbRecord[];
  // Resolves true once the mail went, so the box can close.
  onSend: (text: string, photos: PhotoAttachment[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => replyGreeting(name));
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSend(text, photos);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        autoFocus
        placeholder="Reply as orders@curiouserrecords.com…"
        aria-label={`Reply to ${name || to}`}
        className={`w-full ${inputClass}`}
      />
      {records.length > 0 ? (
        <PhotoPicker records={records} selected={photos} onChange={setPhotos} />
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!draft.trim() || busy}
          onClick={send}
        >
          {busy ? "Sending…" : `Send to ${to}`}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export const photoNote = (photos: PhotoAttachment[]) =>
  photos.length ? ` with ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "";

// Mail from one sender that isn't part of an open request: a question, a
// reply after the sale, an order typed straight into an email.
export function MailCard({
  thread,
  desk,
  paste,
  deskRecords,
}: {
  thread: LooseThread<ShopMessage>;
  desk: Desk;
  paste: PasteDmState;
  deskRecords: DbRecord[];
}) {
  const {
    supabase,
    records,
    orderRequests,
    setMessages,
    sendShopEmail,
    pushToast,
    setSaleBuyer,
    setSaleEmail,
    setSaleChannel,
  } = useAdmin();
  const mail = useMail();
  const [replyOpen, setReplyOpen] = useState(false);
  const latest = thread.latestIn;
  const who = thread.name || thread.email;
  const inbound = thread.messages.filter((m) => m.direction === "in");
  const replied = inbound.every((m) => m.status === "replied");

  // Photos offered on a reply: the records the latest message names, plus
  // whatever is on the desk.
  const replyRecords = useMemo(() => {
    if (!replyOpen) return [] as DbRecord[];
    const named = matchLines(parseOrderText(bodyText(latest)), records).flatMap((row) =>
      row.status === "matched" && row.match ? [row.match] : []
    );
    const seen = new Set<number>();
    return [...named, ...deskRecords].filter((r) =>
      seen.has(r.id) ? false : (seen.add(r.id), true)
    );
  }, [replyOpen, latest, records, deskRecords]);

  function openReply() {
    setReplyOpen(true);
    void mail.markRead(inbound);
  }

  async function sendReply(text: string, photos: PhotoAttachment[]) {
    const ok = await sendShopEmail({
      to: latest.from_email,
      subject: replySubject(latest.subject),
      text,
      inReplyTo: latest.message_id,
      messageId: latest.id,
      requestId: latest.request_id,
      attachments: photos.map(({ url, filename }) => ({ url, filename })),
    });
    if (!ok) return false;
    setMessages((prev) =>
      prev.map((x) => (x.id === latest.id ? { ...x, status: "replied" } : x))
    );
    setReplyOpen(false);
    pushToast("success", `Reply sent to ${latest.from_email}${photoNote(photos)} ✓`);
    return true;
  }

  // Put the records this mail is about on the desk: through its saved
  // request when a ref code matched one, else by reading the body like a
  // pasted DM. The sender becomes the desk's email buyer either way.
  async function loadIntoDesk() {
    const m = [...inbound].reverse().find((x) => x.request_id != null) ?? latest;
    const seedBuyer = () => {
      setSaleChannel("email");
      setSaleEmail((prev) => (prev.trim() ? prev : m.from_email));
      if (m.from_name) {
        const name = m.from_name;
        setSaleBuyer((prev) => (prev.trim() ? prev : name));
      }
    };
    if (m.request_id != null) {
      let req = orderRequests.find((r) => r.id === m.request_id) ?? null;
      if (!req) {
        const { data } = await supabase
          .from("order_requests")
          .select("*")
          .eq("id", m.request_id)
          .maybeSingle();
        req = (data as OrderRequest | null) ?? null;
      }
      if (req) {
        if (await desk.loadRequest(req)) seedBuyer();
        return;
      }
    }
    paste.parseMessage(m);
    seedBuyer();
  }

  return (
    <div
      className={`rounded-2xl border bg-white/5 p-4 ${
        thread.newCount > 0 ? "border-amber-400/30" : "border-white/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">{who}</span>
        {thread.name ? (
          <a
            href={`mailto:${thread.email}`}
            className="text-sm text-sky-300 underline-offset-2 hover:underline"
          >
            {thread.email}
          </a>
        ) : null}
        <Pill tone="sky">email</Pill>
        {thread.newCount > 0 ? (
          <Pill tone="amber">{thread.newCount} new</Pill>
        ) : replied ? (
          <Pill tone="green">replied</Pill>
        ) : null}
        {latest.ref_code ? (
          <span className="font-mono text-xs text-amber-300" title="Ref code in the message">
            {latest.ref_code}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-neutral-500">{timeAgo(latest.received_at)}</span>
      </div>
      <Thread messages={thread.messages} buyer={who} />
      {replyOpen ? (
        <ReplyBox
          to={latest.from_email}
          name={thread.name}
          records={replyRecords}
          onSend={sendReply}
          onCancel={() => setReplyOpen(false)}
        />
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {replyOpen ? null : (
          <button
            type="button"
            className={buttonClass}
            onClick={openReply}
            title={`Email ${latest.from_email} as orders@curiouserrecords.com`}
          >
            {replied ? "Reply again" : "Reply"}
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          onClick={loadIntoDesk}
          title="Find the records this mail is about and put them on the sale desk"
        >
          Load into sale desk
        </button>
        {thread.newCount > 0 ? (
          <button type="button" className={buttonClass} onClick={() => mail.markRead(inbound)}>
            Mark read
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass}
          onClick={() => mail.archive(inbound, who)}
          title="Done with this mail — it moves to Closed"
        >
          Archive
        </button>
      </div>
    </div>
  );
}
