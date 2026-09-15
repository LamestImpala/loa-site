import type { DbRecord, Invoice, Order, Shipment } from "../supabase.ts";

// Builders for the lib/admin node tests: a fully-populated record, invoice,
// and parcel that each test overrides only where the rule under test cares.

let nextId = 1;

export function rec(over: Partial<DbRecord> = {}): DbRecord {
  const id = over.id ?? nextId++;
  return {
    id,
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
    address_verified: null,
    parcel: {},
    paypal_invoice_id: null,
    order_id: null,
    rate_amount: null,
    service: null,
    label_url: null,
    tracking_code: null,
    carrier: "USPS",
    postage_cost: null,
    mode: "manual",
    status: "purchased",
    paypal_tracker_id: null,
    paypal_tracked_number: null,
    paypal_synced_at: null,
    packed_at: null,
    ...over,
  };
}

export function order(over: Partial<Order> = {}): Order {
  return {
    id: over.id ?? nextId++,
    buyer_username: "buyer",
    status: "held",
    paypal_invoice_id: null,
    request_id: null,
    credit: 0,
    credit_note: "",
    ship_to: null,
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

export const DAY = 24 * 3600 * 1000;
export const iso = (ms: number) => new Date(ms).toISOString();
