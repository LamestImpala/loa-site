// A house confidence score, 1-10, drawn in a circle: green and bold from 7
// up (about 58% or better against the number), yellow below that.
type Props = { value: number; size?: "sm" | "md" };

export default function ConfidenceBadge({ value, size = "sm" }: Props) {
  const strong = value >= 7;
  return (
    <span
      role="img"
      aria-label={`House confidence ${value} of 10`}
      title={`House confidence ${value} of 10`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border tabular-nums leading-none ${
        size === "md" ? "h-5 w-5 text-xs" : "h-4 w-4 text-[10px]"
      } ${strong ? "border-emerald-400 font-bold text-emerald-300" : "border-yellow-400 font-medium text-yellow-300"}`}
    >
      {value}
    </span>
  );
}
