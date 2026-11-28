import type { Shipment } from "./supabase.ts";

// Carrier tracking from Shippo: which boxes to ask about, how to ask, and
// what the answer means for the shipments row. Pure apart from
// fetchShippoTrack, which takes its fetch so tests need no network. The
// sweep that writes the rows is in delivery-db.ts.
//
// Shippo tracks numbers bought anywhere (our labels come from PayPal) with
// GET /tracks/{carrier}/{number}; it bills about 2¢ per tracked number.

export const SHIPPO_API = "https://api.goshippo.com";

// Where the shop is: delivery dates are said in its time zone, so a box
// scanned at 4:49 pm isn't called delivered "tomorrow" (UTC).
export const SHOP_TZ = "America/Phoenix";

// "Nov 27" in the shop's time zone.
export function deliveredDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: SHOP_TZ });
}

// Boxes dropped off longer ago than this are left alone: one that hasn't
// scanned delivered in a month isn't going to, and it keeps the first run
// from asking about every past box.
export const TRACK_WINDOW_DAYS = 30;

export type TrackStatus = "PRE_TRANSIT" | "TRANSIT" | "DELIVERED" | "RETURNED" | "FAILURE" | "UNKNOWN";
const STATUSES = new Set<TrackStatus>(["PRE_TRANSIT", "TRANSIT", "DELIVERED", "RETURNED", "FAILURE", "UNKNOWN"]);

export type TrackResult = {
  status: TrackStatus;
  detail: string | null; // "Delivered, Front Door/Porch — OLYMPIA, WA"
  deliveredAt: string | null; // ISO, when status is DELIVERED
};

export function shippoConfigured(): boolean {
  return Boolean(process.env.SHIPPO_API_KEY?.trim());
}

// Shippo's carrier token for what the shipments row says. Blank means USPS
// (the default); a carrier Shippo can't be asked about gives null.
export function shippoCarrier(carrier: string | null | undefined): string | null {
  const c = (carrier ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (c === "" || c === "usps") return "usps";
  if (c === "ups") return "ups";
  if (c === "fedex") return "fedex";
  if (c === "dhl" || c === "dhlexpress") return "dhl_express";
  return null;
}

// Tracking numbers get typed with spaces ("9449 0502 0621 …").
export function cleanTrackingNumber(code: string | null | undefined): string {
  return (code ?? "").replace(/[\s-]/g, "").toUpperCase();
}

type Box = Pick<Shipment, "id" | "sent_at" | "tracking_code" | "carrier" | "mode"> &
  Pick<Shipment, "delivered_at">;

// Mailed boxes worth asking about: dropped off within the window, with a
// tracking number, not delivered yet. Boxes handed over in person have no
// tracking — their sent_at is when they arrived.
export function boxesToTrack<T extends Box>(boxes: T[], now: Date = new Date()): T[] {
  const since = now.getTime() - TRACK_WINDOW_DAYS * 86_400_000;
  return boxes.filter(
    (b) =>
      b.mode !== "hand" && // HAND_MODE in admin/fulfillment.ts (not imported: it imports this file)
      !!b.sent_at &&
      Date.parse(b.sent_at) >= since &&
      !b.delivered_at &&
      cleanTrackingNumber(b.tracking_code) !== "" &&
      shippoCarrier(b.carrier) !== null
  );
}

type ShippoStatus = {
  status?: unknown;
  status_details?: unknown;
  status_date?: unknown;
  location?: { city?: unknown; state?: unknown } | null;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function isoOrNull(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  // Shippo's test data leaves the zone off; its dates are UTC.
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function describe(s: ShippoStatus): string | null {
  const words = text(s.status_details);
  const place = [text(s.location?.city), text(s.location?.state)].filter(Boolean).join(", ");
  const out = [words, place].filter(Boolean).join(" — ");
  return out ? out.slice(0, 200) : null;
}

// Shippo's Track object, reduced to what the shipments row keeps. Null
// when the body isn't a track (an error page, a changed API).
export function parseShippoTrack(body: unknown, now: Date = new Date()): TrackResult | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { tracking_status?: ShippoStatus | null; tracking_history?: unknown };
  const current = b.tracking_status;
  if (!current || typeof current !== "object") {
    // A number Shippo has never seen comes back with no status yet.
    return Array.isArray(b.tracking_history) ? { status: "UNKNOWN", detail: null, deliveredAt: null } : null;
  }
  const raw = text(current.status).toUpperCase() as TrackStatus;
  const status: TrackStatus = STATUSES.has(raw) ? raw : "UNKNOWN";
  let deliveredAt: string | null = null;
  if (status === "DELIVERED") {
    // The current status's date, else the delivered scan in the history,
    // else now (it is delivered; the date is the best we can say).
    const history = Array.isArray(b.tracking_history) ? (b.tracking_history as ShippoStatus[]) : [];
    const scan = [...history].reverse().find((h) => text(h?.status).toUpperCase() === "DELIVERED");
    deliveredAt = isoOrNull(current.status_date) ?? isoOrNull(scan?.status_date) ?? now.toISOString();
  }
  return { status, detail: describe(current), deliveredAt };
}

// What a lookup may use besides the number: the box, and the PayPal
// transaction its label or tracker hangs off (see paypalTxnOf).
export type TrackBox = { id: number; paypalTxn: string | null; paypalInvoiceId: string | null };

export type TrackLookup = (carrier: string, number: string, box?: TrackBox) => Promise<TrackResult>;

// The PayPal transaction behind a box: its tracker id is
// "{transactionId}-{trackingNumber}", and transaction ids have no hyphen.
export function paypalTxnOf(trackerId: string | null | undefined): string | null {
  const txn = (trackerId ?? "").split("-")[0].trim();
  return txn || null;
}

// PayPal's tracker status, when it says the box was delivered. PayPal
// only knows what the carrier or seller told it, so anything short of
// DELIVERED is "don't know" (null) and the lookup goes on to Shippo.
export function fromPayPalTracker(
  status: string | null | undefined,
  updatedAt: string | null | undefined,
  now: Date = new Date()
): TrackResult | null {
  if ((status ?? "").toUpperCase() !== "DELIVERED") return null;
  return { status: "DELIVERED", detail: "Delivered (per PayPal)", deliveredAt: isoOrNull(updatedAt) ?? now.toISOString() };
}

// Ask Shippo about one number. Throws on anything but a readable track,
// so the sweep counts it as failed and asks again next run.
export async function fetchShippoTrack(
  carrier: string,
  number: string,
  opts: { key?: string; fetch?: typeof fetch } = {}
): Promise<TrackResult> {
  const key = opts.key ?? process.env.SHIPPO_API_KEY?.trim();
  if (!key) throw new Error("SHIPPO_API_KEY is not set");
  const f = opts.fetch ?? fetch;
  const res = await f(
    `${SHIPPO_API}/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(number)}`,
    { headers: { Authorization: `ShippoToken ${key}`, Accept: "application/json" }, cache: "no-store" }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shippo ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  const parsed = parseShippoTrack(await res.json());
  if (!parsed) throw new Error("Shippo answered without a tracking status");
  return parsed;
}

// What to write on the shipments row for one answer.
export function trackingUpdate(r: TrackResult, now: Date = new Date()) {
  return {
    tracking_status: r.status,
    tracking_detail: r.detail,
    tracking_checked_at: now.toISOString(),
    ...(r.deliveredAt ? { delivered_at: r.deliveredAt } : {}),
  };
}

// The words on the box chip for a status that isn't delivered.
export function trackingLabel(status: string | null | undefined): string | null {
  switch (status) {
    case "PRE_TRANSIT":
      return "Not scanned yet";
    case "TRANSIT":
      return "In transit";
    case "RETURNED":
      return "Returning to you";
    case "FAILURE":
      return "Delivery problem";
    default:
      return null;
  }
}
