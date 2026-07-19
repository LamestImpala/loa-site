/*
 * Seller info for the /records marketplace page and the Reddit table.
 *
 * NOTE: The record listings themselves live in Supabase and are managed
 * from /admin — this file only holds the seller details shown in the
 * page header, the pre-filled Reddit messages, and the markdown table.
 * (The original seed data that used to live here is in git history:
 * see lib/records.ts before commit "Add cover art, A-Z browser…".)
 */

export type SellerInfo = {
  pageTitle: string;
  redditUsername: string;
  contact: string;
  payment: string;
  shipping: string;
};

export const SELLER_INFO: SellerInfo = {
  pageTitle: "Records for Sale",
  redditUsername: "LateOnsetAudiophile", // shown on the page and used for "Request to buy" links
  contact: "PM me on Reddit to claim. First come, first served.",
  payment: "PayPal G&S (invoice sent after claim).",
  shipping: "$6 media mail (USA), records shipped outside the jacket in a proper LP mailer. Combined shipping on multiple records.",
};
