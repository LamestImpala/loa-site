import type { Shipment } from "../supabase.ts";
import type { AfterSaleItem } from "./after-sale.ts";
import { handDelivered } from "./fulfillment.ts";

// Where an order's mailed boxes stand, from carrier tracking
// (/api/delivery-check), for the order card's header badge and delivery
// banner. Pure — no React, no Supabase.

export type DeliveryKind = "delivered" | "transit" | "returning" | "problem";

export type DeliveryStatus = {
  kind: DeliveryKind;
  at: string | null; // when the last box was delivered (kind "delivered")
  where: string | null; // the carrier's words, tidied: "at the front door, Olympia, WA"
  delivered: number; // mailed boxes delivered
  total: number; // mailed boxes
};

type Box = Pick<Shipment, "sent_at" | "mode"> &
  Pick<Shipment, "delivered_at" | "tracking_status" | "tracking_detail" | "tracking_checked_at">;

// Shippo passes on USPS's sentence and adds the place:
// "Your shipment has been delivered at the front door. — Olympia, WA".
// The banner already says "Delivered", so that part goes.
export function carrierWords(detail: string | null | undefined): string | null {
  const raw = (detail ?? "").trim();
  if (!raw) return null;
  const [said, ...place] = raw.split(" — ");
  const words = said
    .replace(/^your (shipment|package|item) (has been |has |was |is )?/i, "")
    .replace(/^delivered,?\s*/i, "")
    .replace(/[.\s]+$/, "")
    .trim();
  const out = [words, place.join(" — ").trim()].filter(Boolean).join(", ");
  return out || null;
}

// Null until tracking has looked at one of the order's mailed boxes —
// orders from before tracking, and boxes handed over, keep their usual pill.
export function deliveryStatus(boxes: Box[]): DeliveryStatus | null {
  const mailed = boxes.filter((s) => !handDelivered(s) && !!s.sent_at);
  const tracked = mailed.filter((s) => !!s.tracking_checked_at || !!s.delivered_at);
  if (tracked.length === 0) return null;
  const done = mailed.filter((s) => !!s.delivered_at);
  const base = { delivered: done.length, total: mailed.length };
  if (done.length === mailed.length) {
    const last = done.reduce((a, b) => (b.delivered_at! > a.delivered_at! ? b : a));
    return { ...base, kind: "delivered", at: last.delivered_at!, where: carrierWords(last.tracking_detail) };
  }
  const waiting = mailed.filter((s) => !s.delivered_at);
  const worst =
    waiting.find((s) => s.tracking_status === "FAILURE") ??
    waiting.find((s) => s.tracking_status === "RETURNED") ??
    waiting.find((s) => !!s.tracking_status) ??
    waiting[0];
  const kind: DeliveryKind =
    worst.tracking_status === "FAILURE"
      ? "problem"
      : worst.tracking_status === "RETURNED"
        ? "returning"
        : "transit";
  return { ...base, kind, at: null, where: carrierWords(worst.tracking_detail) };
}

// "Nov 27", in the shop's time zone (as deliveredDay in lib/delivery.ts).
export const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

// The header badge's words.
export function deliveryBadge(s: DeliveryStatus): string {
  switch (s.kind) {
    case "delivered":
      return `Delivered ${shortDay(s.at!)}`;
    case "transit":
      return s.delivered > 0 ? `${s.delivered} of ${s.total} delivered` : "In transit";
    case "returning":
      return "Returning to you";
    case "problem":
      return "Delivery problem";
  }
}

// What the review ask is doing, said for the banner — from the order's
// after-sale "Review asked" line. Reddit buyers with the box delivered
// get "your move": that's the moment to send the DM.
export function reviewNote(item: AfterSaleItem | undefined, s: DeliveryStatus): string | null {
  if (!item) return null;
  if (item.state === "scheduled") {
    const m = item.detail.match(/emails itself (by )?([A-Z][a-z]{2} \d{1,2})/);
    if (m) return `review email goes ${m[1] ? "by " : ""}${m[2]}`;
    return item.detail;
  }
  if (item.state === "done") {
    return item.detail === "review received" ? "review received" : `review ${item.detail}`;
  }
  if (/copy a review DM/.test(item.detail)) {
    return s.kind === "delivered" ? "your move: send the review DM" : null;
  }
  return item.detail;
}

// The Reddit callout: the box is delivered, there's no email to send
// itself, and no review link has been made yet.
export function reviewDmDue(item: AfterSaleItem | undefined, s: DeliveryStatus | null): boolean {
  return !!item && !!s && s.kind === "delivered" && item.state === "todo" && /copy a review DM/.test(item.detail);
}
