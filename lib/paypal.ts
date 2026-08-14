/*
 * PayPal Invoicing v2 client. Server-only: credentials come from
 * PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, with PAYPAL_ENV picking
 * sandbox (default) or live. Used by /api/paypal-invoice.
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

export async function getPayPalAccessToken(): Promise<string> {
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
    const sendRes = await fetch(
      `${base}/v2/invoicing/invoices/${invoiceId}/send`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          send_to_invoicer: false,
          send_to_recipient: !!args.recipientEmail,
        }),
      }
    );
    if (sendRes.status !== 200 && sendRes.status !== 202) {
      const detail = await sendRes.text().catch(() => "");
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
