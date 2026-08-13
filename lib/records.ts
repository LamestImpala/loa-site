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
