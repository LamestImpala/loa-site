/*
 * Seller info for the /records marketplace page and the Reddit table.
 *
 * NOTE: The record listings themselves live in Supabase and are managed
 * from /admin — this file only holds the seller details shown in the
 * page header, the pre-filled Reddit messages, and the markdown table.
 * (The original seed data that used to live here is in git history:
 * see lib/records.ts before commit "Add cover art, A-Z browser…".)
 */

import type { ItemDetails, ItemKind } from "./supabase";
import {
  KIND_ORDER,
  RECORDS_PER_PARCEL,
  itemSpecLine,
  kindOf,
  shippingDetail,
  shippingFor,
  shippingNote,
} from "./items.ts";

// A–Z browser shared by /records and /admin
export const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

export function artistLetter(artist: string) {
  const first = artist.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

// Shipping rules and the per-kind helpers live in lib/items.ts; the
// constants stay importable from here for the pages that always did.
export {
  FREE_SHIPPING_MIN,
  POSTER_TUBE_RATE,
  RECORDS_PER_PARCEL,
  SHIPPING_PER_PARCEL,
  combinedShipping,
} from "./items.ts";

export type BundleItem = {
  kind?: ItemKind; // absent = record
  artist: string;
  title: string;
  media: string;
  sleeve: string;
  condition?: string | null; // posters and gear
  details?: ItemDetails | null;
  price: number; // what the buyer pays for it
  listedPrice?: number; // the listed price, when the sale price was negotiated
};

// Itemized quote for a set of items — the one formatter for the shop's
// combined "Request to buy" DM, the admin sale-desk reply, and the PayPal
// invoice route. Records print first, then posters, then gear (the order
// the DB trigger snapshots). The order_requests trigger
// (validate_order_request) recomputes shipping with the same per-kind
// rules as shippingFor — a rate change must touch both. A negotiated
// line shows the listed price beside it; a credit comes off the subtotal
// (never more than the subtotal — that's the PayPal cap too).
export function bundleBreakdown(items: BundleItem[], credit = 0) {
  const sorted = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => KIND_ORDER[kindOf(a.item)] - KIND_ORDER[kindOf(b.item)] || a.i - b.i)
    .map((x) => x.item);
  const lines = sorted.map((r, i) => {
    const spec = itemSpecLine(r);
    return `${i + 1}. ${r.artist} — ${r.title}${spec ? ` — ${spec}` : ""} — $${r.price}${
      r.listedPrice != null && r.listedPrice !== r.price ? ` (listed $${r.listedPrice})` : ""
    }`;
  });
  const subtotal = sorted.reduce((s, r) => s + r.price, 0);
  const applied = Math.min(Math.max(0, credit), subtotal);
  const quote = shippingFor(sorted);
  const parcels = Math.ceil(quote.counts.record / RECORDS_PER_PARCEL);
  return {
    items: sorted,
    lines,
    subtotal,
    credit: applied,
    parcels,
    shipping: quote.shipping,
    shippingDetail: shippingDetail(quote),
    shippingNote: shippingNote(quote),
    gearQuoted: quote.gearQuoted,
    total: subtotal - applied + quote.shipping,
  };
}

// Order-request ref codes: CR- plus 4 chars from an alphabet without 0/O/1/I.
// The code goes in the buyer's DM and keys the order_requests row, so the
// admin can match a DM to a saved request.
export const REF_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const REF_LINE_RE = /\bRef:\s*(CR-[A-HJ-NP-Z2-9]{4})\b/i;

export function makeRefCode(): string {
  const picks = new Uint32Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(picks);
  } else {
    for (let i = 0; i < picks.length; i++) {
      picks[i] = Math.floor(Math.random() * REF_CODE_ALPHABET.length);
    }
  }
  let code = "CR-";
  for (const n of picks) code += REF_CODE_ALPHABET[n % REF_CODE_ALPHABET.length];
  return code;
}

export type SellerInfo = {
  pageTitle: string;
  redditUsername: string;
  contactEmail: string;
  location: string;
  contact: string;
  payment: string;
  shipping: string;
  posterShipping: string;
  gearShipping: string;
  guarantee: string;
};

export const SELLER_INFO: SellerInfo = {
  pageTitle: "Records for Sale",
  redditUsername: "ShroomHog", // shown on the page and used for "Request to buy" links
  contactEmail: "orders@curiouserrecords.com", // the shop's mailbox; replies land in /admin
  location: "Phoenix, AZ",
  contact: "Request to buy by email or Reddit DM. First come, first served.",
  payment: "PayPal G&S (invoice sent after claim) — I cover the G&S fee.",
  shipping: "$6 USPS Media Mail for 1–2 records (USA); free shipping on 3 or more. Records ship outside the jacket in a proper LP mailer.",
  posterShipping: "$12 flat (USA) for any number of posters, rolled together in a sturdy tube.",
  gearShipping: "Shipping is quoted per order — I'll reply with the rate before sending the invoice. Local pickup in Phoenix, AZ is always free.",
  guarantee: "Something not as described? Email me and I'll make it right.",
};
