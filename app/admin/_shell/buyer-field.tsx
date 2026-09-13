"use client";

import { useState } from "react";
import { blurOnEnter, inputClass } from "./ui";

// The buyer's Reddit name on an order card, editable in place. Saves on
// blur or Enter when it changed; a u/ prefix is tolerated and stripped.
export function BuyerField({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (next: string) => unknown;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  function commit() {
    const next = (draft ?? value).trim().replace(/^u\//, "");
    setDraft(null);
    if (next !== value) void onSave(next);
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-sm text-neutral-500">u/</span>
      <input
        type="text"
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
        placeholder="reddit buyer"
        title="The buyer's Reddit name for this whole order — renaming it here updates every record and parcel in it"
        className={`w-40 font-medium ${inputClass}`}
      />
    </span>
  );
}
