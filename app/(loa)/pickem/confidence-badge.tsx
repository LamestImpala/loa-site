// The house's tier on a call as a small pill: LEAN (about 55%), LIKE (about
// 58%) or BEST (62% or better against the number). A pass, which is what a
// 5 means, renders nothing: the number is fair and there is no side to mark.
//
// The small size sits in the corner of a 4.25rem pick button on phones,
// where a word collides with "-10.5 ▲", so below lg it is a colored dot and
// the word takes over from lg up. The medium size (panels) is always the word.
import { HOUSE_TIER_META, houseTier } from "@/lib/pickem";

type Props = {
  /** House confidence, 1-10. */
  value: number;
  size?: "sm" | "md";
  /** Native tooltip; pass "" when a parent supplies its own. */
  title?: string;
};

const PILL = {
  lean: "border-yellow-400/70 text-yellow-300",
  like: "border-emerald-400 text-emerald-300",
  best: "border-emerald-400 bg-emerald-400 text-neutral-950",
} as const;

const DOT = {
  lean: "bg-yellow-400",
  like: "bg-emerald-400",
  best: "bg-emerald-400 ring-1 ring-white/80",
} as const;

export default function ConfidenceBadge({ value, size = "sm", title }: Props) {
  const tier = houseTier(value);
  if (tier === "pass") return null;
  const meta = HOUSE_TIER_META[tier];
  const name = tier === "best" ? "House best bet" : `House ${meta.pill.toLowerCase()}`;
  // No display utility here: each variant sets its own so `hidden` can win below lg.
  const pill = `shrink-0 items-center justify-center rounded-sm border font-semibold uppercase tracking-wide leading-none ${PILL[tier]}`;
  return (
    <span role="img" aria-label={name} title={title === undefined ? `${name}, ${meta.pct} against the number` : title || undefined} className="inline-flex shrink-0 items-center">
      {size === "md" ? (
        <span className={`${pill} inline-flex h-4 px-1.5 text-[10px]`}>{meta.pill}</span>
      ) : (
        <>
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full lg:hidden ${DOT[tier]}`} />
          <span className={`${pill} hidden h-3 px-1 text-[8px] lg:inline-flex`}>{meta.pill}</span>
        </>
      )}
    </span>
  );
}
