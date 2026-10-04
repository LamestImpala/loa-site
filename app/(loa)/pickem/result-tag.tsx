// A pick's grade as a small word: WIN / LOSS / PUSH once the game is final.
// While the game is still on it's only where things stand right now, so it
// reads UP / DOWN / EVEN behind a pulsing dot instead.
import type { PickResult } from "@/lib/pickem";

type Graded = Exclude<PickResult, null>;

export const LIVE_WORDS: Record<Graded, string> = { win: "up", loss: "down", push: "even" };
export const LIVE_TITLES: Record<Graded, string> = { win: "live: on track", loss: "live: behind", push: "live: on the number" };

export function resultColor(result: Graded): string {
  return result === "win" ? "text-emerald-300" : result === "loss" ? "text-red-300" : "text-neutral-400";
}

/** The pulsing dot that marks a grade as live. */
export function LiveDot({ size = "h-1.5 w-1.5" }: { size?: string }) {
  return <span aria-hidden className={`inline-block ${size} animate-pulse rounded-full bg-current`} />;
}

export default function ResultTag({ result, provisional }: { result: PickResult; provisional: boolean }) {
  if (!result) return null;
  if (provisional) {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase ${resultColor(result)}`} title={LIVE_TITLES[result]}>
        <LiveDot />
        {LIVE_WORDS[result]}
      </span>
    );
  }
  return <span className={`text-[10px] font-semibold uppercase ${resultColor(result)}`}>{result}</span>;
}
