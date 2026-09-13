"use client";

import { useCallback, useRef, useState } from "react";

// Tailwind class strings, tiny formatters and the page-chrome components
// shared by every admin page, so the sign-in gate, the records page,
// fulfillment, pick'em and settings render the same controls.

export const inputClass =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none";
export const buttonClass =
  "rounded-lg border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white";
export const smallButtonClass =
  "rounded-md border border-white/15 px-2 py-1 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300";

// Commit a blur-save field with the keyboard.
export function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

export function pct(n: number) {
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

export function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A short-lived "Copied!" label keyed by whatever was copied, replacing the
// per-button boolean flags. `flash("ref-12")` then `isCopied("ref-12")`.
export function useCopied(ttl = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const flash = useCallback(
    (key: string) => {
      setCopiedKey(key);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopiedKey(null), ttl);
    },
    [ttl]
  );
  const isCopied = useCallback((key: string) => copiedKey === key, [copiedKey]);
  return { copiedKey, isCopied, flash };
}

// Transient feedback shown in a fixed stack near the bottom-right corner, so
// results of an action are visible no matter how far down the page it fired.
export type Toast = {
  id: number;
  kind: "error" | "success" | "info";
  text: string;
  action?: { label: string; onClick: () => void };
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            t.kind === "error"
              ? "border-red-500/40 bg-red-950/90 text-red-200"
              : t.kind === "success"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
                : "border-white/20 bg-neutral-900/95 text-neutral-200"
          }`}
        >
          <span>{t.text}</span>
          <span className="flex shrink-0 items-center gap-2">
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  onDismiss(t.id);
                }}
                className="rounded-md border border-white/25 px-2 py-0.5 text-xs text-white transition hover:bg-white hover:text-black"
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="text-current opacity-60 transition hover:opacity-100"
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Shown when navigator.clipboard is unavailable (window.prompt truncates
// multi-KB markdown): select-and-copy by hand.
export function ClipboardFallbackModal({
  fallback,
  onClose,
}: {
  fallback: { title: string; text: string } | null;
  onClose: () => void;
}) {
  if (!fallback) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={fallback.title}
        className="w-full max-w-2xl rounded-2xl border border-white/15 bg-neutral-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-neutral-300">
          {fallback.title} — automatic copy was blocked, so select and copy it
          from here:
        </p>
        <textarea
          readOnly
          autoFocus
          value={fallback.text}
          onFocus={(e) => e.currentTarget.select()}
          rows={12}
          className={`mt-3 w-full resize-y ${inputClass} font-mono text-xs`}
        />
        <button type="button" onClick={onClose} className={`mt-3 ${buttonClass}`}>
          Close
        </button>
      </div>
    </div>
  );
}
