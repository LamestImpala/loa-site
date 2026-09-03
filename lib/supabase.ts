import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The publishable key is safe to expose — Row Level Security controls access.
export const SUPABASE_URL = "https://spmbjuurarlpyqcqxyyz.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_DJ3UU1iAO7CQDJDWENtcnQ_3-_N6DXM";

export const ADMIN_EMAIL = "brandoncgillihan@gmail.com";

export type DbRecord = {
  id: number;
  artist: string;
  title: string;
  pressing: string;
  media: string;
  sleeve: string;
  price: number;
  prev_price?: number | null; // price before the most recent change
  notes: string;
  photos: string;
  discogs_release_id: number | null;
  discogs_removed?: boolean; // copy already removed from the owner's Discogs collection
  cover_image: string;
  genres: string[]; // from Discogs release data, e.g. ["Rock", "Jazz"]
  collection: string | null; // curated series like "VMP" or "IVC"
  manual_price?: boolean; // true = daily price run leaves this record alone
  photo_urls: string[]; // uploaded photos of the actual copy (Supabase Storage)
  hold_buyer?: string | null; // admin-only; who claimed it
  hold_until: string | null; // public; active hold when in the future
  created_at?: string; // used for "new this week" merchandising
  sold: boolean;
  listed: boolean;
  buyer_username?: string; // admin-only; not selected on the public page
  tracking_number?: string; // admin-only; mirrored from shipments.tracking_code
  sold_price?: number | null; // admin-only; final price the record sold for
  sold_at?: string | null; // admin-only; when the record was marked sold
  paypal_invoice_id?: string | null; // admin-only; invoice this record was billed on
  updated_at: string;
};

// One parcel of a sale. mode "manual" = tracking typed in the admin,
// "paypal" = tracking pulled from a label bought inside PayPal — all
// labels are bought through PayPal.
export type Shipment = {
  id: number;
  created_at: string;
  updated_at: string;
  buyer_username: string;
  record_ids: number[];
  to_address: Record<string, unknown>;
  address_verified: boolean | null;
  parcel: Record<string, unknown>;
  paypal_invoice_id: string | null;
  rate_amount: number | null;
  service: string | null;
  label_url: string | null;
  tracking_code: string | null;
  carrier: string; // USPS default
  postage_cost: number | null; // what the label cost — a deductible expense
  mode: string | null;
  status: "draft" | "purchased" | "shipped" | "refunded";
  paypal_tracker_id: string | null; // "{txnId}-{trackingNumber}" once known in PayPal
  paypal_tracked_number: string | null; // the tracking number PayPal currently has
  paypal_synced_at: string | null;
};

// Money facts about one PayPal invoice, typed in from the transaction
// details page. Fee and postage feed the net figure on the stats tiles and
// give the tax records something to point at.
export type Invoice = {
  paypal_invoice_id: string;
  paypal_fee: number | null; // PayPal's transaction fee (a cost)
  shipping_charged: number | null; // shipping the buyer paid (income)
  paid_at: string | null; // set by the pull sync once PayPal reports the invoice paid
  reddit_thread_url: string | null; // per-sale confirmation thread; blank = the saved sale post
  created_at: string;
  updated_at: string;
};

export type PendingPriceChange = {
  id: number;
  record_id: number;
  old_price: number;
  suggested_price: number;
  pct_change: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  records?: Pick<DbRecord, "artist" | "title" | "pressing" | "price"> | null;
};

// Snapshot of one record inside an order request, captured at request time.
export type OrderRequestItem = {
  id: number;
  artist: string;
  title: string;
  media: string;
  sleeve: string;
  price: number;
};

export type OrderRequest = {
  id: number;
  ref_code: string; // CR-XXXX, also printed in the buyer's DM
  record_ids: number[];
  items: OrderRequestItem[];
  subtotal: number;
  shipping: number;
  total: number;
  status: "new" | "loaded" | "completed" | "dismissed";
  created_at: string;
  updated_at: string;
};

export type PriceRun = {
  id: number;
  ran_at: string;
  checked: number;
  auto_applied: number;
  flagged: number;
  above_lowest?: number;
  undercuts?: number;
  errors: number;
  summary: {
    record_id: number;
    artist: string;
    title: string;
    old_price: number;
    new_price: number;
    pct: number;
    lowest?: number; // cheapest Discogs listing at run time
    for_sale?: number | null; // copies listed on Discogs at run time
    have?: number | null; // Discogs community have count at run time
    want?: number | null; // Discogs community want count at run time
    ebay_median?: number | null; // median used asking price on eBay US
    action: "applied" | "flagged" | "above-lowest" | "undercut";
  }[];
};

// One day's market snapshot for a record, written by the daily price run.
// The admin only reads the newest row per record: for_sale drives the
// scarcity callouts, want/have the demand ranking of weekly picks.
export type MarketSnapshotRow = {
  record_id: number;
  snapped_on: string; // YYYY-MM-DD
  for_sale: number | null;
  want: number | null; // Discogs community want count
  have: number | null; // Discogs community have count
};

// Per-record aggregate of shopper click events (record_interest view);
// "sessions" are distinct anonymous visitors, "events" are raw clicks.
export type RecordInterest = {
  record_id: number;
  interest_events: number;
  interest_sessions: number;
  request_events: number;
  request_sessions: number;
  last_event_at: string;
};

// Raw shopper click event (record_events table); RLS only lets the admin
// read these. Powers the day-by-day interest breakdown in the admin.
export type RecordEventRow = {
  record_id: number;
  event_type: "photo_open" | "discogs_click" | "bundle_add" | "buy_request";
  session_id: string;
  created_at: string;
};

// One generated Reddit sale post, archived at copy time (r/vinylcollectors
// forbids deleting posts, so old ones get retired with a pointer to the
// newest post instead). Update repastes are child rows via parent_id.
export type RedditPost = {
  id: number;
  kind: "full" | "weekly" | "update";
  parent_id: number | null;
  title: string | null; // null for body-only update repastes
  body: string; // exact markdown that was copied
  record_ids: number[];
  reddit_url: string | null; // pasted in after posting
  retired_at: string | null; // set when a retire body is copied
  created_at: string;
};

// Server-side client for the public /records page (anon role: RLS only
// exposes listed records).
export function createServerSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
}

let browserClient: SupabaseClient | null = null;

// Browser client for the admin page; keeps the auth session in localStorage.
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }
  return browserClient;
}
