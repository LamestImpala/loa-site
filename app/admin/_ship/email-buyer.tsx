"use client";

import { useState } from "react";
import type { DbRecord, Order } from "@/lib/supabase";
import type { PhotoAttachment } from "@/lib/admin/attachments";
import {
  latestEmailToOrder,
  paymentReceivedText,
  replyGreeting,
} from "@/lib/admin/messages";
import { fetchShippingPause, formatShipDay } from "@/lib/shipping-pause";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, inputClass } from "../_shell/ui";
import { PhotoPicker } from "../_shell/photo-picker";

// Email an email-form buyer about their paid order, as
// orders@curiouserrecords.com — from the order's Ship card, or from Just
// paid on the Sell page for the "got your payment" note. The server files
// the note against the order and threads it with the buyer's request, so
// their reply lands back under Conversations on the Sell page. Renders the
// button inline and the compose box on its own line (inside a flex-wrap row).
export function EmailBuyer({
  order,
  email,
  buyer,
  records,
  paid,
}: {
  order: Order;
  email: string;
  buyer: string;
  records: DbRecord[];
  paid: boolean;
}) {
  const { supabase, sentMessages, sendShopEmail, pushToast } = useAdmin();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const last = latestEmailToOrder(sentMessages, order.id);

  function toggle() {
    const opening = !open;
    setOpen(opening);
    setDraft(opening ? replyGreeting(buyer) : "");
    setPhotos([]);
  }

  async function fillPaymentReceived() {
    setBusy("draft");
    try {
      const pause = await fetchShippingPause(supabase);
      setDraft(
        paymentReceivedText({
          name: buyer,
          titles: records.map((r) => `${r.artist} – ${r.title}`),
          shipsOn: pause ? formatShipDay(pause.shipsOn) : null,
        })
      );
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy("send");
    try {
      const ok = await sendShopEmail({
        to: email,
        text,
        orderId: order.id,
        attachments: photos.map(({ url, filename }) => ({ url, filename })),
      });
      if (ok) {
        const n = photos.length;
        pushToast(
          "success",
          `Emailed ${email}${n ? ` with ${n} photo${n === 1 ? "" : "s"}` : ""} ✓`
        );
        setOpen(false);
        setDraft("");
        setPhotos([]);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={busy === "send"}
        title={`Email ${email} as orders@curiouserrecords.com — replies come back to Conversations on the Sell page`}
        className={buttonClass}
      >
        {open ? "Close email" : last ? "Email buyer again" : "Email buyer"}
      </button>
      {last && !open ? (
        <span
          className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-400"
          title={last.text_body ?? undefined}
        >
          ✓ Emailed {new Date(last.received_at).toLocaleDateString()}
        </span>
      ) : null}
      {open ? (
        <div className="basis-full">
          {paid ? (
            <button
              type="button"
              onClick={fillPaymentReceived}
              disabled={busy !== null}
              title="Fill in a thank-you for the payment that lists the records and when they ship"
              className={`mb-2 ${buttonClass}`}
            >
              {busy === "draft" ? "Filling…" : "Payment received"}
            </button>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Email as orders@curiouserrecords.com…"
            aria-label={`Email ${buyer || email}`}
            className={`w-full ${inputClass}`}
          />
          {records.length > 0 ? (
            <PhotoPicker records={records} selected={photos} onChange={setPhotos} />
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || busy !== null}
              className={buttonClass}
            >
              {busy === "send" ? "Sending…" : `Send to ${email}`}
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={busy === "send"}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
