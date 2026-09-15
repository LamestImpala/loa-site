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
  negotiated_price?: number | null; // admin-only; price agreed for the current sale when it differs from `price`
  sold_at?: string | null; // admin-only; when the record was marked sold
  paypal_invoice_id?: string | null; // admin-only; invoice this record was billed on
  order_id?: number | null; // admin-only; the order it's held for, invoiced on, or sold in
  picked_at?: string | null; // admin-only; when it was pulled from the shelf for its order
  updated_at: string;
};

// One sale, from the first hold or invoice through fulfillment. Records
// and parcels point at it; the buyer's name lives here and is mirrored
// onto them. Status moves held → invoiced → paid; cancelled ends either
// open stage. "Fulfilled" is derived (every record in a tracked parcel).
export type OrderStatus = "held" | "invoiced" | "paid" | "cancelled";

// Where the buyer wants the parcel, as PayPal reported it when the
// invoice was paid. Name is what the shipping label prints, which is how
// a label PDF is matched back to its box.
export type ShipTo = {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string | null;
};

export type Order = {
  id: number;
  buyer_username: string; // no u/ prefix
  status: OrderStatus;
  paypal_invoice_id: string | null; // the live invoice, if one was sent
  request_id: number | null; // the shop request it came from, if any
  credit: number; // taken off the whole order — a make-good or a deal; 0 = none
  credit_note: string; // why; goes in the invoice note to the buyer
  ship_to: ShipTo | null; // from PayPal once paid; null for off-PayPal sales
  created_at: string;
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
  order_id: number | null; // fulfillment groups parcels by order
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
  packed_at: string | null; // sealed on /admin/pack with its records checked in; null for parcels made on the fulfillment card
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
  // Pending-order fields, written when the invoice is created so the
  // order survives clearing the sale desk.
  buyer_username?: string | null;
  recipient_view_url?: string | null; // buyer's payment link
  status?: string | null; // PayPal status: DRAFT / SENT / PAID / CANCELLED …
  record_ids?: number[] | null;
  total?: number | null;
  cancelled_at?: string | null;
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
  buyer_username: string | null; // typed by the buyer on the shop, no u/ prefix
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
    lowest?: number | null; // cheapest Discogs listing at run time (any grade, any country)
    lowest_plausible?: boolean; // false = that listing sits below half the grade suggestion, so it was ignored
    for_sale?: number | null; // copies listed on Discogs at run time
    have?: number | null; // Discogs community have count at run time
    want?: number | null; // Discogs community want count at run time
    ebay_median?: number | null; // median used asking price on eBay US
    // what set the target: the tier factor on the grade suggestion
    // (suggestion 85% / scarce 100% / stocked 70%), a comparable cheapest
    // listing, the eBay median, or the unsold-30-days time decay
    reason?: "suggestion" | "scarce" | "stocked" | "lowest" | "ebay" | "decay";
    action: "applied" | "flagged" | "above-lowest" | "undercut";
  }[];
};

// One day's market snapshot for a record, written by the daily price run.
// The admin only reads the newest row per record: want/have rank the weekly
// picks by demand, for_sale breaks ties (nothing is shown to buyers).
export type MarketSnapshotRow = {
  record_id: number;
  snapped_on: string; // YYYY-MM-DD
  for_sale: number | null;
  want: number | null; // Discogs community want count
  have: number | null; // Discogs community have count
  suggested: number | null; // Discogs price suggestion for the record's media grade
  lowest: number | null; // raw Discogs lowest_price (any grade, any country, FX-converted)
  lowest_plausible: boolean | null; // whether the run treated that listing as comparable
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
