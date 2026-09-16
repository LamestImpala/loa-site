// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { shipToFromInvoice, shipToFromTransaction } from "./paypal.ts";

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
