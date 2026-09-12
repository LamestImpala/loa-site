"use client";

// One side of one market. The only place pick-button styling lives.
import type { Market, PickemGame, PickResult, Selection } from "@/lib/pickem";
import { usePickemActions } from "./pickem-context";

type Props = {
  game: PickemGame;
  market: Market;
  selection: Selection;
  /** The number, e.g. "-3.5", "O 51.5", or the ML price. */
  main: string;
  /** Second line: the price (spread, total) or the best book's price (ML). */
  sub?: string;
  /** Sportsbook with the best price: short code below lg, full name from lg up. */
  book?: string;
  bookTitle?: string;
  /** Direction this side's number moved since open, with the open number. */
  moved?: { dir: "up" | "down"; opened: string };
  house?: number;
  result: PickResult;
  on: boolean;
  locked: boolean;
  label: string;
};

export default function PickButton({ game, market, selection, main, sub, book, bookTitle, moved, house, result, on, locked, label }: Props) {
  const { canPick, togglePick } = usePickemActions();
  const disabled = locked || !canPick;
  const corner =
    result ? (
      <span
        className={`absolute right-1 top-0.5 text-[9px] font-semibold ${
          result === "win" ? "text-emerald-300" : result === "loss" ? "text-red-300" : "text-neutral-400"
        }`}
        title={result}
      >
        {result === "win" ? "W" : result === "loss" ? "L" : "P"}
      </span>
    ) : house != null ? (
      <span className="absolute right-1 top-0.5 text-[9px] font-medium text-orange-300" title={`House likes this side, ${house}/10`}>
        H{house}
      </span>
    ) : null;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      onClick={() => togglePick(game, market, selection)}
      className={`relative flex h-10 w-full min-w-0 flex-col items-start justify-center rounded-md border px-1.5 text-left leading-none transition disabled:cursor-default ${
        on
          ? "border-orange-400 bg-orange-500/15 text-white"
          : "border-white/10 bg-white/[0.03] text-neutral-200 enabled:hover:border-white/30"
      } ${locked ? "opacity-60" : ""}`}
    >
      <span className="flex items-baseline gap-1 text-[13px] tabular-nums">
        {main}
        {moved ? (
          <span className="text-[9px] text-orange-300" title={`opened ${moved.opened}`}>
            {moved.dir === "up" ? "▲" : "▼"}
          </span>
        ) : null}
      </span>
      {sub ? (
        <span className="mt-0.5 text-[10px] tabular-nums text-neutral-400">
          {sub}
          {book ? (
            <>
              {" "}
              <span className="lg:hidden" title={bookTitle}>{book}</span>
              <span className="hidden lg:inline">{bookTitle}</span>
            </>
          ) : null}
        </span>
      ) : null}
      {corner}
    </button>
  );
}
