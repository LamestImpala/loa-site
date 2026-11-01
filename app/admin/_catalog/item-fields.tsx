"use client";

/*
 * The fields a poster or a piece of equipment has instead of a pressing
 * and Goldmine grades: one condition word plus the kind's own details
 * (venue and edition for a poster, category and what's included for
 * gear). Used by the catalog's add form and its drawer.
 */
import { useState } from "react";
import type { DbRecord, ItemDetails, ItemKind } from "@/lib/supabase";
import { GEAR_CATEGORIES, PRINT_METHODS, conditionsFor, kindOf } from "@/lib/items";
import { blurOnEnter, inputClass } from "../_shell/ui";

type Field = {
  key: keyof ItemDetails;
  label: string;
  placeholder?: string;
  type?: "text" | "date";
  options?: readonly string[];
  wide?: boolean;
};

const POSTER_FIELDS: Field[] = [
  { key: "venue", label: "Venue", placeholder: "Wrigley Field" },
  { key: "city", label: "City", placeholder: "Chicago, IL" },
  { key: "show_date", label: "Show date", type: "date" },
  { key: "designer", label: "Poster artist", placeholder: "Ames Bros" },
  { key: "edition", label: "Edition", placeholder: "142/300, AP, open" },
  { key: "dimensions", label: "Size", placeholder: "18 × 24 in" },
  { key: "print_method", label: "Print", options: PRINT_METHODS },
  { key: "condition_note", label: "Condition note", placeholder: "flat, never hung", wide: true },
];

const GEAR_FIELDS: Field[] = [
  { key: "category", label: "Category", options: GEAR_CATEGORIES },
  { key: "working_note", label: "Working state", placeholder: "Fully working; new belt 2025", wide: true },
  { key: "included", label: "Included", placeholder: "Dust cover, 45 adapter, original box", wide: true },
];

export function fieldsFor(kind: ItemKind): Field[] {
  return kind === "poster" ? POSTER_FIELDS : kind === "gear" ? GEAR_FIELDS : [];
}

export function ConditionSelect({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: ItemKind;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-500">
      Condition
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} [&>option]:bg-neutral-900`}
      >
        <option value="">—</option>
        {conditionsFor(kind).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

// The kind's detail inputs. `values` is the draft; `onChange` fires on
// every keystroke, `onCommit` (optional) when a field is left.
export function DetailsInputs({
  kind,
  values,
  onChange,
  onCommit,
  disabled,
}: {
  kind: ItemKind;
  values: ItemDetails;
  onChange: (key: keyof ItemDetails, value: string) => void;
  onCommit?: (key: keyof ItemDetails) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {fieldsFor(kind).map((f) => (
        <label
          key={f.key}
          className={`flex flex-col gap-0.5 text-xs text-neutral-500 ${f.wide ? "w-full max-w-md" : ""}`}
        >
          {f.label}
          {f.options ? (
            <select
              value={values[f.key] ?? ""}
              disabled={disabled}
              onChange={(e) => {
                onChange(f.key, e.target.value);
              }}
              onBlur={() => onCommit?.(f.key)}
              className={`${inputClass} [&>option]:bg-neutral-900`}
            >
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              type={f.type ?? "text"}
              value={values[f.key] ?? ""}
              disabled={disabled}
              onChange={(e) => onChange(f.key, e.target.value)}
              onBlur={() => onCommit?.(f.key)}
              onKeyDown={blurOnEnter}
              placeholder={f.placeholder}
              className={`${f.wide ? "w-full" : "w-40"} ${inputClass}`}
            />
          )}
        </label>
      ))}
    </div>
  );
}

// The drawer's editor for a poster or gear row: the condition saves on
// change, each detail field saves when you click away (like the record
// drawer's genres and notes).
export function DetailsEditor({
  r,
  disabled,
  onSave,
}: {
  r: DbRecord;
  disabled?: boolean;
  onSave: (patch: Partial<DbRecord>) => void;
}) {
  const kind = kindOf(r);
  const [draft, setDraft] = useState<ItemDetails>(r.details ?? {});
  function commit(key: keyof ItemDetails) {
    const value = (draft[key] ?? "").trim();
    if ((r.details?.[key] ?? "") === value) return;
    const next: ItemDetails = { ...(r.details ?? {}) };
    if (value) next[key] = value;
    else delete next[key];
    onSave({ details: next });
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <ConditionSelect
        kind={kind}
        value={r.condition ?? ""}
        disabled={disabled}
        onChange={(condition) => onSave({ condition: condition || null })}
      />
      <DetailsInputs
        kind={kind}
        values={draft}
        disabled={disabled}
        onChange={(key, value) => {
          setDraft((prev) => ({ ...prev, [key]: value }));
        }}
        onCommit={commit}
      />
    </div>
  );
}
