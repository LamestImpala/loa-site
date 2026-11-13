import type { DbRecord, ItemKind, RecordInterest } from "../supabase.ts";
import { KINDS, kindOf } from "../items.ts";
import { artistLetter } from "../records.ts";
import { holdActive, isDraft, needsPhotos } from "./records.ts";
import type { MarketMap } from "./market.ts";

// The catalog table's filter and sort, kept pure so the rules are testable.

export type SortKey = "artist" | "price-desc" | "price-asc" | "interest" | "added";
// "manual-off-market": hand-priced records sitting far from the Discogs
// grade suggestion — the audit list for deciding what to hand back to the
// daily run (uncheck "manual").
export type InterestFilter = "all" | "clicked-no-request" | "manual-off-market";
// One-click views of what needs attention: drafts not on the shop yet,
// records held for a buyer, pricier listings with only a stock cover, and
// anything unsold still at $0.
export type StatusFilter = "all" | "draft" | "held" | "needs-photos" | "unpriced";
export const STATUS_FILTERS: { key: Exclude<StatusFilter, "all">; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "held", label: "Held" },
  { key: "needs-photos", label: "Needs photos" },
  { key: "unpriced", label: "$0" },
];
export const OFF_MARKET_HIGH = 1.3;
export const OFF_MARKET_LOW = 0.6;

export type CatalogFilters = {
  search: string;
  kind: "all" | ItemKind; // records, posters or equipment
  genre: string; // "all" or a genre
  collection: string; // "all", "none", or a series
  letter: string | null; // A–Z / "#"
  shown: "all" | "shown" | "hidden";
  sold: "all" | "sold" | "unsold";
  interest: InterestFilter;
  status: StatusFilter;
};

export const DEFAULT_FILTERS: CatalogFilters = {
  search: "",
  kind: "all",
  genre: "all",
  collection: "all",
  letter: null,
  shown: "all",
  sold: "all",
  interest: "all",
  status: "all",
};

export function matchesStatus(
  r: DbRecord,
  status: StatusFilter,
  now: number = Date.now()
): boolean {
  switch (status) {
    case "draft":
      return isDraft(r);
    case "held":
      return !r.sold && holdActive(r, now);
    case "needs-photos":
      return needsPhotos(r);
    case "unpriced":
      return !r.sold && Number(r.price) === 0;
    default:
      return true;
  }
}

export function filterRecords(
  records: DbRecord[],
  f: CatalogFilters,
  ctx: { interest: Record<number, RecordInterest>; market: MarketMap; now?: number }
): DbRecord[] {
  const now = ctx.now ?? Date.now();
  const q = f.search.trim().toLowerCase();
  return records.filter((r) => {
    if (f.kind !== "all" && kindOf(r) !== f.kind) return false;
    if (f.genre !== "all" && !(r.genres ?? []).includes(f.genre)) return false;
    if (f.collection === "none" && r.collection) return false;
    if (
      f.collection !== "all" &&
      f.collection !== "none" &&
      r.collection !== f.collection
    )
      return false;
    if (f.letter && artistLetter(r.artist) !== f.letter) return false;
    if (f.shown === "shown" && !r.listed) return false;
    if (f.shown === "hidden" && r.listed) return false;
    if (f.sold === "sold" && !r.sold) return false;
    if (f.sold === "unsold" && r.sold) return false;
    if (!matchesStatus(r, f.status, now)) return false;
    if (f.interest === "clicked-no-request") {
      const i = ctx.interest[r.id];
      if (
        !i ||
        i.interest_sessions === 0 ||
        i.request_sessions > 0 ||
        r.sold ||
        holdActive(r, now)
      )
        return false;
    }
    if (f.interest === "manual-off-market") {
      const sugg = ctx.market[r.id]?.suggested;
      if (!r.manual_price || r.sold || !r.listed || !sugg) return false;
      const ratio = r.price / sugg;
      if (ratio <= OFF_MARKET_HIGH && ratio >= OFF_MARKET_LOW) return false;
    }
    if (!q) return true;
    const details = Object.values(r.details ?? {}).join(" ");
    return `${r.artist} ${r.title} ${r.pressing} ${(r.genres ?? []).join(" ")} ${r.collection ?? ""} ${r.condition ?? ""} ${details}`
      .toLowerCase()
      .includes(q);
  });
}

const alpha = (a: DbRecord, b: DbRecord) =>
  (a.artist + a.title).localeCompare(b.artist + b.title);

// "artist" keeps the incoming (already alphabetical) order; every other key
// falls back to artist/title for ties. Returns a new array.
export function sortRecords(
  list: DbRecord[],
  sortBy: SortKey,
  interest: Record<number, RecordInterest>
): DbRecord[] {
  if (sortBy === "artist") return list;
  return [...list].sort((a, b) => {
    switch (sortBy) {
      case "price-desc":
        return b.price - a.price || alpha(a, b);
      case "price-asc":
        return a.price - b.price || alpha(a, b);
      case "interest":
        return (
          (interest[b.id]?.interest_sessions ?? 0) -
            (interest[a.id]?.interest_sessions ?? 0) || alpha(a, b)
        );
      case "added":
        return (
          (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id - a.id
        );
      default:
        return alpha(a, b);
    }
  });
}

// The catalog's view in the URL (?q=&genre=&sort=…), so a reload, the back
// button and a bookmark all land on the same list. Defaults are left out;
// anything unrecognised falls back to its default. Other params on the
// URL (the drawer's ?record=) are the caller's to keep.
const SORT_KEYS: SortKey[] = ["artist", "price-desc", "price-asc", "interest", "added"];
const INTEREST_KEYS: InterestFilter[] = ["all", "clicked-no-request", "manual-off-market"];
const SHOWN_KEYS: CatalogFilters["shown"][] = ["all", "shown", "hidden"];
const SOLD_KEYS: CatalogFilters["sold"][] = ["all", "sold", "unsold"];
const KIND_KEYS: CatalogFilters["kind"][] = ["all", ...KINDS];
const STATUS_KEYS: StatusFilter[] = ["all", ...STATUS_FILTERS.map((s) => s.key)];
export const FILTER_PARAMS = ["q", "kind", "genre", "collection", "letter", "shown", "sold", "interest", "status", "sort"];

const oneOf = <T extends string>(keys: T[], raw: string | null, fallback: T): T =>
  keys.includes(raw as T) ? (raw as T) : fallback;

export function filtersFromQuery(
  params: Pick<URLSearchParams, "get">
): { filters: CatalogFilters; sort: SortKey } {
  return {
    filters: {
      search: params.get("q") ?? "",
      kind: oneOf(KIND_KEYS, params.get("kind"), "all"),
      genre: params.get("genre") || "all",
      collection: params.get("collection") || "all",
      letter: params.get("letter") || null,
      shown: oneOf(SHOWN_KEYS, params.get("shown"), "all"),
      sold: oneOf(SOLD_KEYS, params.get("sold"), "all"),
      interest: oneOf(INTEREST_KEYS, params.get("interest"), "all"),
      status: oneOf(STATUS_KEYS, params.get("status"), "all"),
    },
    sort: oneOf(SORT_KEYS, params.get("sort"), "artist"),
  };
}

export function filtersToQuery(filters: CatalogFilters, sort: SortKey): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.search) out.set("q", filters.search);
  if (filters.kind !== "all") out.set("kind", filters.kind);
  if (filters.genre !== "all") out.set("genre", filters.genre);
  if (filters.collection !== "all") out.set("collection", filters.collection);
  if (filters.letter) out.set("letter", filters.letter);
  if (filters.shown !== "all") out.set("shown", filters.shown);
  if (filters.sold !== "all") out.set("sold", filters.sold);
  if (filters.interest !== "all") out.set("interest", filters.interest);
  if (filters.status !== "all") out.set("status", filters.status);
  if (sort !== "artist") out.set("sort", sort);
  return out;
}

// Whether anything is narrowing the list (the sort doesn't count) — when
// to offer "Clear filters".
export function filtersActive(filters: CatalogFilters): boolean {
  return filtersToQuery(filters, "artist").toString() !== "";
}
