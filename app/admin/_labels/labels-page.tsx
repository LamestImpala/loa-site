"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import type { Shipment } from "@/lib/supabase";
import {
  combineLabels,
  detectLayout,
  sheetCount,
  type LabelSource,
  type Layout,
} from "@/lib/admin/labels-2up";
import {
  extractLabel,
  matchParcel,
  type ExtractedLabel,
  type LabelCandidate,
} from "@/lib/admin/label-intake";
import { openParcels, sortByPackOrder } from "@/lib/admin/pack-list";
import { setParcelTracking } from "@/lib/admin/shipments-db";
import { useAdmin } from "../_shell/admin-provider";
import { NextStep, nextStepLinkClass } from "../_shell/next-step";
import { buttonClass, inputClass, smallButtonClass } from "../_shell/ui";
import { extractLines } from "./pdf-text";

// Label intake. Drop the label PDFs from PayPal's Shipping Center: each
// one is read in the browser for its tracking number and recipient,
// matched to a box awaiting a label by the ship-to name, and shown for a
// glance-check. "Save tracking & print" writes each tracking number onto
// its box and opens one PDF with the labels in Box # order — 4×6 pages
// for the thermal printer, or two per letter sheet for half-sheet stock.
// The files never leave the machine; only the tracking numbers are saved.

type Row = {
  key: number;
  file: File;
  bytes: ArrayBuffer | null;
  extracted: ExtractedLabel | null; // null while reading
  readable: boolean; // false = no text in the PDF, type it in
  tracking: string;
  parcelId: number | null;
  confident: boolean; // the match was clear-cut
};
type Result = { url: string; name: string; sheets: number; labels: number; layout: Layout };

let nextKey = 1;

export function LabelsPage() {
  const {
    supabase,
    shipments,
    ordersById,
    pushToast,
    patchShipmentLocal,
    updateRecords,
  } = useAdmin();
  const [rows, setRows] = useState<Row[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [layoutError, setLayoutError] = useState("");
  const [startOnBottom, setStartOnBottom] = useState(false);
  const [busy, setBusy] = useState<null | "combine" | "save">(null);
  const [savedBoxes, setSavedBoxes] = useState(0); // boxes given tracking by the last save
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Boxes a label can go on: any parcel with no tracking yet, whether
  // sealed on the pack page or made on the fulfillment card.
  const candidates = useMemo<LabelCandidate[]>(
    () =>
      openParcels(shipments).map((s) => {
        const order = s.order_id != null ? (ordersById.get(s.order_id) ?? null) : null;
        return { shipment: s, order, buyer: (order?.buyer_username ?? s.buyer_username).trim() };
      }),
    [shipments, ordersById]
  );
  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.shipment.id, c])),
    [candidates]
  );
  const boxLabel = (c: LabelCandidate) => {
    const name = shipToName(c);
    const n = c.shipment.record_ids?.length ?? 0;
    return `Box #${c.shipment.id} · u/${c.buyer || "?"}${name ? ` · ${name}` : ""} · ${n} record${n === 1 ? "" : "s"}`;
  };

  // One object URL at a time; drop the old one on rebuild or leaving.
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  // Layout follows the files: detected from their page sizes.
  useEffect(() => {
    const ready = rows.filter((r) => r.bytes);
    if (ready.length === 0) {
      setLayout(null);
      setLayoutError("");
      return;
    }
    let cancelled = false;
    detectLayout(ready.map((r) => ({ name: r.file.name, bytes: r.bytes! })))
      .then((l) => {
        if (cancelled) return;
        setLayout(l);
        setLayoutError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setLayout(null);
        setLayoutError(e instanceof Error ? e.message : "Couldn't read the labels.");
      });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  function patchRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function add(list: FileList | File[]) {
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    const skipped = list.length - pdfs.length;
    if (skipped > 0)
      pushToast("error", `Skipped ${skipped} non-PDF file${skipped === 1 ? "" : "s"}.`);
    if (pdfs.length === 0) return;
    const fresh: Row[] = pdfs.map((file) => ({
      key: nextKey++,
      file,
      bytes: null,
      extracted: null,
      readable: true,
      tracking: "",
      parcelId: null,
      confident: false,
    }));
    setRows((prev) => [...prev, ...fresh]);
    setResult(null);
    // Read each label; matches are assigned one at a time so two labels
    // never land on the same box.
    for (const row of fresh) {
      const bytes = await row.file.arrayBuffer();
      const lines = await extractLines(bytes.slice(0));
      const extracted = extractLabel(lines);
      setRows((prev) => {
        const taken = new Set(prev.filter((r) => r.key !== row.key).map((r) => r.parcelId));
        const free = candidates.filter((c) => !taken.has(c.shipment.id));
        const match = matchParcel(extracted, free);
        return prev.map((r) =>
          r.key === row.key
            ? {
                ...r,
                bytes,
                extracted,
                readable: lines.length > 0,
                tracking: extracted.tracking ?? "",
                parcelId: match.best?.shipment.id ?? null,
                confident: match.confident,
              }
            : r
        );
      });
    }
  }

  function move(index: number, delta: number) {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  }

  function remove(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setResult(null);
  }

  function clear() {
    setRows([]);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void add(e.dataTransfer.files);
  }

  const ready = rows.filter((r) => r.bytes);
  const assigned = ready.filter((r) => r.parcelId != null);
  const sheets = layout ? sheetCount(ready.length, startOnBottom, layout) : 0;

  // What stops "Save tracking & print": a box chosen twice, a tracking
  // number typed twice, or one that's already on another parcel.
  const problems = useMemo(() => {
    const out: string[] = [];
    const boxes = new Map<number, number>();
    const codes = new Map<string, number>();
    for (const r of assigned) {
      const code = r.tracking.trim();
      if (!code) out.push(`${r.file.name}: no tracking number.`);
      if (r.parcelId != null) boxes.set(r.parcelId, (boxes.get(r.parcelId) ?? 0) + 1);
      if (code) codes.set(code, (codes.get(code) ?? 0) + 1);
    }
    for (const [id, n] of boxes) if (n > 1) out.push(`Box #${id} is chosen for ${n} labels.`);
    for (const [code, n] of codes) if (n > 1) out.push(`Tracking ${code} is on ${n} labels.`);
    for (const r of assigned) {
      const code = r.tracking.trim();
      const other = shipments.find(
        (s) => s.tracking_code === code && s.id !== r.parcelId && s.status !== "refunded"
      );
      if (code && other) out.push(`Tracking ${code} is already on Box #${other.id}.`);
    }
    return out;
  }, [assigned, shipments]);

  async function open(sources: LabelSource[], chosen: Layout) {
    const bytes = await combineLabels(sources, { layout: chosen, startOnBottom });
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    setResult({
      url,
      name: `labels-${stamp}.pdf`,
      labels: sources.length,
      sheets: sheetCount(sources.length, startOnBottom, chosen),
      layout: chosen,
    });
    // Popup blockers may refuse this; the links below still work.
    window.open(url, "_blank", "noopener");
  }

  // Just the sheet, in the order listed, nothing written.
  async function combine() {
    if (ready.length === 0 || busy || !layout) return;
    setBusy("combine");
    try {
      await open(ready.map((r) => ({ name: r.file.name, bytes: r.bytes! })), layout);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Combining failed.");
    } finally {
      setBusy(null);
    }
  }

  // Tracking onto each matched box (the box becomes shipped, its records
  // mirror the number), then the sheet in Box # order — unmatched labels
  // last, as listed.
  async function saveAndPrint() {
    if (assigned.length === 0 || problems.length > 0 || busy || !layout) return;
    setBusy("save");
    let saved = 0;
    try {
      for (const r of assigned) {
        const s = candidateById.get(r.parcelId!)?.shipment;
        if (!s) continue;
        const patch = await setParcelTracking(supabase, s, r.tracking, { mode: "paypal" });
        patchShipmentLocal(s.id, patch);
        await updateRecords(s.record_ids ?? [], { tracking_number: r.tracking.trim() }, { quiet: true });
        saved += 1;
      }
      const byBox = new Map(assigned.map((r) => [r.parcelId!, r]));
      const ordered: Row[] = [
        ...sortByPackOrder(
          assigned.map((r) => candidateById.get(r.parcelId!)!.shipment)
        ).map((s: Shipment) => byBox.get(s.id)!),
        ...ready.filter((r) => r.parcelId == null),
      ];
      setSavedBoxes(saved);
      pushToast(
        "success",
        `Saved tracking on ${saved} box${saved === 1 ? "" : "es"} — opening the labels in Box # order.`
      );
      await open(ordered.map((r) => ({ name: r.file.name, bytes: r.bytes! })), layout);
    } catch (err) {
      pushToast(
        "error",
        `${saved ? `Saved ${saved}, then: ` : ""}${err instanceof Error ? err.message : "Saving failed."}`
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-semibold">Labels</h1>
          <p className="text-sm text-neutral-400">
            Drop PayPal label PDFs. Each is matched to a box awaiting a label
            by its ship-to name; saving records the tracking and prints them
            in Box # order.
          </p>
        </div>
        <span className="text-xs text-neutral-500">
          {candidates.length} box{candidates.length === 1 ? "" : "es"} awaiting a label
        </span>
      </header>

      {savedBoxes > 0 ? (
        <NextStep>
          <span>
            Tracking saved on {savedBoxes} box{savedBoxes === 1 ? "" : "es"}.
          </span>
          <Link href="/admin#fulfillment" className={nextStepLinkClass}>
            Back to the Inbox to sync fees and confirm the trades →
          </Link>
        </NextStep>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-4 cursor-pointer rounded-xl border border-dashed px-4 py-8 text-center text-sm transition ${
          dragging
            ? "border-white/60 bg-white/10 text-white"
            : "border-white/20 text-neutral-300 hover:border-white/40 hover:bg-white/5"
        }`}
      >
        Drop label PDFs here, or tap to choose
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {rows.length > 0 ? (
        <ol className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10">
          {rows.map((r, i) => {
            const chosen = r.parcelId != null ? candidateById.get(r.parcelId) : undefined;
            const takenElsewhere = new Set(
              rows.filter((x) => x.key !== r.key).map((x) => x.parcelId)
            );
            return (
              <li key={r.key} className="flex flex-col gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-xs text-neutral-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{r.file.name}</span>
                  {!r.bytes ? (
                    <span className="text-xs text-neutral-500">reading…</span>
                  ) : !r.readable ? (
                    <span className="text-xs text-amber-300" title="The PDF has no text layer — type the tracking number and pick the box">
                      no text found — type it
                    </span>
                  ) : r.parcelId == null ? (
                    <span className="text-xs text-neutral-500">
                      no box matched{r.extracted?.recipients[0] ? ` (${r.extracted.recipients[0]})` : ""}
                    </span>
                  ) : r.confident ? (
                    <span className="text-xs text-emerald-400">matched</span>
                  ) : (
                    <span className="text-xs text-amber-300" title="Best guess — check the name">
                      check match
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.file.name} up`}
                      className={smallButtonClass}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${r.file.name} down`}
                      className={smallButtonClass}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r.key)}
                      aria-label={`Remove ${r.file.name}`}
                      className={smallButtonClass}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {r.bytes ? (
                  <div className="flex flex-wrap items-center gap-2 pl-9">
                    <input
                      type="text"
                      value={r.tracking}
                      onChange={(e) => patchRow(r.key, { tracking: e.target.value })}
                      placeholder="tracking #"
                      aria-label={`Tracking number for ${r.file.name}`}
                      className={`w-64 font-mono ${inputClass}`}
                    />
                    <select
                      value={r.parcelId ?? ""}
                      onChange={(e) =>
                        patchRow(r.key, {
                          parcelId: e.target.value ? Number(e.target.value) : null,
                          confident: true,
                        })
                      }
                      aria-label={`Box for ${r.file.name}`}
                      className={inputClass}
                    >
                      <option value="">— no box (just print) —</option>
                      {/* Best guesses first, so a wrong match is one pick
                          away from the runner-up. */}
                      {(r.extracted
                        ? matchParcel(r.extracted, candidates).ranked
                        : candidates.map((candidate) => ({ candidate, score: 0 }))
                      ).map(({ candidate: c, score }) => (
                        <option
                          key={c.shipment.id}
                          value={c.shipment.id}
                          disabled={takenElsewhere.has(c.shipment.id)}
                        >
                          {score > 0 ? "★ " : ""}
                          {boxLabel(c)}
                        </option>
                      ))}
                      {r.parcelId != null && !chosen ? (
                        <option value={r.parcelId}>Box #{r.parcelId} (already labelled)</option>
                      ) : null}
                    </select>
                    {r.extracted?.recipients[0] && chosen ? (
                      <span className="text-xs text-neutral-500" title="What the label says">
                        label: {r.extracted.recipients[0]}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {layoutError ? <p className="mt-3 text-sm text-red-300">{layoutError}</p> : null}
      {problems.length > 0 ? (
        <ul className="mt-3 text-sm text-amber-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {layout === "half-sheet" ? (
        <label className="mt-4 flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={startOnBottom}
            onChange={(e) => {
              setStartOnBottom(e.target.checked);
              setResult(null);
            }}
            className="h-4 w-4 accent-white"
          />
          First sheet already has its top label used — start on the bottom
        </label>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveAndPrint}
          disabled={assigned.length === 0 || problems.length > 0 || !layout || !!busy}
          title="Write each tracking number onto its box (the box becomes shipped) and open the labels in Box # order"
          className={buttonClass}
        >
          {busy === "save"
            ? "Saving…"
            : `Save tracking & print${assigned.length ? ` (${assigned.length})` : ""}`}
        </button>
        <button
          type="button"
          onClick={combine}
          disabled={ready.length === 0 || !layout || !!busy}
          title="Just the sheet, in the order listed — nothing is saved"
          className={buttonClass}
        >
          {busy === "combine" ? "Combining…" : "Combine & open"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={rows.length === 0 || !!busy}
          className={buttonClass}
        >
          Clear
        </button>
        <span className="text-sm text-neutral-400" aria-live="polite">
          {ready.length === 0
            ? "No labels yet"
            : layout === "thermal"
              ? `${ready.length} label${ready.length === 1 ? "" : "s"} → ${sheets} 4×6 page${sheets === 1 ? "" : "s"}`
              : layout === "half-sheet"
                ? `${ready.length} label${ready.length === 1 ? "" : "s"} → ${sheets} letter sheet${sheets === 1 ? "" : "s"}`
                : ""}
        </span>
      </div>

      {result ? (
        <p className="mt-3 text-sm text-neutral-300" aria-live="polite">
          Ready: {result.labels} label{result.labels === 1 ? "" : "s"} on{" "}
          {result.sheets} {result.layout === "thermal" ? "4×6 page" : "sheet"}
          {result.sheets === 1 ? "" : "s"}.{" "}
          <a
            href={result.url}
            target="_blank"
            rel="noopener"
            className="underline hover:text-white"
          >
            Open
          </a>{" "}
          ·{" "}
          <a href={result.url} download={result.name} className="underline hover:text-white">
            Download
          </a>
        </p>
      ) : null}

      <p className="mt-6 text-xs text-neutral-500">
        Print at 100% / Actual size — 4×6 on the thermal printer, or Letter for
        half-sheet stock — never “Fit to page”. Files are read in your browser
        and never uploaded; only the tracking numbers are saved.
      </p>
    </div>
  );
}

function shipToName(c: LabelCandidate): string {
  const snap = c.shipment.to_address as { name?: string | null } | null | undefined;
  return (snap?.name ?? c.order?.ship_to?.name ?? "").trim();
}
