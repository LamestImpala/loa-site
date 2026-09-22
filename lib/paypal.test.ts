// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceIdFromEvent,
  refundFromInvoice,
  shipToFromInvoice,
  shipToFromTransaction,
  verifyWebhookSignature,
} from "./paypal.ts";

const address = {
  address_line_1: "123 Main St",
  address_line_2: "Apt 4",
  admin_area_2: "Tempe",
  admin_area_1: "AZ",
  postal_code: "85281",
  country_code: "US",
};

test("the payer's address on the payment wins", () => {
  const shipTo = shipToFromInvoice({
    primary_recipients: [
      {
        shipping_info: {
          name: { given_name: "Bill", surname: "Recipient" },
          address: { ...address, postal_code: "00000" },
        },
      },
    ],
    payments: {
      transactions: [
        {
          payment_id: "TXN1",
          shipping_info: {
            name: { full_name: "Jane Q Buyer" },
            address,
          },
        },
      ],
    },
  });
  assert.deepEqual(shipTo, {
    name: "Jane Q Buyer",
    line1: "123 Main St",
    line2: "Apt 4",
    city: "Tempe",
    state: "AZ",
    postal_code: "85281",
    country_code: "US",
  });
});

test("falls back to the recipient block, joining given and surname", () => {
  const shipTo = shipToFromInvoice({
    primary_recipients: [
      {
        billing_info: { email_address: "x@y.z" },
        shipping_info: {
          name: { given_name: "Bill", surname: "Recipient" },
          address: { address_line_1: "9 Elm", admin_area_2: "Mesa", admin_area_1: "AZ", postal_code: "85201" },
        },
      },
    ],
    payments: { transactions: [{ payment_id: "TXN1" }] },
  });
  assert.equal(shipTo?.name, "Bill Recipient");
  assert.equal(shipTo?.line1, "9 Elm");
  assert.equal(shipTo?.line2, null);
  assert.equal(shipTo?.country_code, null);
});

test("a business name stands in when there is no person name", () => {
  const shipTo = shipToFromInvoice({
    primary_recipients: [
      { shipping_info: { business_name: "Acme Records", address: { address_line_1: "1 Way" } } },
    ],
  });
  assert.equal(shipTo?.name, "Acme Records");
});

test("nothing usable yields null", () => {
  assert.equal(shipToFromInvoice({}), null);
  assert.equal(shipToFromInvoice(null), null);
  assert.equal(
    shipToFromInvoice({ primary_recipients: [{ shipping_info: { name: { full_name: "  " } } }] }),
    null
  );
  assert.equal(shipToFromInvoice({ payments: { transactions: [{ shipping_info: "bad" }] } }), null);
});

test("transaction search: shipping_info in the reporting shape", () => {
  const shipTo = shipToFromTransaction({
    transaction_info: { fee_amount: { value: "-1.23" } },
    shipping_info: {
      name: "Jane Q Buyer",
      address: {
        line1: "123 Main St",
        line2: "Apt 4",
        city: "Tempe",
        state: "AZ",
        postal_code: "85281",
        country_code: "US",
      },
    },
    payer_info: { payer_name: { given_name: "Ignored", surname: "Payer" } },
  });
  assert.deepEqual(shipTo, {
    name: "Jane Q Buyer",
    line1: "123 Main St",
    line2: "Apt 4",
    city: "Tempe",
    state: "AZ",
    postal_code: "85281",
    country_code: "US",
  });
});

test("transaction search: payer_info stands in when there is no shipping block", () => {
  const shipTo = shipToFromTransaction({
    payer_info: {
      payer_name: { given_name: "Bob", surname: "Payer" },
      address: { line1: "9 Elm", city: "Mesa", state: "AZ", postal_code: "85201", country_code: "US" },
    },
  });
  assert.equal(shipTo?.name, "Bob Payer");
  assert.equal(shipTo?.city, "Mesa");
  assert.equal(shipToFromTransaction({ transaction_info: {} }), null);
  assert.equal(shipToFromTransaction(undefined), null);
});

test("a refunded invoice reports the total and the latest refund date", () => {
  assert.deepEqual(
    refundFromInvoice({
      status: "PARTIALLY_REFUNDED",
      refunds: {
        refund_amount: { currency_code: "USD", value: "12.50" },
        transactions: [
          { refund_date: "2026-09-18", amount: { value: "5.00" } },
          { refund_date: "2026-09-12", amount: { value: "7.50" } },
        ],
      },
    }),
    { amount: 12.5, date: "2026-09-18" }
  );
});

test("refund transactions are summed when the total is missing", () => {
  assert.deepEqual(
    refundFromInvoice({
      refunds: { transactions: [{ refund_date: "2026-09-12", amount: { value: "36" } }] },
    }),
    { amount: 36, date: "2026-09-12" }
  );
});

test("an invoice with no refunds reports none", () => {
  assert.deepEqual(refundFromInvoice({ status: "PAID" }), { amount: null, date: null });
  assert.deepEqual(refundFromInvoice(null), { amount: null, date: null });
});

test("webhook events name their invoice under resource.invoice or resource", () => {
  assert.equal(
    invoiceIdFromEvent({ resource: { invoice: { id: "INV2-AB12-CD34-EF56-GH78" } } }),
    "INV2-AB12-CD34-EF56-GH78"
  );
  assert.equal(invoiceIdFromEvent({ resource: { id: "INV2-AB12-CD34" } }), "INV2-AB12-CD34");
  assert.equal(invoiceIdFromEvent({ resource: { id: "WH-123" } }), null);
  assert.equal(invoiceIdFromEvent({ resource: { invoice: { id: "../orders" } } }), null);
  assert.equal(invoiceIdFromEvent(null), null);
});

test("webhook verification sends the event bytes untouched and needs every header", async () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-09-22T12:00:00Z",
  };
  // Odd spacing, a float and "$&" must reach PayPal exactly as sent.
  const raw = '{"id":"WH-1", "amount":1.10,"note":"$& $1"}';
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    sent.push(init?.body ?? "");
    return new Response(JSON.stringify({ verification_status: "SUCCESS" }));
  }) as typeof fetch;
  try {
    assert.equal(await verifyWebhookSignature(headers, raw, "WH-ID"), true);
    assert.ok(sent[0].endsWith(`"webhook_event":${raw}}`));
    assert.ok(sent[0].includes('"webhook_id":"WH-ID"'));
    assert.equal(
      await verifyWebhookSignature({ ...headers, "paypal-transmission-sig": null }, raw, "WH-ID"),
      false
    );
    assert.equal(sent.length, 1, "a delivery missing a header never reaches PayPal");
  } finally {
    globalThis.fetch = realFetch;
  }
});
