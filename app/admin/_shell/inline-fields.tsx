"use client";

import { useState } from "react";
import { parseMoney } from "@/lib/admin/sales";
import { blurOnEnter, inputClass } from "./ui";

// Small edit-in-place inputs for an order card. Both keep a local draft
// while focused and save on blur or Enter, only when the value changed.

// A dollar amount. Blank means "none" (null); an unparseable entry is
// dropped and the field snaps back to what it showed before.
export function MoneyField({
  value,
  placeholder,
  onSave,
  disabled,
  title,
  className = "w-20",
}: {
  value: number | null | undefined;
  placeholder?: string;
  onSave: (next: number | null) => unknown;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : String(value));
  function commit() {
    const next = parseMoney(draft ?? "");
    setDraft(null);
    if (draft == null || next === undefined) return;
    if (next !== (value ?? null)) void onSave(next);
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-xs text-neutral-500">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
        title={title}
        className={`${className} ${inputClass}`}
      />
    </span>
  );
}

// A short free-text note.
export function NoteField({
  value,
  placeholder,
  onSave,
  disabled,
  title,
  className = "w-44",
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => unknown;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    const next = (draft ?? value).trim();
    setDraft(null);
    if (next !== value) void onSave(next);
  }
  return (
    <input
      type="text"
      value={draft ?? value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={blurOnEnter}
      title={title}
      className={`${className} ${inputClass}`}
    />
  );
}
