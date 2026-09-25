// A pick's grade as a small word: WIN / LOSS / PUSH, dimmed while the game is
// still on and the grade is only where things stand right now.
import type { PickResult } from "@/lib/pickem";

const LIVE_TITLES = { win: "on track", loss: "behind", push: "on the number" } as const;

export default function ResultTag({ result, provisional }: { result: PickResult; provisional: boolean }) {
  if (!result) return null;
  const cls = result === "win" ? "text-emerald-300" : result === "loss" ? "text-red-300" : "text-neutral-400";
  return (
    <span className={`text-[10px] font-semibold uppercase ${cls} ${provisional ? "opacity-60" : ""}`} title={provisional ? LIVE_TITLES[result] : undefined}>
      {result}
    </span>
  );
}
