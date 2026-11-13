"use client";

import { useMemo, useState } from "react";
import { itemSpecShort } from "@/lib/items";
import type { DbRecord, OrderRequest, ShopMessage } from "@/lib/supabase";
import { recordFlags } from "@/lib/order-parse";
import { requestProgress } from "@/lib/admin/sales";
import { latestReplyTo, requestReplySubject } from "@/lib/admin/messages";
import type { PhotoAttachment } from "@/lib/admin/attachments";
import { useAdmin } from "../_shell/admin-provider";
import { Pill } from "../_shell/primitives";
import { buttonClass, timeAgo, useCopied } from "../_shell/ui";
import { ReplyBox, Thread, photoNote, useMail } from "./messages";
import type { Desk } from "./use-desk";

// One request from the shop with everything said about it: what the buyer
// asked for, their emails and the replies sent as orders@, in one card.
// From here it's loaded onto the sale desk, answered, or closed.
export function RequestCard({
  req,
  thread,
  invoiced,
  desk,
}: {
  req: OrderRequest;
  thread: ShopMessage[]; // its mail both ways, oldest first
  invoiced: boolean; // some of its records are on a live PayPal invoice
  desk: Desk;
}) {
  const { byId, sentMessages, setMessages, sendShopEmail, closeRequest, pushToast, copyText } =
    useAdmin();
  const mail = useMail();
  const { isCopied, flash } = useCopied();
  const [replyOpen, setReplyOpen] = useState(false);

  const inbound = thread.filter((m) => m.direction === "in");
  const latestIn = inbound[inbound.length - 1] ?? null;
  const newMail = inbound.filter((m) => m.status === "new").length;
  // Who a reply goes to: whoever last wrote in about it, else the address
  // the buyer gave the shop's email form. A Reddit request has neither.
  const replyTo = latestIn?.from_email ?? (req.channel === "email" ? req.buyer_email : null);
  const replied = latestReplyTo(sentMessages, req.id);
  // The buyer wrote after the last reply: the ball is back with the seller.
  const awaitingReply =
    latestIn != null && (!replied || latestIn.received_at > replied.received_at);

  const progress = requestProgress(req, byId);
  const unavailable = req.record_ids.filter((id) => {
    const r = byId.get(id);
    return !r || r.sold;
  }).length;
  const partlySold = progress.sold > 0 && progress.sold < progress.total;
  const requestRecords = useMemo(
    () =>
      req.record_ids.flatMap((id) => {
        const r = byId.get(id);
        return r ? [r] : ([] as DbRecord[]);
      }),
    [req.record_ids, byId]
  );
  const buyerName =
    req.channel === "email" ? req.buyer_name || req.buyer_email || "" : req.buyer_username || "";

  async function copyRef() {
    if (await copyText(req.ref_code, "Copy the ref code")) flash("ref");
  }

  function openReply() {
    setReplyOpen(true);
    void mail.markRead(inbound);
  }

  // The subject always carries the ref code, so the buyer's answer files
  // back to this request; In-Reply-To threads it under their last message.
  async function sendReply(text: string, photos: PhotoAttachment[]) {
    if (!replyTo) return false;
    const ok = await sendShopEmail({
      to: replyTo,
      subject: requestReplySubject(req.ref_code),
      text,
      requestId: req.id,
      inReplyTo: latestIn?.message_id ?? null,
      messageId: latestIn?.id,
      attachments: photos.map(({ url, filename }) => ({ url, filename })),
    });
    if (!ok) return false;
    if (latestIn) {
      setMessages((prev) =>
        prev.map((x) => (x.id === latestIn.id ? { ...x, status: "replied" } : x))
      );
    }
    setReplyOpen(false);
    pushToast("success", `Reply sent to ${replyTo}${photoNote(photos)} ✓`);
    return true;
  }

  const attention = req.status === "new" || newMail > 0;

  return (
    <div
      className={`rounded-2xl border bg-white/5 p-4 ${
        attention ? "border-amber-400/30" : "border-white/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyRef}
          title="Copy ref code"
          className="font-mono text-sm text-amber-300 transition hover:text-amber-100"
        >
          {isCopied("ref") ? "Copied!" : req.ref_code}
        </button>
        {req.status === "new" ? <Pill tone="amber">new</Pill> : null}
        <span
          title={req.channel === "email" ? "Sent from the shop's email form" : "Sent as a Reddit DM"}
        >
          <Pill tone={req.channel === "email" ? "sky" : "neutral"}>
            {req.channel === "email" ? "email" : "reddit"}
          </Pill>
        </span>
        {req.channel === "email" ? (
          <span className="text-sm text-white">
            {req.buyer_name ? `${req.buyer_name} · ` : ""}
            <a
              href={`mailto:${req.buyer_email}`}
              className="text-sky-300 underline-offset-2 hover:underline"
            >
              {req.buyer_email}
            </a>
          </span>
        ) : req.buyer_username ? (
          <span className="text-sm text-white">u/{req.buyer_username}</span>
        ) : (
          <span className="text-xs text-neutral-500">no username given</span>
        )}
        {newMail > 0 ? (
          <Pill tone="amber">
            {newMail} new email{newMail === 1 ? "" : "s"}
          </Pill>
        ) : awaitingReply ? (
          <Pill tone="amber">buyer wrote last</Pill>
        ) : replied ? (
          <span title={replied.subject ?? undefined}>
            <Pill tone="green">replied {timeAgo(replied.received_at)}</Pill>
          </span>
        ) : null}
        {invoiced ? <Pill tone="green">invoice sent</Pill> : null}
        {partlySold ? (
          <Pill tone="amber">
            {progress.sold} of {progress.total} sold
          </Pill>
        ) : null}
        <span className="ml-auto text-xs text-neutral-500">{timeAgo(req.created_at)}</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {req.items.map((it) => {
          const r = byId.get(it.id);
          const flags = r ? recordFlags(r, it.price) : ["no longer in the system"];
          return (
            <li key={it.id}>
              {it.artist} — {it.title}{" "}
              <span className="text-neutral-500">{itemSpecShort(it)}</span> — ${it.price}
              {flags.length > 0 ? (
                <span className="text-amber-400"> · {flags.join(" · ")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-neutral-400">
        Subtotal ${req.subtotal} · Shipping ${req.shipping} ·{" "}
        <span className="font-medium text-white">Total ${req.total}</span>
      </p>
      {partlySold ? (
        <p className="mt-1 text-xs text-amber-400">
          Part of this request has sold; the rest is still for sale. Close it
          if the buyer is done.
        </p>
      ) : unavailable > 0 ? (
        <p className="mt-1 text-xs text-amber-400">
          {unavailable} of {req.record_ids.length} unavailable — won&rsquo;t go
          on the desk.
        </p>
      ) : null}
      {req.message ? (
        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-white/15 pl-3 text-sm text-neutral-300">
          {req.message}
        </blockquote>
      ) : null}
      <Thread messages={thread} buyer={buyerName} />
      {replyOpen && replyTo ? (
        <ReplyBox
          to={replyTo}
          name={latestIn?.from_name ?? req.buyer_name}
          records={requestRecords}
          onSend={sendReply}
          onCancel={() => setReplyOpen(false)}
        />
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {replyTo && !replyOpen ? (
          <button
            type="button"
            className={buttonClass}
            onClick={openReply}
            title={`Email ${replyTo} as orders@curiouserrecords.com`}
          >
            {replied ? "Reply again" : "Reply"}
          </button>
        ) : null}
        <button type="button" className={buttonClass} onClick={() => desk.loadRequest(req)}>
          Load into sale desk
        </button>
        {newMail > 0 ? (
          <button type="button" className={buttonClass} onClick={() => mail.markRead(inbound)}>
            Mark read
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass}
          onClick={() => closeRequest(req, "completed")}
          title="The sale is settled — the request and its emails move to Closed"
        >
          Close
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => closeRequest(req, "dismissed")}
          title="Not going anywhere — the request and its emails move to Closed"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
