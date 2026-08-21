/*
 * PayPal Invoicing v2 + Add Tracking v1 client. Server-only: credentials
 * come from PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, with PAYPAL_ENV
 * picking sandbox (default) or live. Used by /api/paypal-invoice and
 * /api/paypal-tracking.
 */

const PAYPAL_ENVS: Record<string, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

function paypalBase(): string {
  const env = process.env.PAYPAL_ENV ?? "sandbox";
  const base = PAYPAL_ENVS[env];
  if (!base) throw new Error(`PAYPAL_ENV must be "sandbox" or "live", got "${env}"`);
  return base;
}

export function paypalConfigured(): boolean {
  return !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET;
}

// Token cache survives warm serverless invocations; one invoice-plus-
// tracking round trip otherwise fetches the same token 2-3 times.
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getPayPalAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal credentials are not configured");
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const body = await res.json();
  if (!body?.access_token) throw new Error("PayPal auth returned no token");
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 0) * 1000,
  };
  return body.access_token;
}

export type InvoiceItemInput = {
  name: string;
  description: string;
  value: string; // "30.00"
};

// Branding shown on every invoice (PayPal caps logos at 250×90px)
const INVOICER = {
  business_name: "Curiouser Records",
  website: "https://curiouserrecords.com",
  logo_url: "https://curiouserrecords.com/images/curiouser-invoice-logo.png",
};

const TERMS =
  "All records are graded to the Goldmine standard — media and sleeve grades are listed per item. " +
  "Shipped via USPS Media Mail from Phoenix, AZ, outside the jacket in a proper LP mailer. " +
  "Combined shipping is $6 per parcel of up to 3 records. " +
  "Questions? Reply to this invoice or PM u/ShroomHog on Reddit.";

export type InvoiceResult = {
  invoiceId: string;
  status: string;
  recipientViewUrl: string | null;
  warning?: string;
};

// Reads a paid invoice's PayPal transaction id, plus the shipping the
// buyer was charged (off the invoice's amount breakdown) and the payment
// date (which scopes the Transaction Search window for the fee lookup).
// Invoices marked paid offline (cash/Venmo recorded by hand) have no
// transaction, so tracking can't be attached to them — callers must
// handle transactionId: null.
export async function getInvoicePayment(invoiceId: string): Promise<{
  status: string;
  transactionId: string | null;
  shippingCharged: number | null;
  paymentDate: string | null; // "2026-08-20"
}> {
  const token = await getPayPalAccessToken();
  const res = await fetch(
    `${paypalBase()}/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PayPal invoice lookup failed (${res.status}) ${detail.slice(0, 300)}`
    );
  }
  const invoice = await res.json().catch(() => ({}));
  const transactions: {
    payment_id?: string;
    type?: string;
    payment_date?: string;
  }[] = invoice?.payments?.transactions ?? [];
  const withId = transactions.find((t) => t.payment_id);
  const shippingRaw = invoice?.amount?.breakdown?.shipping?.amount?.value;
  const shipping = shippingRaw == null ? NaN : Number(shippingRaw);
  return {
    status: invoice?.status ?? "UNKNOWN",
    transactionId: withId?.payment_id ?? null,
    shippingCharged: Number.isFinite(shipping) ? shipping : null,
    paymentDate: withId?.payment_date ?? null,
  };
}

// The seller fee PayPal took on a transaction, via the Transaction Search
// API (requires the "Transaction Search" feature on the PayPal app).
// Transactions surface there a few hours after payment, so null means
// "not published yet — retry later", while a disabled feature throws.
export async function getTransactionFee(
  transactionId: string,
  paymentDate: string | null
): Promise<number | null> {
  const token = await getPayPalAccessToken();
  // Search windows are mandatory: bracket the payment date, or fall back
  // to the last 30 days (the API caps windows at 31 days).
  const day = 24 * 3600 * 1000;
  const anchor = paymentDate ? new Date(`${paymentDate}T00:00:00Z`) : null;
  const start =
    anchor && !Number.isNaN(anchor.getTime())
      ? new Date(anchor.getTime() - day)
      : new Date(Date.now() - 30 * day);
  const end =
    anchor && !Number.isNaN(anchor.getTime())
      ? new Date(anchor.getTime() + 2 * day)
      : new Date();
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "-0000");
  const res = await fetch(
    `${paypalBase()}/v1/reporting/transactions?transaction_id=${encodeURIComponent(
      transactionId
    )}&fields=transaction_info&start_date=${encodeURIComponent(
      fmt(start)
    )}&end_date=${encodeURIComponent(fmt(end))}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 403) {
    throw new Error(
      "Transaction Search isn't active on the PayPal app yet — it can take a few hours after enabling."
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PayPal transaction lookup failed (${res.status}) ${detail.slice(0, 300)}`
    );
  }
  const body = await res.json().catch(() => ({}));
  const feeRaw =
    body?.transaction_details?.[0]?.transaction_info?.fee_amount?.value;
  if (feeRaw == null) return null;
  const fee = Math.abs(Number(feeRaw)); // reported as a negative amount
  return Number.isFinite(fee) ? fee : null;
}

// Trackers already attached to a transaction — e.g. from shipping labels
// bought inside PayPal from the paid invoice.
export async function listTrackers(
  transactionId: string
): Promise<{ trackingNumber: string; carrier: string; status: string }[]> {
  const token = await getPayPalAccessToken();
  const res = await fetch(
    `${paypalBase()}/v1/shipping/trackers?transaction_id=${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PayPal tracker lookup failed (${res.status}) ${detail.slice(0, 300)}`
    );
  }
  const body = await res.json().catch(() => ({}));
  const trackers: {
    tracking_number?: string;
    carrier?: string;
    status?: string;
  }[] = body?.trackers ?? [];
  return trackers
    .filter((t) => t.tracking_number)
    .map((t) => ({
      trackingNumber: t.tracking_number as string,
      carrier: t.carrier ?? "USPS",
      status: t.status ?? "SHIPPED",
    }));
}

export type TrackerInput = {
  transactionId: string;
  trackingNumber: string;
  carrier: string;
};

// Attach tracking numbers to transactions (≤20 per call). notify_buyer
// makes PayPal email the buyer each tracking number. A tracker that
// already exists counts as success — re-pushes are idempotent.
export async function addTrackers(
  trackers: TrackerInput[]
): Promise<{ ok: Set<string>; errors: Map<string, string> }> {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${paypalBase()}/v1/shipping/trackers-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trackers: trackers.map((t) => ({
        transaction_id: t.transactionId,
        tracking_number: t.trackingNumber,
        status: "SHIPPED",
        carrier: t.carrier,
        notify_buyer: true,
      })),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PayPal add-tracking failed (${res.status}) ${detail.slice(0, 300)}`
    );
  }
  const body = await res.json().catch(() => ({}));
  const ok = new Set<string>();
  const errors = new Map<string, string>();
  for (const t of body?.tracker_identifiers ?? []) {
    if (t?.tracking_number) ok.add(t.tracking_number);
  }
  for (const e of body?.errors ?? []) {
    // Batch errors reference the tracker as "{txn}-{trackingNumber}"
    const id: string = e?.details?.[0]?.value ?? e?.resource_id ?? "";
    const match = trackers.find((t) => id.endsWith(t.trackingNumber));
    const message: string = e?.message ?? e?.name ?? "unknown error";
    if (match && /exist/i.test(message)) ok.add(match.trackingNumber);
    else if (match) errors.set(match.trackingNumber, message);
    else {
      // Can't tell which tracker failed — fail them all rather than let
      // an unconfirmed one be stamped as sent.
      for (const t of trackers) {
        if (!ok.has(t.trackingNumber)) errors.set(t.trackingNumber, message);
      }
    }
  }
  // Only explicit confirmation (or a duplicate) counts as success.
  for (const t of trackers) {
    if (!ok.has(t.trackingNumber) && !errors.has(t.trackingNumber)) {
      errors.set(
        t.trackingNumber,
        "PayPal returned no confirmation for this tracker — try again"
      );
    }
  }
  return { ok, errors };
}

// Cancel a tracker (e.g. before re-pushing a corrected number). A 404
// means it's already gone — fine either way.
export async function cancelTracker(
  transactionId: string,
  trackingNumber: string
): Promise<void> {
  const token = await getPayPalAccessToken();
  const res = await fetch(
    `${paypalBase()}/v1/shipping/trackers/${encodeURIComponent(`${transactionId}-${trackingNumber}`)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        tracking_number: trackingNumber,
        status: "CANCELLED",
      }),
    }
  );
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `PayPal tracker cancel failed (${res.status}) ${detail.slice(0, 300)}`
    );
  }
}

export async function createAndSendInvoice(args: {
  items: InvoiceItemInput[];
  shippingValue: string; // "6.00"
  note: string;
  memo: string;
  recipientEmail?: string;
}): Promise<InvoiceResult> {
  const token = await getPayPalAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = paypalBase();

  const createRes = await fetch(`${base}/v2/invoicing/invoices`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      detail: {
        currency_code: "USD",
        note: args.note,
        memo: args.memo,
        terms_and_conditions: TERMS,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      invoicer: INVOICER,
      ...(args.recipientEmail
        ? {
            primary_recipients: [
              { billing_info: { email_address: args.recipientEmail } },
            ],
          }
        : {}),
      items: args.items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: "1",
        unit_amount: { currency_code: "USD", value: item.value },
        unit_of_measure: "QUANTITY",
      })),
      amount: {
        breakdown: {
          shipping: {
            amount: { currency_code: "USD", value: args.shippingValue },
          },
        },
      },
    }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`PayPal invoice creation failed (${createRes.status}) ${detail.slice(0, 300)}`);
  }
  // The create response may be the full invoice or just a self-link.
  const created = await createRes.json().catch(() => ({}));
  const invoiceId: string | undefined =
    created?.id ?? created?.href?.split("/").pop();
  if (!invoiceId) throw new Error("PayPal did not return an invoice id");

  // From here on the draft exists — never throw the id away.
  try {
    const sendBody = JSON.stringify({
      send_to_invoicer: false,
      send_to_recipient: !!args.recipientEmail,
    });
    const trySend = () =>
      fetch(`${base}/v2/invoicing/invoices/${invoiceId}/send`, {
        method: "POST",
        headers,
        body: sendBody,
      });
    let sendRes = await trySend();
    if (sendRes.status !== 200 && sendRes.status !== 202) {
      // Live occasionally rejects a send issued immediately after create
      // (draft not yet propagated) — log the full response and retry once.
      const firstFail = await sendRes.text().catch(() => "");
      console.error(`paypal send failed (${sendRes.status}), retrying:`, firstFail);
      await new Promise((r) => setTimeout(r, 1500));
      sendRes = await trySend();
    }
    if (sendRes.status !== 200 && sendRes.status !== 202) {
      const detail = await sendRes.text().catch(() => "");
      console.error(`paypal send retry failed (${sendRes.status}):`, detail);
      return {
        invoiceId,
        status: "DRAFT",
        recipientViewUrl: null,
        warning: `Draft created but sending failed (${sendRes.status}) ${detail.slice(0, 200)} — send it from the PayPal dashboard.`,
      };
    }

    const detailRes = await fetch(`${base}/v2/invoicing/invoices/${invoiceId}`, {
      headers,
    });
    const invoice = detailRes.ok ? await detailRes.json().catch(() => ({})) : {};
    const meta = invoice?.detail?.metadata ?? {};
    const recipientViewUrl: string | null =
      meta.recipient_view_url ?? meta.payer_view_url ?? null;
    return {
      invoiceId,
      status: invoice?.status ?? "SENT",
      recipientViewUrl,
      ...(recipientViewUrl
        ? {}
        : {
            warning:
              "Invoice sent, but PayPal returned no share link — find it in the PayPal dashboard.",
          }),
    };
  } catch {
    return {
      invoiceId,
      status: "DRAFT",
      recipientViewUrl: null,
      warning:
        "Draft created but sending failed — send it from the PayPal dashboard.",
    };
  }
}
