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

function joinWarnings(...warnings: (string | undefined)[]): string | undefined {
  const present = warnings.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

export type InvoiceShippingAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
};

// PayPal wants the recipient name split; take everything before the
// first space as given_name so "Mary Jane Smith" → "Mary" / "Jane Smith".
function shippingInfo(addr: InvoiceShippingAddress) {
  const [givenName, ...rest] = addr.name.trim().split(/\s+/);
  return {
    name: { given_name: givenName, surname: rest.join(" ") || undefined },
    address: {
      address_line_1: addr.street1,
      ...(addr.street2 ? { address_line_2: addr.street2 } : {}),
      admin_area_2: addr.city,
      admin_area_1: addr.state,
      postal_code: addr.zip,
      country_code: "US",
    },
  };
}

export async function createAndSendInvoice(args: {
  items: InvoiceItemInput[];
  shippingValue: string; // "6.00"
  note: string;
  memo: string;
  recipientEmail?: string;
  // Ships-to address shown on the invoice. Putting it on the PayPal
  // record (rather than only in a DM) is what keeps Seller Protection
  // intact when the label is bought for this address.
  shippingAddress?: InvoiceShippingAddress;
}): Promise<InvoiceResult> {
  const token = await getPayPalAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = paypalBase();

  const invoiceBody = (includeAddress: boolean) => {
    const recipient = {
      ...(args.recipientEmail
        ? { billing_info: { email_address: args.recipientEmail } }
        : {}),
      ...(includeAddress && args.shippingAddress
        ? { shipping_info: shippingInfo(args.shippingAddress) }
        : {}),
    };
    return JSON.stringify({
      detail: {
        currency_code: "USD",
        note: args.note,
        memo: args.memo,
        terms_and_conditions: TERMS,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      invoicer: INVOICER,
      ...(Object.keys(recipient).length > 0
        ? { primary_recipients: [recipient] }
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
    });
  };

  const tryCreate = (includeAddress: boolean) =>
    fetch(`${base}/v2/invoicing/invoices`, {
      method: "POST",
      headers,
      body: invoiceBody(includeAddress),
    });

  let addressWarning: string | undefined;
  let createRes = await tryCreate(true);
  if (!createRes.ok && args.shippingAddress) {
    // PayPal can reject recipient shapes it doesn't like (e.g. some
    // accounts require billing_info alongside shipping_info). The
    // invoice matters more than the address — retry without it.
    const firstFail = await createRes.text().catch(() => "");
    console.error(
      `paypal create with shipping_info failed (${createRes.status}), retrying without:`,
      firstFail
    );
    addressWarning =
      "PayPal rejected the shipping address on the invoice — invoice created without it. Add the address from the PayPal dashboard before the buyer pays.";
    createRes = await tryCreate(false);
  }
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
        warning: joinWarnings(
          addressWarning,
          `Draft created but sending failed (${sendRes.status}) ${detail.slice(0, 200)} — send it from the PayPal dashboard.`
        ),
      };
    }

    const detailRes = await fetch(`${base}/v2/invoicing/invoices/${invoiceId}`, {
      headers,
    });
    const invoice = detailRes.ok ? await detailRes.json().catch(() => ({})) : {};
    const meta = invoice?.detail?.metadata ?? {};
    const recipientViewUrl: string | null =
      meta.recipient_view_url ?? meta.payer_view_url ?? null;
    const warning = joinWarnings(
      addressWarning,
      recipientViewUrl
        ? undefined
        : "Invoice sent, but PayPal returned no share link — find it in the PayPal dashboard."
    );
    return {
      invoiceId,
      status: invoice?.status ?? "SENT",
      recipientViewUrl,
      ...(warning ? { warning } : {}),
    };
  } catch {
    return {
      invoiceId,
      status: "DRAFT",
      recipientViewUrl: null,
      warning: joinWarnings(
        addressWarning,
        "Draft created but sending failed — send it from the PayPal dashboard."
      ),
    };
  }
}
