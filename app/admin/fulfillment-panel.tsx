"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRecord, Invoice, Order, Shipment } from "@/lib/supabase";
import {
  buyerNudge,
  confirmationComment,
  groupOrders,
  inPayPal,
  needsRepush,
  pushNotNeeded,
  type OrderGroup,
} from "@/lib/admin/fulfillment";
import { blurOnEnter, buttonClass, inputClass, smallButtonClass, useCopied } from "./_shell/ui";
import { BuyerField } from "./_shell/buyer-field";

/*
 * Fulfillment: sold records grouped by order, split into parcels
 * (shipments rows) that each carry one tracking number. The buyer's name
 * lives on the order and is edited on the card; sales that predate the
 * orders table still group by buyer name.
 *
 * The usual flow is labels bought inside PayPal from the paid invoice —
 * "Sync from PayPal" pulls those tracking numbers down. Labels bought
 * elsewhere are typed into a manual parcel and pushed up instead, which
 * also emails the buyer through PayPal. Sales paid off-PayPal just store
 * tracking with no sync in either direction.
 *
 * shipments is the source of truth; records.tracking_number is mirrored
 * per member record so the listings table's quick input stays accurate.
 *
 * Costs live here too: each parcel takes a postage cost, and each invoice
 * takes the PayPal fee and buyer-paid shipping (both read off PayPal's
 * transaction page). They feed the Net stats tile and the tax records.
 */


const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"];

// A fulfilled order stays under "completed" this long after its last
// shipment update, then moves to the archive. Keyed to fulfillment (not the
// sale date) so an order still in transit never archives early — the window
// covers delivery plus an it-arrived-damaged grace period.
const ARCHIVE_AFTER_DAYS = 21;

export function FulfillmentPanel({
  records,
  shipments,
  invoices,
  orders,
  supabase,
  onShipmentsChange,
  onInvoicesChange,
  onOrdersChange,
  onRecordPatched,
  onRenameBuyer,
  getAccessToken,
  copyText,
  pushToast,
  defaultThreadUrl,
}: {
  records: DbRecord[]; // sold records only
  shipments: Shipment[];
  invoices: Invoice[];
  orders: Order[];
  supabase: SupabaseClient;
  // Functional-updater form so async handlers can't clobber each other
  // with a stale copy of the list.
  onShipmentsChange: (update: (prev: Shipment[]) => Shipment[]) => void;
  onInvoicesChange: (update: (prev: Invoice[]) => Invoice[]) => void;
  onOrdersChange: (update: (prev: Order[]) => Order[]) => void;
  onRecordPatched: (id: number, patch: Partial<DbRecord>) => void;
  // Renames the buyer on the order and mirrors it to records and parcels.
  onRenameBuyer: (order: Order, buyer: string) => Promise<boolean>;
  getAccessToken: () => Promise<string>;
  // Shared clipboard helper — falls back to a copy-by-hand modal upstream.
  copyText: (text: string, fallbackTitle: string) => Promise<boolean>;
  // Page-level toast stack, so failures and results are visible even when
  // the card that produced them has scrolled away.
  pushToast?: (kind: "error" | "success" | "info", text: string) => void;
  defaultThreadUrl: string; // the saved sale-post URL (settings reddit_post_url)
}) {
  const [showDone, setShowDone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [trackingEdits, setTrackingEdits] = useState<Record<number, string>>({});
  const [invoiceEdits, setInvoiceEdits] = useState<Record<string, string>>({});
  const [postageEdits, setPostageEdits] = useState<Record<number, string>>({});
  // Keyed `${group key}:paypal_fee` / `${group key}:shipping_charged`.
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});
  const [threadEdits, setThreadEdits] = useState<Record<string, string>>({});
  // `${group key}:confirm` / `${group key}:nudge` — transient "Copied!" label.
  const { isCopied, flash: flashCopied } = useCopied(2000);
  const [busy, setBusy] = useState<string | null>(null); // group key or `ship-${id}`
  const [notes, setNotes] = useState<Record<string, string>>({}); // group key or shipment id -> status text

  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const invoiceById = useMemo(
    () => new Map(invoices.map((inv) => [inv.paypal_invoice_id, inv])),
    [invoices]
  );

  const groups = useMemo(
    () => groupOrders(records, shipments, orders),
    [records, shipments, orders]
  );

  // Fulfilled orders age out of the completed list into a month-grouped
  // archive once the delivery/grace window has passed.
  const archiveCutoff = Date.now() - ARCHIVE_AFTER_DAYS * 24 * 3600 * 1000;
  const completedGroups = groups.filter(
    (g) => g.done && g.lastActivity >= archiveCutoff
  );
  const archivedGroups = groups
    .filter((g) => g.done && g.lastActivity < archiveCutoff)
    .sort((a, b) => b.lastActivity - a.lastActivity);
  const visibleGroups = groups.filter(
    (g) => !g.done || (showDone && g.lastActivity >= archiveCutoff)
  );
  const archivedByMonth: [string, OrderGroup[]][] = [];
  for (const g of archivedGroups) {
    const label = new Date(g.lastActivity).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    const bucket = archivedByMonth.find(([l]) => l === label);
    if (bucket) bucket[1].push(g);
    else archivedByMonth.push([label, [g]]);
  }

  // Inline status under the card; outcomes (not progress text) also go to
  // the page toast stack when one is wired in.
  function note(
    key: string,
    text: string,
    kind?: "error" | "success" | "info"
  ) {
    setNotes((prev) => ({ ...prev, [key]: text }));
    if (kind && text && pushToast) pushToast(kind, text);
  }

  function patchShipment(id: number, patch: Partial<Shipment>) {
    onShipmentsChange((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }

  // Mirror a parcel's tracking number onto its member records; when a
  // record leaves a parcel, fall back to whatever other parcel covers it.
  async function mirrorTracking(recordIds: number[], value: string) {
    if (recordIds.length === 0) return;
    const { error } = await supabase
      .from("records")
      .update({ tracking_number: value, updated_at: new Date().toISOString() })
      .in("id", recordIds);
    if (error) {
      note("panel", `Saving tracking on records failed: ${error.message}`, "error");
      return;
    }
    for (const id of recordIds) onRecordPatched(id, { tracking_number: value });
  }

  async function createParcel(g: OrderGroup) {
    const ids = (selected[g.key] ?? []).filter((id) =>
      g.unassigned.some((r) => r.id === id)
    );
    if (ids.length === 0 || busy) return;
    setBusy(g.key);
    const invoiceId = (invoiceEdits[g.key] ?? g.invoiceId).trim() || null;
    const { data, error } = await supabase
      .from("shipments")
      .insert({
        buyer_username: g.buyer,
        order_id: g.order?.id ?? null,
        record_ids: ids,
        mode: "manual",
        status: "draft",
        carrier: "USPS",
        paypal_invoice_id: invoiceId,
      })
      .select()
      .single();
    setBusy(null);
    if (error) {
      note(g.key, `Couldn't create the parcel: ${error.message}`, "error");
      return;
    }
    onShipmentsChange((prev) => [data as Shipment, ...prev]);
    setSelected((prev) => ({ ...prev, [g.key]: [] }));
    note(g.key, "");
  }

  async function deleteParcel(s: Shipment) {
    if (busy) return;
    if (!window.confirm("Delete this parcel? Its tracking number is discarded."))
      return;
    setBusy(`ship-${s.id}`);
    const { error } = await supabase.from("shipments").delete().eq("id", s.id);
    setBusy(null);
    if (error) {
      note(`ship-${s.id}`, `Delete failed: ${error.message}`, "error");
      return;
    }
    onShipmentsChange((prev) => prev.filter((x) => x.id !== s.id));
    // Clear the mirrored number where no other parcel still covers it.
    const covered = new Set(
      shipments
        .filter((x) => x.id !== s.id)
        .flatMap((x) => x.record_ids ?? [])
    );
    const toClear = (s.record_ids ?? []).filter(
      (id) => !covered.has(id) && byId.get(id)?.tracking_number
    );
    await mirrorTracking(toClear, "");
  }

  async function saveShipment(s: Shipment, patch: Partial<Shipment>) {
    const { error } = await supabase
      .from("shipments")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) {
      note(`ship-${s.id}`, `Save failed: ${error.message}`, "error");
      return false;
    }
    patchShipment(s.id, patch);
    return true;
  }

  async function saveTracking(s: Shipment) {
    // Fall back to the stored code — a focus+blur with no typing must
    // not read as "cleared".
    const value = (trackingEdits[s.id] ?? s.tracking_code ?? "").trim();
    if (value === (s.tracking_code ?? "")) return;
    const ok = await saveShipment(s, {
      tracking_code: value || null,
      status: value ? "shipped" : "draft",
    });
    if (ok) {
      setTrackingEdits((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      await mirrorTracking(s.record_ids ?? [], value);
    }
  }

  // "" clears the stored amount; "$" prefixes are tolerated.
  function parseMoney(raw: string): number | null | undefined {
    const t = raw.trim().replace(/^\$/, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  async function savePostage(s: Shipment) {
    const raw = postageEdits[s.id];
    if (raw === undefined) return;
    const value = parseMoney(raw);
    if (value === undefined) {
      note(`ship-${s.id}`, `"${raw}" isn't a valid postage cost.`, "error");
      return;
    }
    // Postgres numerics arrive as strings — normalize before comparing.
    if (value === (s.postage_cost == null ? null : Number(s.postage_cost)))
      return;
    const ok = await saveShipment(s, { postage_cost: value });
    if (ok) {
      setPostageEdits((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
    }
  }

  async function saveInvoiceCost(
    g: OrderGroup,
    field: "paypal_fee" | "shipping_charged"
  ) {
    const raw = costEdits[`${g.key}:${field}`];
    if (raw === undefined) return;
    const invoiceId = (invoiceEdits[g.key] ?? g.invoiceId).trim();
    if (!invoiceId) return;
    const value = parseMoney(raw);
    if (value === undefined) {
      note(g.key, `"${raw}" isn't a valid amount.`, "error");
      return;
    }
    const stored = invoiceById.get(invoiceId)?.[field];
    if (value === (stored == null ? null : Number(stored))) return;
    const { data, error } = await supabase
      .from("invoices")
      .upsert({
        paypal_invoice_id: invoiceId,
        [field]: value,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) {
      note(g.key, `Saving the amount failed: ${error.message}`, "error");
      return;
    }
    const saved = data as Invoice;
    onInvoicesChange((prev) => [
      saved,
      ...prev.filter((inv) => inv.paypal_invoice_id !== invoiceId),
    ]);
    setCostEdits((prev) => {
      const next = { ...prev };
      delete next[`${g.key}:${field}`];
      return next;
    });
    note(g.key, "");
  }

  async function saveThreadUrl(g: OrderGroup) {
    const raw = threadEdits[g.key];
    if (raw === undefined) return;
    const invoiceId = (invoiceEdits[g.key] ?? g.invoiceId).trim();
    if (!invoiceId) return;
    const value = raw.trim();
    const stored = invoiceById.get(invoiceId)?.reddit_thread_url ?? "";
    if (value === stored) return;
    const { data, error } = await supabase
      .from("invoices")
      .upsert({
        paypal_invoice_id: invoiceId,
        reddit_thread_url: value || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) {
      note(g.key, `Saving the thread URL failed: ${error.message}`, "error");
      return;
    }
    const saved = data as Invoice;
    onInvoicesChange((prev) => [
      saved,
      ...prev.filter((inv) => inv.paypal_invoice_id !== invoiceId),
    ]);
    setThreadEdits((prev) => {
      const next = { ...prev };
      delete next[g.key];
      return next;
    });
    note(g.key, "");
  }

  function threadUrlFor(g: OrderGroup, invoice: Invoice | undefined) {
    return (
      (threadEdits[g.key] ?? invoice?.reddit_thread_url ?? "").trim() ||
      defaultThreadUrl.trim()
    );
  }

  async function copyTradeConfirmation(g: OrderGroup, invoice: Invoice | undefined) {
    // Copy before anything else — Safari only allows clipboard writes in the
    // synchronous part of the click gesture.
    const ok = await copyText(
      confirmationComment(g.buyer, g.records),
      "Copy the trade confirmation comment"
    );
    if (ok) flashCopied(`${g.key}:confirm`);
    const url = threadUrlFor(g, invoice);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      note(
        g.key,
        "No thread URL — save the sale post in the Reddit section or type one here.",
        "error"
      );
    }
  }

  async function copyBuyerNudge(g: OrderGroup, invoice: Invoice | undefined) {
    const ok = await copyText(
      buyerNudge(g.buyer, threadUrlFor(g, invoice)),
      "Copy the buyer nudge"
    );
    if (ok) flashCopied(`${g.key}:nudge`);
  }

  async function toggleMember(s: Shipment, recordId: number, add: boolean) {
    const current = s.record_ids ?? [];
    const next = add
      ? [...current, recordId]
      : current.filter((id) => id !== recordId);
    const ok = await saveShipment(s, { record_ids: next });
    if (!ok) return;
    if (add) {
      if (s.tracking_code) await mirrorTracking([recordId], s.tracking_code);
    } else {
      const other = shipments.find(
        (x) => x.id !== s.id && (x.record_ids ?? []).includes(recordId)
      );
      await mirrorTracking([recordId], other?.tracking_code ?? "");
    }
  }

  async function saveInvoiceId(g: OrderGroup) {
    // Fall back to the current id — a focus+blur with no typing must not
    // read as "cleared".
    const value = (invoiceEdits[g.key] ?? g.invoiceId).trim();
    if (value === g.invoiceId) return;
    const recordIds = g.records.map((r) => r.id);
    const { error } = await supabase
      .from("records")
      .update({
        paypal_invoice_id: value || null,
        updated_at: new Date().toISOString(),
      })
      .in("id", recordIds);
    if (error) {
      note(g.key, `Saving the invoice id failed: ${error.message}`, "error");
      return;
    }
    for (const id of recordIds)
      onRecordPatched(id, { paypal_invoice_id: value || null });
    // The order remembers its invoice; that's what sync and the pending
    // card read.
    if (g.order) {
      const orderId = g.order.id;
      const { error: orderError } = await supabase
        .from("orders")
        .update({
          paypal_invoice_id: value || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      if (orderError) {
        note(g.key, `Saving the invoice on the order failed: ${orderError.message}`, "error");
        return;
      }
      onOrdersChange((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, paypal_invoice_id: value || null } : o
        )
      );
    }
    // Parcels not yet known to PayPal follow the group's invoice.
    const followers = g.shipments.filter((s) => !s.paypal_tracker_id);
    if (followers.length > 0) {
      const followerIds = followers.map((s) => s.id);
      const { error: shipError } = await supabase
        .from("shipments")
        .update({
          paypal_invoice_id: value || null,
          updated_at: new Date().toISOString(),
        })
        .in("id", followerIds);
      if (shipError) {
        note(g.key, `Updating parcels failed: ${shipError.message}`, "error");
        return;
      }
      const followerSet = new Set(followerIds);
      onShipmentsChange((prev) =>
        prev.map((s) =>
          followerSet.has(s.id)
            ? { ...s, paypal_invoice_id: value || null }
            : s
        )
      );
    }
    note(g.key, "");
  }

  async function callApi(payload: object): Promise<Record<string, unknown>> {
    const token = await getAccessToken();
    const res = await fetch("/api/paypal-tracking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error as string) || "Request failed");
    return body;
  }

  async function syncFromPayPal(g: OrderGroup) {
    const invoiceId = (invoiceEdits[g.key] ?? g.invoiceId).trim();
    if (!invoiceId || busy) return;
    setBusy(g.key);
    note(g.key, "Syncing…");
    try {
      const body = await callApi({ action: "pull", invoiceId });
      // The route reads the invoice's paid date, shipping charge and (via
      // Transaction Search) the PayPal fee — reflect what it recorded. This
      // runs before the error return: an invoice marked paid offline still
      // comes back with a row so the confirmation buttons appear.
      const inv = (body.invoice ?? null) as Invoice | null;
      if (inv) {
        onInvoicesChange((prev) => [
          inv,
          ...prev.filter(
            (x) => x.paypal_invoice_id !== inv.paypal_invoice_id
          ),
        ]);
        setCostEdits((prev) => {
          const next = { ...prev };
          delete next[`${g.key}:paypal_fee`];
          delete next[`${g.key}:shipping_charged`];
          return next;
        });
      }
      if (body.error) {
        note(g.key, String(body.error), "error");
        return;
      }
      const returned = (body.shipments ?? []) as Shipment[];
      const returnedIds = new Set(returned.map((s) => s.id));
      onShipmentsChange((prev) => [
        ...returned,
        ...prev.filter((s) => !returnedIds.has(s.id)),
      ]);
      setTrackingEdits((prev) => {
        const next = { ...prev };
        for (const id of returnedIds) delete next[id];
        return next;
      });
      // The route mirrors tracking onto records when it auto-assigns a
      // single parcel — reflect that here without a reload.
      for (const s of (body.created ?? []) as Shipment[]) {
        for (const id of s.record_ids ?? []) {
          if (s.tracking_code)
            onRecordPatched(id, { tracking_number: s.tracking_code });
        }
      }
      const costBits = [
        inv?.paypal_fee != null ? `fee $${inv.paypal_fee}` : null,
        inv?.shipping_charged != null
          ? `shipping $${inv.shipping_charged}`
          : null,
      ].filter(Boolean);
      const created = ((body.created ?? []) as Shipment[]).length;
      note(
        g.key,
        [
          `Found ${body.trackersFound ?? 0} tracking number${
            body.trackersFound === 1 ? "" : "s"
          } in PayPal${created ? `, ${created} new` : ""}.`,
          costBits.length ? `Recorded ${costBits.join(" · ")}.` : null,
          (body.feeNote as string | null) ?? null,
        ]
          .filter(Boolean)
          .join(" "),
        "success"
      );
    } catch (e) {
      note(g.key, e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function pushToPayPal(list: Shipment[], noteKey: string) {
    const ids = list.map((s) => s.id);
    if (ids.length === 0 || busy) return;
    if (
      !window.confirm(
        `Push ${ids.length} tracking number${ids.length === 1 ? "" : "s"} to PayPal? PayPal emails the buyer a shipping notification.`
      )
    )
      return;
    setBusy(noteKey);
    note(noteKey, "Pushing…");
    try {
      const body = await callApi({ action: "push", shipmentIds: ids });
      const results = (body.results ?? []) as {
        shipmentId: number;
        ok: boolean;
        trackerId?: string;
        error?: string;
      }[];
      let sent = 0;
      const problems: string[] = [];
      const now = new Date().toISOString();
      for (const res of results) {
        if (res.ok) sent += 1;
        else if (res.error) problems.push(res.error);
      }
      const byShipment = new Map(results.map((r) => [r.shipmentId, r]));
      onShipmentsChange((prev) =>
        prev.map((s) => {
          const res = byShipment.get(s.id);
          if (!res?.ok) return s;
          return {
            ...s,
            paypal_tracker_id: res.trackerId ?? s.paypal_tracker_id,
            paypal_tracked_number: s.tracking_code,
            paypal_synced_at: now,
          };
        })
      );
      note(
        noteKey,
        [
          sent ? `Sent ${sent} to PayPal — buyer notified.` : null,
          ...problems,
        ]
          .filter(Boolean)
          .join(" ") || "Nothing to push.",
        "success"
      );
    } catch (e) {
      note(noteKey, e instanceof Error ? e.message : "Push failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const recordLabel = (id: number) => {
    const r = byId.get(id);
    return r ? `${r.artist} — ${r.title}` : `#${id}`;
  };

  const doneCount = completedGroups.length;

  return (
    <div className="mt-3">
      <p className="text-sm text-neutral-400">
        One card per order. Split each order into parcels, one
        tracking number per parcel. &ldquo;Sync from PayPal&rdquo; pulls the
        numbers from labels bought inside PayPal; a manual parcel&rsquo;s
        number can be pushed the other way (PayPal emails the buyer). PayPal
        Shipping labels never show up in the sync — click a parcel&rsquo;s
        &ldquo;manual&rdquo; chip to mark it &ldquo;PayPal label&rdquo; instead
        of pushing, since its tracking is already on the transaction. Each
        parcel takes its postage cost, and each invoice the PayPal fee and
        shipping charged — those feed the Net stat and the tax records.
      </p>
      {notes["panel"] ? (
        <p className="mt-2 text-xs text-yellow-400">{notes["panel"]}</p>
      ) : null}
      {doneCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className={`mt-3 ${smallButtonClass}`}
        >
          {showDone ? "Hide" : "Show"} {doneCount} completed order
          {doneCount === 1 ? "" : "s"}
        </button>
      ) : null}
      {visibleGroups.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">
          Nothing to fulfill — sold records with a buyer show up here.
        </p>
      ) : (
        <div className="mt-3 grid gap-3">{visibleGroups.map(renderGroup)}</div>
      )}
      {archivedGroups.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            title={`Orders fully fulfilled more than ${ARCHIVE_AFTER_DAYS} days ago`}
            className={smallButtonClass}
          >
            {showArchive ? "Hide" : "Show"} archive ({archivedGroups.length}{" "}
            order{archivedGroups.length === 1 ? "" : "s"})
          </button>
          {showArchive
            ? archivedByMonth.map(([label, gs]) => (
                <div key={label} className="mt-4">
                  <h4 className="text-sm font-medium text-neutral-500">
                    {label} · {gs.length} order{gs.length === 1 ? "" : "s"}
                  </h4>
                  <div className="mt-2 grid gap-3">{gs.map(renderGroup)}</div>
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );

  // Shared order-card renderer for the active/completed list and the archive.
  function renderGroup(g: OrderGroup) {
    const invoiceValue = invoiceEdits[g.key] ?? g.invoiceId;
    const invoice = invoiceById.get(invoiceValue.trim());
    const costValue = (field: "paypal_fee" | "shipping_charged") =>
      costEdits[`${g.key}:${field}`] ??
      (invoice?.[field] == null ? "" : String(invoice[field]));
    const groupBusy = busy === g.key;
    // What the order was invoiced at: record sold prices plus the buyer-paid
    // shipping once it's recorded on the invoice.
    const recordsTotal = g.records.reduce(
      (t, r) => t + Number(r.sold_price ?? r.price),
      0
    );
    const shippingCharged =
      invoice?.shipping_charged == null
        ? null
        : Number(invoice.shipping_charged);
    const invoicedTotal = recordsTotal + (shippingCharged ?? 0);
    const money = (n: number) =>
      `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const pushables = g.shipments.filter(
      (s) =>
        s.tracking_code &&
        s.paypal_invoice_id &&
        !inPayPal(s) &&
        !pushNotNeeded(s)
    );
    const paid = !!invoice?.paid_at;
    return (
              <div
                key={g.key}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  {g.order ? (
                    <BuyerField
                      value={g.buyer}
                      disabled={groupBusy}
                      onSave={(next) => onRenameBuyer(g.order!, next)}
                    />
                  ) : (
                    <span
                      className="font-medium"
                      title="Sold before the orders table existed — grouped by the buyer name on the records"
                    >
                      {g.buyer ? `u/${g.buyer}` : "No buyer set"}
                    </span>
                  )}
                  {g.records.length > 0 ? (
                    <span
                      className="text-sm text-green-400"
                      title={
                        shippingCharged == null
                          ? `Records ${money(recordsTotal)} — shipping not recorded yet`
                          : `Records ${money(recordsTotal)} + shipping ${money(shippingCharged)}`
                      }
                    >
                      {money(invoicedTotal)}
                    </span>
                  ) : null}
                  <span className="text-xs text-neutral-500">
                    {g.records.length} record{g.records.length === 1 ? "" : "s"}{" "}
                    · {g.shipments.length} parcel
                    {g.shipments.length === 1 ? "" : "s"}
                  </span>
                  {paid ? (
                    <span
                      className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-400"
                      title="PayPal reported this invoice paid on the last sync"
                    >
                      Paid{" "}
                      {new Date(invoice!.paid_at!).toLocaleDateString()}
                    </span>
                  ) : null}
                  {g.done ? (
                    <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                      Fulfilled
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={invoiceValue}
                    onChange={(e) =>
                      setInvoiceEdits((prev) => ({
                        ...prev,
                        [g.key]: e.target.value,
                      }))
                    }
                    onBlur={() => saveInvoiceId(g)}
                    onKeyDown={blurOnEnter}
                    placeholder="PayPal invoice id (INV2-…)"
                    className={`w-64 ${inputClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => syncFromPayPal(g)}
                    disabled={!invoiceValue.trim() || groupBusy}
                    title="Record the invoice's PayPal fee and shipping charge, and read tracking from labels bought via the transaction page (PayPal Shipping labels don't appear — mark those parcels 'PayPal label')"
                    className={buttonClass}
                  >
                    {groupBusy ? "Working…" : "Sync from PayPal"}
                  </button>
                  {pushables.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => pushToPayPal(pushables, g.key)}
                      disabled={groupBusy}
                      title="Send this order's manual tracking numbers to PayPal — the buyer gets a shipping email"
                      className={buttonClass}
                    >
                      Push {pushables.length} to PayPal
                    </button>
                  ) : null}
                  {paid && g.records.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => copyTradeConfirmation(g, invoice)}
                        disabled={!g.buyer}
                        title={
                          g.buyer
                            ? "Copies the r/VinylCollectors confirmation comment (plain-text u/ tags — the bot can't read links) and opens the thread. Paste it as a NEW top-level comment; editing an old comment doesn't count."
                            : "Set the buyer's Reddit username on the records first."
                        }
                        className={buttonClass}
                      >
                        {isCopied(`${g.key}:confirm`)
                          ? "Copied!"
                          : "Copy trade confirmation"}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyBuyerNudge(g, invoice)}
                        disabled={!g.buyer}
                        title="Copies a DM asking the buyer to reply to the confirmation comment so the bot credits the trade"
                        className={buttonClass}
                      >
                        {isCopied(`${g.key}:nudge`)
                          ? "Copied!"
                          : "Copy buyer nudge"}
                      </button>
                      <input
                        type="text"
                        value={
                          threadEdits[g.key] ??
                          invoice?.reddit_thread_url ??
                          ""
                        }
                        onChange={(e) =>
                          setThreadEdits((prev) => ({
                            ...prev,
                            [g.key]: e.target.value,
                          }))
                        }
                        onBlur={() => saveThreadUrl(g)}
                        onKeyDown={blurOnEnter}
                        placeholder="confirmation thread URL (this sale)"
                        title="Used instead of the saved sale-post URL for this sale — e.g. when it came from a weekly post. Blank = default."
                        className={`w-72 ${inputClass}`}
                      />
                    </>
                  ) : null}
                  {invoiceValue.trim() ? (
                    <>
                      <input
                        type="text"
                        value={costValue("paypal_fee")}
                        onChange={(e) =>
                          setCostEdits((prev) => ({
                            ...prev,
                            [`${g.key}:paypal_fee`]: e.target.value,
                          }))
                        }
                        onBlur={() => saveInvoiceCost(g, "paypal_fee")}
                        onKeyDown={blurOnEnter}
                        placeholder="PayPal fee $"
                        title="PayPal's transaction fee, from the transaction details page — a deductible cost"
                        className={`w-28 ${inputClass}`}
                      />
                      <input
                        type="text"
                        value={costValue("shipping_charged")}
                        onChange={(e) =>
                          setCostEdits((prev) => ({
                            ...prev,
                            [`${g.key}:shipping_charged`]: e.target.value,
                          }))
                        }
                        onBlur={() => saveInvoiceCost(g, "shipping_charged")}
                        onKeyDown={blurOnEnter}
                        placeholder="shipping charged $"
                        title="Shipping the buyer paid on this invoice — counted as income in the Net stat"
                        className={`w-36 ${inputClass}`}
                      />
                    </>
                  ) : null}
                </div>
                {notes[g.key] ? (
                  <p className="mt-2 text-xs text-yellow-400">{notes[g.key]}</p>
                ) : null}

                {g.unassigned.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-white/10 p-3">
                    <p className="text-xs text-neutral-400">
                      Not in a parcel yet:
                    </p>
                    <div className="mt-2 flex flex-col gap-1">
                      {g.unassigned.map((r) => (
                        <label
                          key={r.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="admin-checkbox"
                            checked={(selected[g.key] ?? []).includes(r.id)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const current = prev[g.key] ?? [];
                                return {
                                  ...prev,
                                  [g.key]: e.target.checked
                                    ? [...current, r.id]
                                    : current.filter((id) => id !== r.id),
                                };
                              })
                            }
                          />
                          <span>
                            {r.artist} — {r.title}
                          </span>
                          {r.picked_at ? (
                            <span
                              title="Pulled from the shelf (pick list)"
                              className="text-xs text-emerald-400"
                            >
                              pulled ✓
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => createParcel(g)}
                      disabled={
                        (selected[g.key] ?? []).length === 0 || groupBusy
                      }
                      className={`mt-2 ${smallButtonClass}`}
                    >
                      New parcel ({(selected[g.key] ?? []).length} selected)
                    </button>
                  </div>
                ) : null}

                {g.shipments.map((s, i) => {
                  const shipKey = `ship-${s.id}`;
                  const shipBusy = busy === shipKey;
                  return (
                    <div
                      key={s.id}
                      className="mt-3 rounded-xl border border-white/10 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-neutral-300">
                          Parcel {i + 1}
                        </span>
                        {s.paypal_tracker_id ? (
                          <span className="text-xs text-neutral-500">
                            {s.mode === "paypal" ? "PayPal label" : "manual"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              saveShipment(s, {
                                mode:
                                  s.mode === "paypal" ? "manual" : "paypal",
                              })
                            }
                            title={
                              s.mode === "paypal"
                                ? "Label bought inside PayPal — tracking is already on the transaction, nothing to push. Click if it was bought elsewhere."
                                : "Label bought elsewhere — tracking can be pushed to PayPal. Click if it was bought inside PayPal."
                            }
                            className="text-xs text-neutral-500 underline decoration-dotted underline-offset-2 transition hover:text-white"
                          >
                            {s.mode === "paypal" ? "PayPal label" : "manual"}
                          </button>
                        )}
                        {inPayPal(s) ? (
                          <span
                            className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-400"
                            title={s.paypal_tracker_id ?? ""}
                          >
                            In PayPal
                            {s.paypal_synced_at
                              ? ` · ${new Date(s.paypal_synced_at).toLocaleDateString()}`
                              : ""}
                          </span>
                        ) : needsRepush(s) ? (
                          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                            Tracking changed — push again
                          </span>
                        ) : null}
                        {!s.paypal_invoice_id ? (
                          <span
                            className="text-xs text-neutral-500"
                            title="Paid off-PayPal — tracking is stored here only; tell the buyer yourself"
                          >
                            no invoice
                          </span>
                        ) : null}
                        {!s.paypal_tracker_id ? (
                          <button
                            type="button"
                            onClick={() => deleteParcel(s)}
                            disabled={shipBusy}
                            className="ml-auto text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={trackingEdits[s.id] ?? s.tracking_code ?? ""}
                          onChange={(e) =>
                            setTrackingEdits((prev) => ({
                              ...prev,
                              [s.id]: e.target.value,
                            }))
                          }
                          onBlur={() => saveTracking(s)}
                          onKeyDown={blurOnEnter}
                          placeholder="tracking #"
                          className={`w-56 ${inputClass}`}
                        />
                        <select
                          value={
                            CARRIERS.includes(s.carrier) ? s.carrier : "OTHER"
                          }
                          onChange={(e) =>
                            saveShipment(s, { carrier: e.target.value })
                          }
                          className={inputClass}
                        >
                          {CARRIERS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={
                            postageEdits[s.id] ??
                            (s.postage_cost == null
                              ? ""
                              : String(s.postage_cost))
                          }
                          onChange={(e) =>
                            setPostageEdits((prev) => ({
                              ...prev,
                              [s.id]: e.target.value,
                            }))
                          }
                          onBlur={() => savePostage(s)}
                          onKeyDown={blurOnEnter}
                          placeholder="postage $"
                          title="What this label cost — a deductible cost, feeds the Net stat"
                          className={`w-28 ${inputClass}`}
                        />
                        {s.paypal_invoice_id &&
                        s.tracking_code &&
                        !inPayPal(s) &&
                        !pushNotNeeded(s) ? (
                          <button
                            type="button"
                            onClick={() => pushToPayPal([s], shipKey)}
                            disabled={shipBusy}
                            className={buttonClass}
                          >
                            {shipBusy
                              ? "Pushing…"
                              : needsRepush(s)
                                ? "Re-push to PayPal"
                                : "Push to PayPal"}
                          </button>
                        ) : null}
                      </div>
                      {notes[shipKey] ? (
                        <p className="mt-2 text-xs text-yellow-400">
                          {notes[shipKey]}
                        </p>
                      ) : null}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(s.record_ids ?? []).map((id) => (
                          <span
                            key={id}
                            className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs"
                          >
                            {recordLabel(id)}
                            <button
                              type="button"
                              onClick={() => toggleMember(s, id, false)}
                              title="Remove from this parcel"
                              className="text-neutral-500 transition hover:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {g.unassigned.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => toggleMember(s, r.id, true)}
                            title="Add to this parcel"
                            className={smallButtonClass}
                          >
                            + {r.artist} — {r.title}
                          </button>
                        ))}
                        {(s.record_ids ?? []).length === 0 &&
                        g.unassigned.length === 0 ? (
                          <span className="text-xs text-neutral-500">
                            No records assigned.
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
    );
  }
}
