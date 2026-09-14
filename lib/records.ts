/*
 * Seller info for the /records marketplace page and the Reddit table.
 *
 * NOTE: The record listings themselves live in Supabase and are managed
 * from /admin — this file only holds the seller details shown in the
 * page header, the pre-filled Reddit messages, and the markdown table.
 * (The original seed data that used to live here is in git history:
 * see lib/records.ts before commit "Add cover art, A-Z browser…".)
 */

// A–Z browser shared by /records and /admin
export const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

export function artistLetter(artist: string) {
  const first = artist.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

// USA media mail: one parcel holds up to 3 records. Buyers pay $6 for one
// or two records; a bundle of FREE_SHIPPING_MIN or more ships free — that is
// the parcel boundary, so it costs one label and rewards the order size
// that makes the packing worthwhile.
export const SHIPPING_PER_PARCEL = 6;
export const RECORDS_PER_PARCEL = 3;
export const FREE_SHIPPING_MIN = 3;

export function combinedShipping(count: number): number {
  if (count <= 0) return 0;
  if (count >= FREE_SHIPPING_MIN) return 0;
  return Math.ceil(count / RECORDS_PER_PARCEL) * SHIPPING_PER_PARCEL;
}

export type BundleItem = {
  artist: string;
  title: string;
  media: string;
  sleeve: string;
  price: number; // what the buyer pays for it
  listedPrice?: number; // the listed price, when the sale price was negotiated
};

// Itemized quote for a set of records — the one formatter for the shop's
// combined "Request to buy" DM, the admin sale-desk reply, and the PayPal
// invoice route. The order_requests DB trigger (validate_order_request)
// recomputes shipping with the same rule — a rate change must touch both.
// A negotiated line shows the listed price beside it; a credit comes off
// the subtotal (never more than the subtotal — that's the PayPal cap too).
export function bundleBreakdown(items: BundleItem[], credit = 0) {
  const lines = items.map(
    (r, i) =>
      `${i + 1}. ${r.artist} — ${r.title} — Media: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}${
        r.listedPrice != null && r.listedPrice !== r.price ? ` (listed $${r.listedPrice})` : ""
      }`
  );
  const subtotal = items.reduce((s, r) => s + r.price, 0);
  const applied = Math.min(Math.max(0, credit), subtotal);
  const parcels = Math.ceil(items.length / RECORDS_PER_PARCEL);
  const shipping = combinedShipping(items.length);
  return {
    lines,
    subtotal,
    credit: applied,
    parcels,
    shipping,
    total: subtotal - applied + shipping,
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
  location: string;
  contact: string;
  payment: string;
  shipping: string;
};

export const SELLER_INFO: SellerInfo = {
  pageTitle: "Records for Sale",
  redditUsername: "ShroomHog", // shown on the page and used for "Request to buy" links
  location: "Phoenix, AZ",
  contact: "PM me on Reddit to claim. First come, first served.",
  payment: "PayPal G&S (invoice sent after claim) — I cover the G&S fee.",
  shipping: "$6 USPS Media Mail for 1–2 records (USA); free shipping on 3 or more. Records ship outside the jacket in a proper LP mailer.",
};
