"use client";

// One side of one market. The only place pick-button styling lives. The
// corner (result letter or house badge) sits beside the button, not inside
// it, so the badge stays clickable on a locked button.
import { houseTier, type Market, type PickemGame, type PickResult, type Selection } from "@/lib/pickem";
import { usePickemActions } from "./pickem-context";
import HouseBadge from "./house-badge";

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
  /** The house's reasoning behind `house`. */
  why?: string;
  /** Opens the row's "lines & house" panel. */
  onShowHouse?: () => void;
  result: PickResult;
  /** The game is still on: `result` is where the pick stands now, not a grade. */
  provisional?: boolean;
  on: boolean;
  locked: boolean;
  label: string;
};

const LIVE_TITLES = { win: "on track", loss: "behind", push: "on the number" } as const;

export default function PickButton({ game, market, selection, main, sub, book, bookTitle, moved, house, why, onShowHouse, result, provisional, on, locked, label }: Props) {
  const { canPick, togglePick } = usePickemActions();
  const disabled = locked || !canPick;
  const corner =
    result ? (
      <span
        className={`absolute right-1 top-0.5 text-[9px] font-semibold ${
          result === "win" ? "text-emerald-300" : result === "loss" ? "text-red-300" : "text-neutral-400"
        } ${provisional ? "opacity-60" : ""}`}
        title={provisional ? LIVE_TITLES[result] : result}
      >
        {result === "win" ? "W" : result === "loss" ? "L" : "P"}
      </span>
    ) : house != null && houseTier(house) !== "pass" ? (
      <span className="absolute right-0.5 top-0.5">
        <HouseBadge value={house} why={why} label={label} onShowHouse={onShowHouse} />
      </span>
    ) : null;

  return (
    <span className="relative block min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={on}
        aria-label={label}
        onClick={() => togglePick(game, market, selection)}
        className={`flex h-10 w-full min-w-0 flex-col items-start justify-center rounded-md border px-1.5 text-left leading-none transition disabled:cursor-default ${
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
      </button>
      {corner}
    </span>
  );
}
