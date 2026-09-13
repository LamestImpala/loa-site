// Tailwind class strings and tiny helpers shared by the admin surfaces.
// Kept in one place so the sign-in gate, the records page, fulfillment and
// pick'em all render the same controls.

export const inputClass =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none";
export const buttonClass =
  "rounded-lg border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white";

// Commit a blur-save field with the keyboard.
export function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}
