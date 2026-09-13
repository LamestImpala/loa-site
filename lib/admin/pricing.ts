import type { PendingPriceChange, PriceRun } from "../supabase.ts";

// Copies-for-sale per record, from the most recent run summaries (runs are
// newest first, so the first summary seen per record wins). Used to split
// pending cuts the same way the email report does.
export function forSaleById(runs: PriceRun[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const run of runs) {
    for (const s of run.summary ?? []) {
      if (s.for_sale != null && !m.has(s.record_id)) {
        m.set(s.record_id, s.for_sale);
      }
    }
  }
  return m;
}

// Same heuristic as the email: a cut worth acting on is modest (≤30%) with
// several copies competing, or any cut on a stocked release (30+ copies —
// the price run chases the cheapest listing there); everything else is
// likely condition noise, a scarce copy, or a suggestion-based increase.
export const ACTIONABLE_MAX_CUT = 0.3;
export const ACTIONABLE_MIN_COPIES = 3;
export const STOCKED_COPIES = 30;

export function isActionable(
  p: PendingPriceChange,
  forSale: Map<number, number>
): boolean {
  if (p.pct_change >= 0) return false;
  const copies = forSale.get(p.record_id) ?? 0;
  return (
    copies >= STOCKED_COPIES ||
    (Math.abs(p.pct_change) <= ACTIONABLE_MAX_CUT && copies >= ACTIONABLE_MIN_COPIES)
  );
}
