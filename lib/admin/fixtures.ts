import type { DbRecord, Invoice, Order, Shipment } from "../supabase.ts";

// Builders for the lib/admin node tests: a fully-populated record, invoice,
// and parcel that each test overrides only where the rule under test cares.

let nextId = 1;

export function rec(over: Partial<DbRecord> = {}): DbRecord {
  const id = over.id ?? nextId++;
  return {
    id,
    kind: "record",
    condition: null,
    details: {},
    artist: "Artist",
    title: `Title ${id}`,
    pressing: "2020 · Label CAT-1 · US",
    media: "NM",
    sleeve: "VG+",
    price: 30,
    prev_price: null,
    notes: "",
    photos: "",
    discogs_release_id: null,
    discogs_removed: false,
    cover_image: "",
    genres: [],
    collection: null,
    manual_price: false,
    photo_urls: [],
    hold_buyer: null,
    hold_until: null,
    created_at: "2026-09-01T00:00:00.000Z",
    sold: false,
    listed: true,
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

// A concert poster: no pressing or Goldmine grades, one condition word,
// and the show details in `details`.
export function poster(over: Partial<DbRecord> = {}): DbRecord {
  return rec({
    kind: "poster",
    artist: "Pearl Jam",
    title: `Poster ${over.id ?? nextId}`,
    pressing: "",
    media: "",
    sleeve: "",
    condition: "Excellent",
    details: { venue: "Wrigley Field", city: "Chicago", show_date: "2016-08-20", dimensions: "18 × 24 in" },
    price: 120,
    ...over,
  });
}

// A piece of audio equipment: brand in artist, model in title.
export function gear(over: Partial<DbRecord> = {}): DbRecord {
  return rec({
    kind: "gear",
    artist: "Technics",
    title: `SL-${over.id ?? nextId}`,
    pressing: "",
    media: "",
    sleeve: "",
    condition: "Very Good",
    details: { category: "Turntable", included: "Dust cover" },
    price: 400,
    ...over,
  });
}

export function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    paypal_invoice_id: "INV-1",
    paypal_fee: null,
    shipping_charged: null,
    paid_at: null,
    reddit_thread_url: null,
    status: "SENT",
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

export function shipment(over: Partial<Shipment> = {}): Shipment {
  return {
    id: over.id ?? nextId++,
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    buyer_username: "buyer",
    record_ids: [],
    to_address: {},
    paypal_invoice_id: null,
    order_id: null,
    tracking_code: null,
    carrier: "USPS",
    postage_cost: null,
    mode: "manual",
    status: "draft",
    paypal_tracker_id: null,
    paypal_tracked_number: null,
    paypal_synced_at: null,
    packed_at: null,
    sent_at: null,
    ...over,
  };
}

export function order(over: Partial<Order> = {}): Order {
  return {
    id: over.id ?? nextId++,
    buyer_username: "buyer",
    buyer_email: null,
    status: "held",
    paypal_invoice_id: null,
    request_id: null,
    credit: 0,
    credit_note: "",
    ship_to: null,
    refunded_amount: 0,
    refunded_at: null,
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

export const DAY = 24 * 3600 * 1000;
export const iso = (ms: number) => new Date(ms).toISOString();
