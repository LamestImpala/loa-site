import type { DbRecord, Invoice, Order, Shipment } from "../supabase.ts";

// The inbox stats tiles: collection value, what sold, and what actually
// landed in the account. Pure — no React, no Supabase.

const sum = (list: DbRecord[], pick: (r: DbRecord) => number) =>
  list.reduce((total, r) => total + pick(r), 0);

export function salesStats(data: {
  records: DbRecord[];
  shipments: Shipment[];
  invoices: Invoice[];
  orders: Order[];
}) {
  const { records, shipments, invoices, orders } = data;
  // A refunded order earned nothing: the records it kept sold (shipped,
  // then refunded) and the shipping it charged both drop out. Its PayPal
  // fee and postage stay — that money is gone either way.
  const refundedOrders = orders.filter((o) => o.status === "refunded");
  const refundedIds = new Set(refundedOrders.map((o) => o.id));
  const refundedInvoices = new Set(
    refundedOrders.map((o) => o.paypal_invoice_id).filter(Boolean)
  );
  const forSale = records.filter((r) => r.listed && !r.sold);
  const sold = records.filter(
    (r) => r.sold && !(r.order_id != null && refundedIds.has(r.order_id))
  );
  const hidden = records.filter((r) => !r.listed && !r.sold);
  // Credits and partial refunds live on the order, not the records' sold
  // prices — take paid orders' off the sold total so it's what was kept.
  const paid = orders.filter((o) => o.status === "paid");
  const creditTotal = paid.reduce((t, o) => t + Number(o.credit ?? 0), 0);
  const refundedTotal = paid.reduce((t, o) => t + Number(o.refunded_amount ?? 0), 0);
  const soldTotal =
    sum(sold, (r) => Number(r.sold_price ?? r.price)) - creditTotal - refundedTotal;
  // Costs typed in from PayPal's transaction pages: fees and buyer-paid
  // shipping per invoice, postage per parcel. Net is what actually landed
  // in the account — record sales + shipping income − fees − postage.
  const feesTotal = invoices.reduce((t, inv) => t + Number(inv.paypal_fee ?? 0), 0);
  const shippingCharged = invoices.reduce(
    (t, inv) =>
      refundedInvoices.has(inv.paypal_invoice_id)
        ? t
        : t + Number(inv.shipping_charged ?? 0),
    0
  );
  const postageTotal = shipments.reduce((t, s) => t + Number(s.postage_cost ?? 0), 0);
  return {
    forSaleCount: forSale.length,
    askingTotal: sum(forSale, (r) => Number(r.price)),
    soldCount: sold.length,
    soldTotal,
    creditTotal,
    refundedTotal,
    asp: sold.length ? soldTotal / sold.length : 0,
    hiddenCount: hidden.length,
    hiddenTotal: sum(hidden, (r) => Number(r.price)),
    feesTotal,
    postageTotal,
    shippingCharged,
    netTotal: soldTotal + shippingCharged - feesTotal - postageTotal,
  };
}
