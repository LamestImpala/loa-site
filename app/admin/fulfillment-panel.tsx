"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbRecord, Shipment } from "@/lib/supabase";

/*
 * Fulfillment: sold records grouped by buyer, split into parcels
 * (shipments rows) that each carry one tracking number.
 *
 * The usual flow is labels bought inside PayPal from the paid invoice —
 * "Sync from PayPal" pulls those tracking numbers down. Labels bought
 * elsewhere are typed into a manual parcel and pushed up instead, which
 * also emails the buyer through PayPal. Sales paid off-PayPal just store
 * tracking with no sync in either direction.
 *
 * shipments is the source of truth; records.tracking_number is mirrored
 * per member record so the listings table's quick input stays accurate.
 */

const inputClass =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none";
const buttonClass =
  "rounded-lg border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white";
const smallButtonClass =
  "rounded-md border border-white/15 px-2 py-1 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300";

const CARRIERS = ["USPS", "UPS", "FEDEX", "DHL", "OTHER"];

// A parcel already known to PayPal, under its current tracking number.
const inPayPal = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number === s.tracking_code;

// Pushed once, but the tracking number changed since.
const needsRepush = (s: Shipment) =>
  !!s.paypal_tracker_id &&
  !!s.tracking_code &&
  s.paypal_tracked_number !== s.tracking_code;

type Group = {
  key: string;
  buyer: string;
  records: DbRecord[];
  shipments: Shipment[];
  invoiceId: string; // unique invoice id among member records, if any
  unassigned: DbRecord[];
  done: boolean;
};

export function FulfillmentPanel({
  records,
  shipments,
  supabase,
  onShipmentsChange,
  onRecordPatched,
  getAccessToken,
}: {
  records: DbRecord[]; // sold records only
  shipments: Shipment[];
  supabase: SupabaseClient;
  // Functional-updater form so async handlers can't clobber each other
  // with a stale copy of the list.
  onShipmentsChange: (update: (prev: Shipment[]) => Shipment[]) => void;
  onRecordPatched: (id: number, patch: Partial<DbRecord>) => void;
  getAccessToken: () => Promise<string>;
}) {
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [trackingEdits, setTrackingEdits] = useState<Record<number, string>>({});
  const [invoiceEdits, setInvoiceEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null); // group key or `ship-${id}`
  const [notes, setNotes] = useState<Record<string, string>>({}); // group key or shipment id -> status text

  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    const groupOf = (buyer: string) => {
      const key = buyer.trim().toLowerCase() || "(no buyer)";
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          buyer: buyer.trim(),
          records: [],
          shipments: [],
          invoiceId: "",
          unassigned: [],
          done: false,
        };
        map.set(key, g);
      }
      return g;
    };
    for (const r of records) groupOf(r.buyer_username ?? "").records.push(r);
    for (const s of shipments) {
      if (s.status === "refunded") continue;
      groupOf(s.buyer_username ?? "").shipments.push(s);
    }
    for (const g of map.values()) {
      const invoices = [
        ...new Set(
          g.records.map((r) => r.paypal_invoice_id).filter(Boolean) as string[]
        ),
      ];
      g.invoiceId = invoices.length === 1 ? invoices[0] : "";
      const assigned = new Set(g.shipments.flatMap((s) => s.record_ids ?? []));
      g.unassigned = g.records.filter((r) => !assigned.has(r.id));
      g.done =
        g.records.length > 0 &&
        g.unassigned.length === 0 &&
        g.shipments.every((s) => !!s.tracking_code);
    }
    return [...map.values()].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.buyer.localeCompare(b.buyer);
    });
  }, [records, shipments]);

  const visibleGroups = groups.filter((g) => showDone || !g.done);

  function note(key: string, text: string) {
    setNotes((prev) => ({ ...prev, [key]: text }));
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
      note("panel", `Saving tracking on records failed: ${error.message}`);
      return;
    }
    for (const id of recordIds) onRecordPatched(id, { tracking_number: value });
  }

  async function createParcel(g: Group) {
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
      note(g.key, `Couldn't create the parcel: ${error.message}`);
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
      note(`ship-${s.id}`, `Delete failed: ${error.message}`);
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
      note(`ship-${s.id}`, `Save failed: ${error.message}`);
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

  async function saveInvoiceId(g: Group) {
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
      note(g.key, `Saving the invoice id failed: ${error.message}`);
      return;
    }
    for (const id of recordIds)
      onRecordPatched(id, { paypal_invoice_id: value || null });
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
        note(g.key, `Updating parcels failed: ${shipError.message}`);
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

  async function syncFromPayPal(g: Group) {
    const invoiceId = (invoiceEdits[g.key] ?? g.invoiceId).trim();
    if (!invoiceId || busy) return;
    setBusy(g.key);
    note(g.key, "Syncing…");
    try {
      const body = await callApi({ action: "pull", invoiceId });
      if (body.error) {
        note(g.key, String(body.error));
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
      const created = ((body.created ?? []) as Shipment[]).length;
      note(
        g.key,
        `Found ${body.trackersFound ?? 0} tracking number${
          body.trackersFound === 1 ? "" : "s"
        } in PayPal${created ? `, ${created} new` : ""}.`
      );
    } catch (e) {
      note(g.key, e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function pushToPayPal(list: Shipment[], noteKey: string) {
    const ids = list.map((s) => s.id);
    if (ids.length === 0 || busy) return;
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
          .join(" ") || "Nothing to push."
      );
    } catch (e) {
      note(noteKey, e instanceof Error ? e.message : "Push failed");
    } finally {
      setBusy(null);
    }
  }

  const recordLabel = (id: number) => {
    const r = byId.get(id);
    return r ? `${r.artist} — ${r.title}` : `#${id}`;
  };

  const doneCount = groups.filter((g) => g.done).length;

  return (
    <div className="mt-3">
      <p className="text-sm text-neutral-400">
        Sold records grouped by buyer. Split each order into parcels, one
        tracking number per parcel. &ldquo;Sync from PayPal&rdquo; pulls the
        numbers from labels bought inside PayPal; a manual parcel&rsquo;s
        number can be pushed the other way (PayPal emails the buyer).
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
        <div className="mt-3 grid gap-3">
          {visibleGroups.map((g) => {
            const invoiceValue = invoiceEdits[g.key] ?? g.invoiceId;
            const groupBusy = busy === g.key;
            const pushables = g.shipments.filter(
              (s) => s.tracking_code && s.paypal_invoice_id && !inPayPal(s)
            );
            return (
              <div
                key={g.key}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">
                    {g.buyer ? `u/${g.buyer}` : "No buyer set"}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {g.records.length} record{g.records.length === 1 ? "" : "s"}{" "}
                    · {g.shipments.length} parcel
                    {g.shipments.length === 1 ? "" : "s"}
                  </span>
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
                    placeholder="PayPal invoice id (INV2-…)"
                    className={`w-64 ${inputClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => syncFromPayPal(g)}
                    disabled={!invoiceValue.trim() || groupBusy}
                    title="Read tracking numbers from labels bought inside PayPal on this invoice"
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
                        <span className="text-xs text-neutral-500">
                          {s.mode === "paypal"
                            ? "from PayPal label"
                            : "manual"}
                        </span>
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
                        {s.paypal_invoice_id &&
                        s.tracking_code &&
                        !inPayPal(s) ? (
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
          })}
        </div>
      )}
    </div>
  );
}
