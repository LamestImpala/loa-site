// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "./fake-supabase.ts";
import { invoicesMissingCosts, recordTransactionCosts, sweepMissingCosts } from "./costs-db.ts";
import { order } from "./fixtures.ts";

const NOW = new Date("2026-09-24T22:00:00Z");
const shipTo = {
  name: "Ann Buyer",
  line1: "1 Way",
  line2: null,
  city: "Tempe",
  state: "AZ",
  postal_code: "85281",
  country_code: "US",
};

const recentSales = () =>
  fakeSupabase({
    invoices: [
      { paypal_invoice_id: "INV2-NEW", paid_at: "2026-09-24T20:43:00Z", paypal_fee: null, status: "PAID" },
      { paypal_invoice_id: "INV2-DONE", paid_at: "2026-09-23T10:00:00Z", paypal_fee: 1.5, status: "PAID" },
      { paypal_invoice_id: "INV2-OLD", paid_at: "2026-09-01T10:00:00Z", paypal_fee: null, status: "PAID" },
      { paypal_invoice_id: "INV2-UNPAID", paid_at: null, paypal_fee: null, status: "SENT" },
      { paypal_invoice_id: "INV2-STUCK", paid_at: "2026-09-22T10:00:00Z", paypal_fee: null, status: "PAID" },
    ],
    orders: [
      order({ id: 1, status: "paid", paypal_invoice_id: "INV2-NEW", ship_to: null }),
      order({ id: 2, status: "paid", paypal_invoice_id: "INV2-STUCK", ship_to: { ...shipTo, name: "Typed By Hand" } }),
      order({ id: 3, status: "cancelled", paypal_invoice_id: "INV2-NEW", ship_to: null }),
    ],
  });

test("only recent paid invoices without a fee are candidates, oldest first", async () => {
  const { client } = recentSales();
  const ids = (await invoicesMissingCosts(client, NOW)).map((i) => i.paypal_invoice_id);
  assert.deepEqual(ids, ["INV2-STUCK", "INV2-NEW"]);
});

test("recording costs writes the fee and fills an empty ship-to on the live order only", async () => {
  const { client, db } = recentSales();
  const landed = await recordTransactionCosts(client, "INV2-NEW", { found: true, fee: 1.46, shipTo });
  assert.deepEqual(landed, { fee: 1.46, shipTo });
  assert.equal(db.tables.invoices[0].paypal_fee, 1.46);
  assert.deepEqual(db.tables.orders[0].ship_to, shipTo);
  assert.equal(db.tables.orders[2].ship_to, null, "the cancelled order is left alone");
});

test("an address already on the order is never overwritten", async () => {
  const { client, db } = recentSales();
  const landed = await recordTransactionCosts(client, "INV2-STUCK", { found: true, fee: 2, shipTo });
  assert.equal(landed.fee, 2);
  assert.equal(landed.shipTo, null);
  assert.equal((db.tables.orders[1].ship_to as { name: string }).name, "Typed By Hand");
});

test("a transaction with no fee or address yet writes nothing", async () => {
  const { client, db } = recentSales();
  const landed = await recordTransactionCosts(client, "INV2-NEW", { found: true, fee: null, shipTo: null });
  assert.deepEqual(landed, { fee: null, shipTo: null });
  assert.equal(db.tables.invoices[0].paypal_fee, null);
});

test("a sweep sorts each candidate into filled, pending, skipped, or failed", async () => {
  const { client, db } = recentSales();
  const sweep = await sweepMissingCosts(
    client,
    async (id) => {
      if (id === "INV2-NEW") return { found: true, fee: 1.46, shipTo };
      if (id === "INV2-STUCK") return { found: false, fee: null, shipTo: null };
      return null;
    },
    NOW
  );
  assert.deepEqual(sweep, {
    checked: ["INV2-STUCK", "INV2-NEW"],
    filled: [{ invoiceId: "INV2-NEW", fee: 1.46, shipTo: "Ann Buyer" }],
    pending: ["INV2-STUCK"],
    skipped: [],
    failed: [],
  });
  assert.equal(db.tables.invoices[0].paypal_fee, 1.46);

  // Once the fee is in, the invoice drops out of the next sweep.
  const again = await sweepMissingCosts(client, async () => null, NOW);
  assert.deepEqual(again.checked, ["INV2-STUCK"]);
  assert.deepEqual(again.skipped, ["INV2-STUCK"]);
});

test("one invoice's PayPal error doesn't stop the others", async () => {
  const { client, db } = recentSales();
  const sweep = await sweepMissingCosts(
    client,
    async (id) => {
      if (id === "INV2-STUCK") throw new Error("PayPal transaction lookup failed (500)");
      return { found: true, fee: 1.46, shipTo: null };
    },
    NOW
  );
  assert.deepEqual(sweep.failed, [
    { invoiceId: "INV2-STUCK", error: "PayPal transaction lookup failed (500)" },
  ]);
  assert.deepEqual(sweep.filled, [{ invoiceId: "INV2-NEW", fee: 1.46, shipTo: null }]);
  assert.equal(db.tables.invoices[0].paypal_fee, 1.46);
});
