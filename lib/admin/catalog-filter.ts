import type { DbRecord, RecordInterest } from "../supabase.ts";
import { artistLetter } from "../records.ts";
import { holdActive } from "./records.ts";
import type { MarketMap } from "./market.ts";

// The catalog table's filter and sort, kept pure so the rules are testable.

export type SortKey = "artist" | "price-desc" | "price-asc" | "interest" | "added";
// "manual-off-market": hand-priced records sitting far from the Discogs
// grade suggestion — the audit list for deciding what to hand back to the
// daily run (uncheck "manual").
export type InterestFilter = "all" | "clicked-no-request" | "manual-off-market";
export const OFF_MARKET_HIGH = 1.3;
export const OFF_MARKET_LOW = 0.6;

export type CatalogFilters = {
  search: string;
  genre: string; // "all" or a genre
  collection: string; // "all", "none", or a series
  letter: string | null; // A–Z / "#"
  shown: "all" | "shown" | "hidden";
  sold: "all" | "sold" | "unsold";
  interest: InterestFilter;
};

export const DEFAULT_FILTERS: CatalogFilters = {
  search: "",
  genre: "all",
  collection: "all",
  letter: null,
  shown: "all",
  sold: "all",
  interest: "all",
};

export function filterRecords(
  records: DbRecord[],
  f: CatalogFilters,
  ctx: { interest: Record<number, RecordInterest>; market: MarketMap; now?: number }
): DbRecord[] {
  const now = ctx.now ?? Date.now();
  const q = f.search.trim().toLowerCase();
  return records.filter((r) => {
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
    return `${r.artist} ${r.title} ${r.pressing} ${(r.genres ?? []).join(" ")} ${r.collection ?? ""}`
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
