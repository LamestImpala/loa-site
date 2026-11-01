// The one place the shop spells out what kinds of thing it sells.
//
// Records, concert posters and audio equipment are all rows in `records`
// (see supabase/migrations/20261105_item_kinds.sql). Everything that prints
// an item — the shop's request DMs and emails, the PayPal invoice, the admin
// pick list and packing slips — goes through the helpers here, so a record
// still reads "Media: NM / Sleeve: VG+" and a poster reads "Cond: Excellent
// · 18 × 24 in · 142/300" without each caller knowing the difference.

import type { DbRecord, ItemDetails, ItemKind } from "./supabase";
import { cleanDiscogsName, recordSlug } from "./record-info.ts";

export const KINDS: ItemKind[] = ["record", "poster", "gear"];

export const KIND_LABELS: Record<ItemKind, string> = {
  record: "Record",
  poster: "Poster",
  gear: "Equipment",
};

export const KIND_PLURALS: Record<ItemKind, string> = {
  record: "records",
  poster: "posters",
  gear: "equipment",
};

type Kinded = { kind?: ItemKind | null };

// Rows written before posters existed have no kind; they're records.
export function kindOf(r: Kinded): ItemKind {
  return r.kind ?? "record";
}

export function isRecord(r: Kinded) {
  return kindOf(r) === "record";
}

// One condition word for posters and gear (records grade media and sleeve
// separately). Keep in sync with records_condition_check in the migration.
export const ITEM_CONDITIONS = ["Mint", "Excellent", "Very Good", "Good", "Fair", "For parts"] as const;

export function conditionsFor(kind: ItemKind): readonly string[] {
  return kind === "poster" ? ITEM_CONDITIONS.filter((c) => c !== "For parts") : ITEM_CONDITIONS;
}

export const GEAR_CATEGORIES = [
  "Turntable",
  "Tonearm / cartridge",
  "Phono stage",
  "Amplifier",
  "Preamp",
  "DAC / streamer",
  "Speakers",
  "Headphones",
  "Cables",
  "Accessories",
] as const;

export const PRINT_METHODS = ["Screenprint", "Offset", "Lithograph", "Giclée", "Foil"] as const;

// URL prefix per kind: /r/ for records (unchanged), /p/ posters, /e/ equipment.
export const KIND_PREFIX: Record<ItemKind, string> = { record: "r", poster: "p", gear: "e" };

export function kindFromPrefix(prefix: string): ItemKind | null {
  const hit = (Object.entries(KIND_PREFIX) as [ItemKind, string][]).find(([, p]) => p === prefix);
  return hit ? hit[0] : null;
}

// Public path on curiouserrecords.com; proxy.ts rewrites it under /records.
export function itemPath(r: Pick<DbRecord, "id" | "artist" | "title"> & Kinded) {
  const slug = recordSlug(r);
  const prefix = KIND_PREFIX[kindOf(r)];
  return slug ? `/${prefix}/${r.id}-${slug}` : `/${prefix}/${r.id}`;
}

type ItemLike = Kinded & {
  pressing?: string | null;
  media?: string | null;
  sleeve?: string | null;
  condition?: string | null;
  details?: ItemDetails | null;
};

const d = (r: ItemLike) => r.details ?? {};
const clean = (parts: (string | undefined | null)[]) =>
  parts.map((p) => (p ?? "").trim()).filter(Boolean);

// Year of the show from details.show_date ("2016-08-20" → 2016).
export function posterYear(r: ItemLike): number | null {
  const m = /^(\d{4})/.exec(d(r).show_date ?? "");
  return m ? Number(m[1]) : null;
}

// The line under the title: a record's pressing, a poster's show, a
// piece of gear's category.
export function itemSubtitle(r: ItemLike): string {
  switch (kindOf(r)) {
    case "record":
      return cleanDiscogsName(r.pressing ?? "");
    case "poster": {
      const year = posterYear(r);
      return clean([d(r).venue, d(r).city, year ? String(year) : null]).join(" · ");
    }
    case "gear":
      return (d(r).category ?? "").trim();
  }
}

// The condition/spec segment of an itemized line. Records keep the exact
// "Media: X / Sleeve: Y" text the DM parser and existing tests expect.
export function itemSpecLine(r: ItemLike): string {
  switch (kindOf(r)) {
    case "record":
      return `Media: ${r.media ?? ""} / Sleeve: ${r.sleeve ?? ""}`;
    case "poster":
      return clean([r.condition ? `Cond: ${r.condition}` : null, d(r).dimensions, d(r).edition]).join(" · ");
    case "gear":
      return r.condition ? `Cond: ${r.condition}` : "";
  }
}

// Compact form for admin rows and slips: "NM/VG+" or "Excellent".
export function itemSpecShort(r: ItemLike): string {
  return isRecord(r) ? `${r.media ?? ""}/${r.sleeve ?? ""}` : (r.condition ?? "").trim();
}

// ---------------------------------------------------------------------
// Shipping. Records: USPS Media Mail, $6 for 1–2, free on 3+ (combinedShipping).
// Posters: any number ship rolled together in one tube for a flat rate.
// Gear: boxed and quoted after the request, so $0 here and a note instead.
// The order_requests DB trigger (validate_order_request) recomputes the
// same sums — a rate change must touch both.
// ---------------------------------------------------------------------
// USA media mail: one parcel holds up to 3 records. Buyers pay $6 for one
// or two records; a bundle of FREE_SHIPPING_MIN or more ships free — that is
// the parcel boundary, so it costs one label and rewards the order size
// that makes the packing worthwhile.
export const SHIPPING_PER_PARCEL = 6;
export const RECORDS_PER_PARCEL = 3;
export const FREE_SHIPPING_MIN = 3;
export const POSTER_TUBE_RATE = 12;

export function combinedShipping(count: number): number {
  if (count <= 0) return 0;
  if (count >= FREE_SHIPPING_MIN) return 0;
  return Math.ceil(count / RECORDS_PER_PARCEL) * SHIPPING_PER_PARCEL;
}

export type KindCounts = Record<ItemKind, number>;

export function countKinds(items: Kinded[]): KindCounts {
  const n: KindCounts = { record: 0, poster: 0, gear: 0 };
  for (const it of items) n[kindOf(it)]++;
  return n;
}

export type ShippingQuote = {
  shipping: number; // what the buyer is charged now
  records: number;
  posters: number;
  gearQuoted: boolean; // equipment in the bundle; its shipping is quoted later
  counts: KindCounts;
};

export function shippingFor(items: Kinded[]): ShippingQuote {
  const counts = countKinds(items);
  const records = combinedShipping(counts.record);
  const posters = counts.poster > 0 ? POSTER_TUBE_RATE : 0;
  return { shipping: records + posters, records, posters, gearQuoted: counts.gear > 0, counts };
}

// "$6 records + $12 poster tube", "free on 3+ records", "$12 poster tube"…
export function shippingSummary(q: ShippingQuote): string {
  const parts: string[] = [];
  if (q.counts.record > 0) parts.push(q.records === 0 ? "free on 3+ records" : `$${q.records} records`);
  if (q.counts.poster > 0) parts.push(`$${q.posters} poster tube`);
  return parts.join(" + ");
}

// The parenthetical after "Shipping: $X" — only when it tells the buyer
// something the number doesn't: why records were free, that posters share
// one tube, or how a mixed bundle adds up. "" when it would just repeat.
export function shippingDetail(q: ShippingQuote): string {
  const kinds = KINDS.filter((k) => q.counts[k] > 0);
  if (kinds.length === 1) {
    if (kinds[0] === "record") return q.records === 0 ? `free on ${FREE_SHIPPING_MIN}+ records` : "";
    if (kinds[0] === "poster") return "one tube, any number of posters";
    return "quoted separately";
  }
  return shippingSummary(q);
}

// The shipping sentence for a buyer-facing email or page, per kind present.
export function shippingSentence(items: Kinded[]): string {
  const n = countKinds(items);
  const parts: string[] = [];
  if (n.record) parts.push("Records ship USPS Media Mail from Phoenix, AZ.");
  if (n.poster) parts.push("Posters ship rolled in a sturdy tube.");
  if (n.gear) parts.push("Equipment ships boxed; I'll quote the shipping before the invoice.");
  return parts.join(" ");
}

// The sentence to add when equipment is in the bundle, or null.
export function shippingNote(q: ShippingQuote): string | null {
  return q.gearQuoted ? "Equipment shipping is quoted separately before the invoice." : null;
}

// "2 records + 1 poster" for bundle bars and sale-desk headers.
export function bundleKindSummary(items: Kinded[]): string {
  const n = countKinds(items);
  const parts: string[] = [];
  if (n.record) parts.push(`${n.record} ${n.record === 1 ? "record" : "records"}`);
  if (n.poster) parts.push(`${n.poster} ${n.poster === 1 ? "poster" : "posters"}`);
  if (n.gear) parts.push(`${n.gear} ${n.gear === 1 ? "piece of equipment" : "pieces of equipment"}`);
  return parts.join(" + ");
}

// Sort records first, then posters, then gear — the order the DB trigger
// snapshots and the DM prints.
export const KIND_ORDER: Record<ItemKind, number> = { record: 0, poster: 1, gear: 2 };

export function byKindThenName<T extends Kinded & { artist: string; title: string }>(a: T, b: T) {
  return (
    KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)] ||
    a.artist.localeCompare(b.artist) ||
    a.title.localeCompare(b.title)
  );
}
