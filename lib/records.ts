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

// USA media mail: one parcel holds up to 3 records
export const SHIPPING_PER_PARCEL = 6;
export const RECORDS_PER_PARCEL = 3;

export function combinedShipping(count: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / RECORDS_PER_PARCEL) * SHIPPING_PER_PARCEL;
}

export type BundleItem = {
  artist: string;
  title: string;
  media: string;
  sleeve: string;
  price: number;
};

// Itemized quote for a set of records — the one formatter for the shop's
// combined "Request to buy" DM, the admin sale-desk reply, and the PayPal
// invoice route. The order_requests DB trigger recomputes shipping with the
// same $6-per-3 math — a rate change must touch both.
export function bundleBreakdown(items: BundleItem[]) {
  const lines = items.map(
    (r, i) =>
      `${i + 1}. ${r.artist} — ${r.title} — Media: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}`
  );
  const subtotal = items.reduce((s, r) => s + r.price, 0);
  const parcels = Math.ceil(items.length / RECORDS_PER_PARCEL);
  const shipping = combinedShipping(items.length);
  return { lines, subtotal, parcels, shipping, total: subtotal + shipping };
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
  shipping: "$6 media mail per parcel of up to 3 records (USA) — 1–3 records $6, 4–6 $12, and so on. Records shipped outside the jacket in a proper LP mailer.",
};
