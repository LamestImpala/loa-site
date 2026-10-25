"use client";

import { useState } from "react";
import { blurOnEnter, inputClass } from "./ui";

// The buyer's name on an order card, editable in place. Saves on blur or
// Enter when it changed; a u/ prefix is tolerated and stripped. Reddit
// buyers get the u/ prefix; a buyer who ordered by email (the order
// carries their address) is shown by name, with the address alongside.
export function BuyerField({
  value,
  email,
  onSave,
  disabled,
}: {
  value: string;
  email?: string | null;
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
      {email ? null : <span className="text-sm text-neutral-500">u/</span>}
      <input
        type="text"
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
        placeholder={email ? "buyer name" : "reddit buyer"}
        title={
          email
            ? `Email buyer (${email}) — renaming here updates every record and parcel in the order`
            : "The buyer's Reddit name for this whole order — renaming it here updates every record and parcel in it"
        }
        className={`w-40 font-medium ${inputClass}`}
      />
      {email ? (
        <a
          href={`mailto:${email}`}
          className="text-xs text-sky-300 underline-offset-2 hover:underline"
        >
          {email}
        </a>
      ) : null}
    </span>
  );
}
