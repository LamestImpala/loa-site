import type { SupabaseClient } from "@supabase/supabase-js";

// The "away" notice: a date window when nothing ships, and the day orders
// placed in that window go out. Stored as JSON text in the settings table
// under SHIPPING_PAUSE_KEY ('' = no pause); the admin Settings page writes
// it, the shop layout, the buy dialog and the buyer confirmation email read
// it. Dates are plain YYYY-MM-DD strings judged in Phoenix time, so the
// notice switches itself off the morning after `until` without a deploy.

export type ShippingPause = {
  from: string; // first day away
  until: string; // last day away
  shipsOn: string; // day orders from the window ship
  note: string; // optional extra sentence from the admin
};

export const SHIPPING_PAUSE_KEY = "shipping_pause";
export const NOTE_MAX = 300;
const PHOENIX = "America/Phoenix";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Tolerant: anything malformed reads as "no pause" rather than breaking a
// page. The window must be ordered and the ship day must follow it.
export function parseShippingPause(value: string | null | undefined): ShippingPause | null {
  if (!value || !value.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isIsoDay(o.from) || !isIsoDay(o.until) || !isIsoDay(o.shipsOn)) return null;
  if (!(o.from <= o.until && o.until < o.shipsOn)) return null;
  const note = typeof o.note === "string" ? o.note.trim().slice(0, NOTE_MAX) : "";
  return { from: o.from, until: o.until, shipsOn: o.shipsOn, note };
}

// YYYY-MM-DD for "now" in Phoenix (no DST there, so the day boundary is a
// fixed -07:00).
export function todayInPhoenix(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHOENIX,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// The pause shows from the moment it's saved (the sentence reads fine
// before departure too) through the last day away. From `shipsOn` on,
// orders ship normally and the notice is gone.
export function activeShippingPause(
  p: ShippingPause | null,
  now: Date = new Date()
): ShippingPause | null {
  if (!p) return null;
  return todayInPhoenix(now) <= p.until ? p : null;
}

// Noon UTC keeps the calendar day stable whatever the server's zone.
function dayParts(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const f = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d);
  return { month: f({ month: "short" }), dom: f({ day: "numeric" }), weekday: f({ weekday: "long" }) };
}

// "Nov 3", "Nov 3–11" or "Nov 28 – Dec 3".
export function formatDayRange(from: string, until: string): string {
  const a = dayParts(from);
  const b = dayParts(until);
  if (from === until) return `${a.month} ${a.dom}`;
  if (a.month === b.month) return `${a.month} ${a.dom}–${b.dom}`;
  return `${a.month} ${a.dom} – ${b.month} ${b.dom}`;
}

// "Thursday, Nov 12".
export function formatShipDay(day: string): string {
  const p = dayParts(day);
  return `${p.weekday}, ${p.month} ${p.dom}`;
}

// The one sentence every surface shows, plus the admin's note if any.
export function shippingPauseSentence(p: ShippingPause): string {
  const range = formatDayRange(p.from, p.until);
  const window = p.from === p.until ? "that day" : "that window";
  const base = `Heads up: I'm away ${range}. Anything requested ${
    p.from === p.until ? "" : "in "
  }${window} ships ${formatShipDay(p.shipsOn)}.`;
  return p.note ? `${base} ${p.note}` : base;
}

// For the "Request sent" panel, after "…with a PayPal invoice once we've
// confirmed what's available."
export function shippingPauseShort(p: ShippingPause): string {
  return `I'm away until ${formatDayRange(p.until, p.until)}, so it'll ship ${formatShipDay(p.shipsOn)}.`;
}

// Read the setting with whichever client the caller has (anon can read
// settings). Null when unset, malformed, missing or already over.
export async function fetchShippingPause(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<ShippingPause | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SHIPPING_PAUSE_KEY)
    .maybeSingle();
  const value = (data as { value?: string | null } | null)?.value ?? null;
  return activeShippingPause(parseShippingPause(value), now);
}
