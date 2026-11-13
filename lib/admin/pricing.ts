import type { DbRecord, PendingPriceChange, PriceRun } from "../supabase.ts";
import { holdActive, invoiceHold } from "./records.ts";

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

// Why a flagged change can't be approved right now, or null when it can.
// A sold record's price is history; a held or invoiced one was quoted at
// its current price (the sale would land at the new one); and a price
// that moved since the run flagged it makes the suggestion stale.
export function approvalBlock(
  p: Pick<PendingPriceChange, "old_price">,
  r: DbRecord | undefined,
  now: number = Date.now()
): string | null {
  if (!r) return "record not found";
  if (r.sold) return "sold";
  if (invoiceHold(r)) return "on an invoice";
  if (holdActive(r, now)) return "on hold";
  if (Number(r.price) !== Number(p.old_price)) return `price is now $${r.price}`;
  return null;
}

type RunLine = PriceRun["summary"][number];

// What set a run's target price, in the words the Pricing page's cards and
// its run history share.
export const REASON_TEXT: Record<NonNullable<RunLine["reason"]>, string> = {
  suggestion: "85% of the Discogs suggestion for its grade",
  scarce: "scarce & wanted, full suggestion",
  stocked: "stocked release (30+ copies), 70% of suggestion",
  decay: "unsold 30+ days, 5% time decay",
  ebay: "capped at eBay median for this pressing",
  lowest: "$6 over comparable cheapest listing",
  climb: "weekly climb toward cheapest listing + $6",
};

// Why the run suggested a pending change: the line it wrote for this record
// at this price — from the run that flagged it when that one is loaded,
// else the newest run that suggested the same price. Null when the change
// is older than the runs on hand.
export function changeReason(
  p: Pick<PendingPriceChange, "record_id" | "run_id" | "suggested_price">,
  runs: PriceRun[]
): string | null {
  const queued = (s: RunLine) =>
    s.record_id === p.record_id &&
    (s.action === "flagged" || s.action === "above-lowest") &&
    Number(s.new_price) === Number(p.suggested_price);
  const own = p.run_id != null ? runs.find((r) => r.id === p.run_id) : undefined;
  const line =
    own?.summary?.find(queued) ?? runs.flatMap((r) => r.summary ?? []).find(queued);
  if (!line) return null;
  if (line.action === "above-lowest") {
    return `priced above a comparable cheapest Discogs listing${
      line.lowest != null ? ` ($${line.lowest})` : ""
    } — the suggestion is $6 over it`;
  }
  return line.reason ? REASON_TEXT[line.reason] : null;
}
