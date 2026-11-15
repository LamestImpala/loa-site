"use client";

import type { DbRecord } from "@/lib/supabase";
import { discFill, discStyle } from "@/lib/disc-style";
import { NoteField } from "../_shell/inline-fields";

/**
 * The disc's colours in the owner's own words (records.disc_colors), for a
 * pressing Discogs names without a colour ("Volcanic Splash"). What is typed
 * here decides how the shop draws the disc; shoppers still read Discogs'
 * name. Blank = read Discogs.
 */
export function DiscColorsField({
  r,
  disabled,
  onSave,
}: {
  r: DbRecord;
  disabled?: boolean;
  onSave: (next: string) => unknown;
}) {
  const discogs = (r.disc_formats ?? [])
    .map((f) => f.text)
    .filter(Boolean)
    .join(" / ");
  const style = discStyle(r.disc_formats, r.disc_colors);
  const drawn = !style
    ? "plain black"
    : style.mode === "picture"
      ? "a picture disc (not drawn)"
      : style.mode === "solid"
        ? "one colour"
        : style.mode;
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      <NoteField
        value={r.disc_colors ?? ""}
        placeholder="Disc colors — e.g. Red & Orange with Black Splatter"
        title="How the shop draws the disc. Leave blank to read it from Discogs — saves when you click away"
        disabled={disabled}
        onSave={onSave}
        className="w-full"
      />
      <span className="flex items-center gap-1.5">
        {style && style.colors.length ? (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 shrink-0 rounded-full border border-neutral-400"
            style={{ background: discFill(style.colors) }}
          />
        ) : null}
        <span>
          Drawn as {drawn}
          {r.disc_colors ? " (your words)" : ""}.{" "}
          {discogs ? `Discogs says “${discogs}”.` : "Discogs has no note on the disc."}
        </span>
      </span>
    </label>
  );
}
