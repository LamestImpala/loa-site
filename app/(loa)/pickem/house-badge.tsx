"use client";

// The house's tier on one side, with its reasoning a hover or focus away.
// Clicking opens the row's "lines & house" panel, the persistent view of the
// same text, which is what phones get since they cannot hover. It is a
// sibling of the pick button, never a child, so a locked (disabled) button
// cannot swallow its events and a click never toggles the pick. Renders
// nothing when the house passes.
import { HOUSE_TIER_META, houseStake, houseTier } from "@/lib/pickem";
import ConfidenceBadge from "./confidence-badge";

type Props = {
  /** House confidence, 1-10. */
  value: number;
  why?: string;
  /** What the pick is, for the accessible name: "Alabama -9", "Over 47". */
  label: string;
  onShowHouse?: () => void;
};

export default function HouseBadge({ value, why, label, onShowHouse }: Props) {
  const tier = houseTier(value);
  if (tier === "pass") return null;
  const meta = HOUSE_TIER_META[tier];
  const stake = houseStake(value);
  const units = `${stake} unit${stake === 1 ? "" : "s"}`;
  const name = `House ${meta.verb} ${label} (${units})${why ? `: ${why}` : ""}`;
  const popover = why ? (
    <span
      role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-64 rounded-md border border-white/15 bg-neutral-950 p-2 text-left text-xs font-normal leading-5 text-neutral-200 shadow-lg group-hover:block group-focus-visible:block"
    >
      <span className="block text-orange-300">
        House {meta.pill.toLowerCase()} · {units} · {meta.pct}
      </span>
      {why}
    </span>
  ) : null;
  const cls = "group relative inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white/60";
  if (!onShowHouse) {
    return (
      <span tabIndex={0} aria-label={name} className={cls}>
        <ConfidenceBadge value={value} title="" />
        {popover}
      </span>
    );
  }
  return (
    <button type="button" aria-label={name} onClick={onShowHouse} className={cls}>
      <ConfidenceBadge value={value} title="" />
      {popover}
    </button>
  );
}
