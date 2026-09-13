import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketSnapshotRow } from "@/lib/supabase";

// Latest daily Discogs market snapshot per record, as the admin uses it for
// price context and weekly-post ranking.
export type MarketStats = {
  forSale: number | null;
  want: number | null;
  have: number | null;
  suggested: number | null; // Discogs suggestion for the record's media grade
  lowest: number | null; // raw Discogs lowest_price — any grade, any country
  lowestPlausible: boolean | null; // did the price run treat it as comparable?
};
export type MarketMap = Record<number, MarketStats>;

// Last 7 days of snapshots, newest first. Falls back to the pre-migration
// column list if the DB doesn't have lowest_plausible yet.
export async function loadSnapshots(supabase: SupabaseClient) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = (cols: string) =>
    supabase
      .from("market_snapshots")
      .select(cols)
      .gte("snapped_on", since)
      .order("snapped_on", { ascending: false });
  const full = await query(
    "record_id,snapped_on,for_sale,want,have,suggested,lowest,lowest_plausible"
  );
  if (full.error && /lowest_plausible/.test(full.error.message)) {
    return query("record_id,snapped_on,for_sale,want,have,suggested,lowest");
  }
  return full;
}

// Rows arrive newest first, so the first row seen per record wins.
export function latestMarket(rows: MarketSnapshotRow[]): MarketMap {
  const out: MarketMap = {};
  for (const s of rows) {
    if (!(s.record_id in out)) {
      out[s.record_id] = {
        forSale: s.for_sale,
        want: s.want,
        have: s.have,
        suggested: s.suggested == null ? null : Number(s.suggested),
        lowest: s.lowest == null ? null : Number(s.lowest),
        lowestPlausible: s.lowest_plausible ?? null,
      };
    }
  }
  return out;
}
