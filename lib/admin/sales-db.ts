import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRecord, Order, OrderRequest } from "../supabase.ts";
import { placeOrder, type PlacedOrder } from "./orders-db.ts";
import { finishedRequests, soldPatch } from "./sales.ts";

// The sale writes, shared by the admin provider (browser, admin token),
// the invoice check route (server, admin token) and the PayPal webhook
// (server, service role). Every sale lands the same way: the order first
// (paid), then each record, then the order requests it finished. The
// rules are in sales.ts and orders.ts.

export type SaleTerms = {
  prices?: Map<number, number>; // record id -> agreed price (only where it differs)
  credit?: number;
  creditNote?: string;
};

export type SoldResult = {
  placed: PlacedOrder;
  patches: Map<number, Partial<DbRecord>>; // what landed, per record
  soldIds: number[];
  failure: string | null; // first record write that failed; the rest stop
  finishedRequestIds: number[]; // order requests closed by this sale
};

// Throws when the order can't be placed — nothing is sold then, so a
// record never ends up sold outside a paid order. A failed record write
// stops the rest and comes back as `failure` with what already landed.
export async function markSold(
  supabase: SupabaseClient,
  targets: DbRecord[],
  buyer: string,
  opts: {
    terms?: SaleTerms;
    requests: OrderRequest[]; // open requests (new/loaded)
    byId: Map<number, DbRecord>; // records the requests point at
  }
): Promise<SoldResult> {
  const { terms, requests, byId } = opts;
  const extra: Partial<Order> | undefined =
    terms?.credit != null
      ? { credit: terms.credit, credit_note: (terms.creditNote ?? "").trim() }
      : undefined;
  const placed = await placeOrder(supabase, targets, buyer, "paid", {
    requests,
    extra,
  });
  const buyerName = buyer.trim() || placed.order.buyer_username || "";
  const { patches, soldIds, failure } = await writeSold(
    supabase,
    targets,
    buyerName,
    placed.order.id,
    terms?.prices
  );
  // Best-effort: close the requests this sale finished. A failure leaves
  // the request card with its manual buttons.
  let finishedRequestIds: number[] = [];
  if (!failure) {
    const finished = finishedRequests(requests, new Set(soldIds), byId);
    if (finished.length > 0) {
      const { error } = await supabase
        .from("order_requests")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .in(
          "id",
          finished.map((r) => r.id)
        );
      if (error) console.warn("order request auto-complete failed:", error.message);
      else finishedRequestIds = finished.map((r) => r.id);
    }
  }
  return { placed, patches, soldIds, failure, finishedRequestIds };
}

// The record half of a sale, into an order that's already placed: each
// record's sold patch, in chunks of 10. A failed write stops the rest;
// what landed comes back.
async function writeSold(
  supabase: SupabaseClient,
  targets: DbRecord[],
  buyerName: string,
  orderId: number,
  prices?: Map<number, number>
): Promise<{
  patches: Map<number, Partial<DbRecord>>;
  soldIds: number[];
  failure: string | null;
}> {
  const now = new Date();
  const all = new Map(
    targets.map((r) => [
      r.id,
      { ...soldPatch(r, buyerName, now, prices?.get(r.id)), order_id: orderId },
    ])
  );
  const soldIds: number[] = [];
  let failure: string | null = null;
  const chunk = 10;
  for (let i = 0; i < targets.length && !failure; i += chunk) {
    const slice = targets.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map((r) =>
        supabase
          .from("records")
          .update({ ...all.get(r.id), updated_at: new Date().toISOString() })
          .eq("id", r.id)
      )
    );
    slice.forEach((r, j) => {
      if (results[j].error) failure = failure ?? results[j].error!.message;
      else soldIds.push(r.id);
    });
  }
  const patches = new Map([...all].filter(([id]) => soldIds.includes(id)));
  return { patches, soldIds, failure };
}

export type Settled =
  | { kind: "sold"; orderId: number; soldIds: number[]; failure: string | null }
  | { kind: "closed"; orderId: number } // paid, but its records had moved on
  | { kind: "none" }; // no open order on this invoice — already settled

// A paid invoice becomes a sale: the open (invoiced or held) order it
// belongs to, its unsold records sold to the order's buyer at their
// negotiated prices. Safe to run again — a settled order with nothing
// left unsold is a no-op, and one a failed write left half-sold gets the
// rest — so the webhook, its retries and the inbox check can all call it.
export async function settlePaidInvoice(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<Settled> {
  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("paypal_invoice_id", invoiceId)
    .in("status", ["invoiced", "held", "paid"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw new Error(`Couldn't read the order: ${orderError.message}`);
  const order = orderRow as Order | null;
  if (!order) return { kind: "none" };

  const { data: recRows, error: recError } = await supabase
    .from("records")
    .select("*")
    .eq("order_id", order.id)
    .eq("sold", false);
  if (recError) throw new Error(`Couldn't read the records: ${recError.message}`);
  const targets = (recRows ?? []) as DbRecord[];
  if (order.status === "paid") {
    // Settled before. Unsold records still on it are a sale that stopped
    // partway (a failed write): finish them in the same order.
    if (targets.length === 0) return { kind: "none" };
    const { soldIds, failure } = await writeSold(
      supabase,
      targets,
      order.buyer_username,
      order.id
    );
    return { kind: "sold", orderId: order.id, soldIds, failure };
  }
  if (targets.length === 0) {
    const { error } = await supabase
      .from("orders")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    if (error) throw new Error(`Couldn't close the order: ${error.message}`);
    return { kind: "closed", orderId: order.id };
  }

  const { data: reqRows, error: reqError } = await supabase
    .from("order_requests")
    .select("*")
    .in("status", ["new", "loaded"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (reqError) throw new Error(`Couldn't read order requests: ${reqError.message}`);
  const requests = (reqRows ?? []) as OrderRequest[];
  const wanted = [...new Set(requests.flatMap((r) => r.record_ids ?? []))];
  const { data: wantedRows, error: wantedError } = wanted.length
    ? await supabase.from("records").select("*").in("id", wanted)
    : { data: [], error: null };
  if (wantedError) throw new Error(`Couldn't read records: ${wantedError.message}`);
  const byId = new Map(
    [...((wantedRows ?? []) as DbRecord[]), ...targets].map((r) => [r.id, r])
  );

  const result = await markSold(supabase, targets, order.buyer_username, {
    requests,
    byId,
  });
  return {
    kind: "sold",
    orderId: result.placed.order.id,
    soldIds: result.soldIds,
    failure: result.failure,
  };
}
