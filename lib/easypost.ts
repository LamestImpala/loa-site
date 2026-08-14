/*
 * EasyPost client for USPS Media Mail labels. Server-only: the API key
 * comes from EASYPOST_API_KEY (a test key buys free test labels, a
 * production key buys real postage — EasyPost infers the mode from the
 * key). The ship-from address is env-configured too since the seller's
 * street address shouldn't live in source. Used by /api/shipping-label.
 */

const EASYPOST_BASE = "https://api.easypost.com/v2";

export function easypostConfigured(): boolean {
  return !!process.env.EASYPOST_API_KEY;
}

function easypostHeaders() {
  const key = process.env.EASYPOST_API_KEY;
  if (!key) throw new Error("EASYPOST_API_KEY is not configured");
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

async function easypostPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${EASYPOST_BASE}${path}`, {
    method: "POST",
    headers: easypostHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } })?.error;
    throw new Error(`EasyPost ${path} failed (${res.status}) ${err?.message ?? ""}`.trim());
  }
  return json as Record<string, unknown>;
}

export type ShippingAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
};

function shipFromAddress() {
  const from = {
    name: process.env.SHIP_FROM_NAME,
    street1: process.env.SHIP_FROM_STREET1,
    city: process.env.SHIP_FROM_CITY,
    state: process.env.SHIP_FROM_STATE,
    zip: process.env.SHIP_FROM_ZIP,
    phone: process.env.SHIP_FROM_PHONE,
    country: "US",
  };
  if (!from.name || !from.street1 || !from.city || !from.state || !from.zip) {
    throw new Error(
      "Ship-from address is not configured (SHIP_FROM_NAME/STREET1/CITY/STATE/ZIP)"
    );
  }
  return from;
}

// Parcel defaults for records in an LP mailer. Media Mail pricing is
// weight-driven, so weight is the number that matters; the admin can
// edit all four before buying.
export type Parcel = {
  length: number; // inches
  width: number;
  height: number;
  weight_oz: number;
};

export function defaultParcel(recordCount: number): Parcel {
  const count = Math.max(1, recordCount);
  return {
    length: 12.5,
    width: 12.5,
    height: 1 + 0.5 * (count - 1),
    // ~1 lb per record + mailer/stiffeners
    weight_oz: 16 * count + 6,
  };
}

export type AddressVerification = {
  verified: boolean;
  normalized: ShippingAddress | null;
  errors: string[];
};

// POST /addresses with delivery verification. EasyPost normalizes
// against USPS data even in test mode.
export async function verifyAddress(addr: ShippingAddress): Promise<AddressVerification> {
  const body = {
    address: {
      name: addr.name,
      street1: addr.street1,
      street2: addr.street2 || undefined,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      country: "US",
      verify: ["delivery"],
    },
  };
  const created = (await easypostPost("/addresses", body)) as {
    name?: string;
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
    verifications?: {
      delivery?: { success?: boolean; errors?: { message?: string }[] };
    };
  };
  const delivery = created.verifications?.delivery;
  const verified = !!delivery?.success;
  return {
    verified,
    normalized: verified
      ? {
          name: created.name ?? addr.name,
          street1: created.street1 ?? addr.street1,
          street2: created.street2 || undefined,
          city: created.city ?? addr.city,
          state: created.state ?? addr.state,
          zip: created.zip ?? addr.zip,
        }
      : null,
    errors: (delivery?.errors ?? [])
      .map((e) => e.message ?? "")
      .filter(Boolean),
  };
}

export type MediaMailQuote = {
  shipmentId: string;
  rateId: string;
  rate: string; // "4.13"
  mode: string; // "test" | "production"
};

// Create a shipment and pick out the USPS Media Mail rate. Media Mail
// only shows up when special_rates_eligibility asks for it.
export async function createShipment(args: {
  to: ShippingAddress;
  parcel: Parcel;
}): Promise<MediaMailQuote> {
  const body = {
    shipment: {
      to_address: { ...args.to, street2: args.to.street2 || undefined, country: "US" },
      from_address: shipFromAddress(),
      parcel: {
        length: args.parcel.length,
        width: args.parcel.width,
        height: args.parcel.height,
        weight: args.parcel.weight_oz,
      },
      options: {
        special_rates_eligibility: "USPS.MEDIAMAIL",
        label_format: "PDF",
      },
    },
  };
  const shipment = (await easypostPost("/shipments", body)) as {
    id?: string;
    mode?: string;
    rates?: { id: string; carrier: string; service: string; rate: string }[];
    messages?: { message?: string }[];
  };
  if (!shipment.id) throw new Error("EasyPost returned no shipment id");
  const mediaMail = (shipment.rates ?? []).find(
    (r) => r.carrier === "USPS" && r.service === "MediaMail"
  );
  if (!mediaMail) {
    const hints = (shipment.messages ?? [])
      .map((m) => m.message ?? "")
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `No USPS Media Mail rate returned${hints ? ` — ${hints}` : ""}`
    );
  }
  return {
    shipmentId: shipment.id,
    rateId: mediaMail.id,
    rate: mediaMail.rate,
    mode: shipment.mode ?? "test",
  };
}

export type PurchasedLabel = {
  labelUrl: string;
  trackingCode: string;
};

export async function buyShipment(
  shipmentId: string,
  rateId: string
): Promise<PurchasedLabel> {
  const bought = (await easypostPost(`/shipments/${shipmentId}/buy`, {
    rate: { id: rateId },
  })) as {
    postage_label?: { label_url?: string };
    tracking_code?: string;
  };
  const labelUrl = bought.postage_label?.label_url;
  const trackingCode = bought.tracking_code;
  if (!labelUrl || !trackingCode) {
    throw new Error("EasyPost purchase returned no label URL or tracking code");
  }
  return { labelUrl, trackingCode };
}

// USPS refunds unused labels; the refund lands back on the EasyPost
// wallet once USPS confirms the label was never scanned.
export async function refundShipment(shipmentId: string): Promise<string> {
  const refunded = (await easypostPost(`/shipments/${shipmentId}/refund`, {})) as {
    refund_status?: string;
  };
  return refunded.refund_status ?? "submitted";
}
