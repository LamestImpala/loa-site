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

export type PriceReason = NonNullable<PriceRun["summary"][number]["reason"]>;

// Why the run queued each pending change, keyed "run_id:record_id", read
// from that run's summary (an "above-lowest" entry is an undercut). Only
// covers the runs loaded, so older pending rows have no reason.
export function reasonByPending(runs: PriceRun[]): Map<string, PriceReason> {
  const m = new Map<string, PriceReason>();
  for (const run of runs) {
    for (const s of run.summary ?? []) {
      const reason = s.action === "above-lowest" ? "lowest" : s.reason;
      if (s.action === "applied" || !reason) continue;
      m.set(`${run.id}:${s.record_id}`, reason);
    }
  }
  return m;
}

export function pendingReason(
  p: Pick<PendingPriceChange, "run_id" | "record_id">,
  reasons: Map<string, PriceReason>
): PriceReason | undefined {
  return p.run_id == null ? undefined : reasons.get(`${p.run_id}:${p.record_id}`);
}

// Same heuristic as the email: a cut worth acting on is modest (≤30%) with
// several copies competing, or any cut on a stocked release (30+ copies —
// the price run chases the cheapest listing there); everything else is
// likely condition noise, a scarce copy, or a suggestion-based increase.
// A time-decay step is always worth a look — it's small by design.
export const ACTIONABLE_MAX_CUT = 0.3;
export const ACTIONABLE_MIN_COPIES = 3;
export const STOCKED_COPIES = 30;

export function isActionable(
  p: PendingPriceChange,
  forSale: Map<number, number>,
  reason?: PriceReason
): boolean {
  if (p.pct_change >= 0) return false;
  if (reason === "decay") return true;
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
