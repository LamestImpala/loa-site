"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { combineLabels, sheetCount } from "@/lib/admin/labels-2up";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, smallButtonClass } from "../_shell/ui";

// Two shipping labels per sheet. PayPal hands out one letter-size PDF per
// label with the label in the top half; this page stacks them two to a
// page for half-sheet label stock. It all happens in the browser — the
// files never leave the machine and nothing is stored.

type Picked = { key: number; file: File };
type Result = { url: string; name: string; sheets: number; labels: number };

let nextKey = 1;

export function LabelsPage() {
  const { pushToast } = useAdmin();
  const [files, setFiles] = useState<Picked[]>([]);
  const [startOnBottom, setStartOnBottom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // One object URL at a time; drop the old one on rebuild or leaving.
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  function add(list: FileList | File[]) {
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    const skipped = list.length - pdfs.length;
    if (skipped > 0)
      pushToast("error", `Skipped ${skipped} non-PDF file${skipped === 1 ? "" : "s"}.`);
    if (pdfs.length === 0) return;
    setFiles((prev) => [...prev, ...pdfs.map((file) => ({ key: nextKey++, file }))]);
    setResult(null);
  }

  function move(index: number, delta: number) {
    setFiles((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  }

  function remove(key: number) {
    setFiles((prev) => prev.filter((f) => f.key !== key));
    setResult(null);
  }

  function clear() {
    setFiles([]);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  }

  async function combine() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    try {
      const sources = await Promise.all(
        files.map(async ({ file }) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }))
      );
      const bytes = await combineLabels(sources, { startOnBottom });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const next: Result = {
        url,
        name: `labels-${stamp}.pdf`,
        labels: files.length,
        sheets: sheetCount(files.length, startOnBottom),
      };
      setResult(next);
      // Popup blockers may refuse this; the links below still work.
      window.open(url, "_blank", "noopener");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Combining failed.");
    } finally {
      setBusy(false);
    }
  }

  const sheets = sheetCount(files.length, startOnBottom);

  return (
    <div className="mt-4 max-w-2xl">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-semibold">Labels</h1>
          <p className="text-sm text-neutral-400">
            Stack PayPal label PDFs two to a sheet for half-sheet label stock.
          </p>
        </div>
      </header>

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
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 ? (
        <ol className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10">
          {files.map(({ key, file }, i) => {
            const slot = i + (startOnBottom ? 1 : 0);
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs text-neutral-500">
                  Sheet {Math.floor(slot / 2) + 1} · {slot % 2 === 0 ? "top" : "bottom"}
                </span>
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${file.name} up`}
                    className={smallButtonClass}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === files.length - 1}
                    aria-label={`Move ${file.name} down`}
                    className={smallButtonClass}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(key)}
                    aria-label={`Remove ${file.name}`}
                    className={smallButtonClass}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={combine}
          disabled={files.length === 0 || busy}
          className={buttonClass}
        >
          {busy ? "Combining…" : "Combine & open"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={files.length === 0 || busy}
          className={buttonClass}
        >
          Clear
        </button>
        <span className="text-sm text-neutral-400" aria-live="polite">
          {files.length === 0
            ? "No labels yet"
            : `${files.length} label${files.length === 1 ? "" : "s"} → ${sheets} sheet${sheets === 1 ? "" : "s"}`}
        </span>
      </div>

      {result ? (
        <p className="mt-3 text-sm text-neutral-300" aria-live="polite">
          Ready: {result.labels} label{result.labels === 1 ? "" : "s"} on{" "}
          {result.sheets} sheet{result.sheets === 1 ? "" : "s"}.{" "}
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
        Print at 100% / Actual size on Letter paper — not “Fit to page” — so
        the labels land on the stock. Files are combined in your browser and
        never uploaded.
      </p>
    </div>
  );
}
