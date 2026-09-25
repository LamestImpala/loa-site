"use client";

// The sheet: games in play first, then day dividers with one row per game,
// and the finals folded away at the bottom. Pure derivation from props; no
// state of its own.
import { useMemo } from "react";
import type { Conference } from "@/lib/pickem-conferences";
import { displayTeam, type PickemGame, type PickemPick } from "@/lib/pickem";
import { bucketGames, filterByConference, fmtKickLong, groupByDay, kickoffMs, tzLabel, type View } from "@/lib/pickem-board";
import { pickKey } from "./use-pickem-session";
import GameRow from "./game-row";

type Props = {
  games: PickemGame[];
  view: View;
  conf: Conference | null;
  now: number;
  tz: string;
  picks: Map<string, PickemPick>;
  openGameId: string | null;
  onToggleExpand: (id: string) => void;
  onShowAll: () => void;
};

export default function Board({ games, view, conf, now, tz, picks, openGameId, onToggleExpand, onShowAll }: Props) {
  const buckets = useMemo(() => bucketGames(games, now), [games, now]);

  // Games in play stay on the board in every view; finals fold away except
  // in the "starting soon" view, which is only about what is next.
  const { inPlay, open, finals } = useMemo(() => {
    if (view === "soon") return { inPlay: buckets.inProgress, open: buckets.soon, finals: [] as PickemGame[] };
    if (view === "conf" && conf) {
      return {
        inPlay: filterByConference(buckets.inProgress, conf),
        open: filterByConference(buckets.upcoming, conf),
        finals: filterByConference(buckets.final, conf),
      };
    }
    return { inPlay: buckets.inProgress, open: buckets.upcoming, finals: buckets.final };
  }, [view, conf, buckets]);

  const openDays = useMemo(() => groupByDay(open, tz), [open, tz]);
  const finalDays = useMemo(() => groupByDay(finals, tz), [finals, tz]);
  const zone = tzLabel(tz, now);

  const rows = (list: PickemGame[]) =>
    list.map((g) => (
      <GameRow
        key={g.id}
        game={g}
        locked={g.completed || kickoffMs(g) <= now}
        tz={tz}
        spreadPick={picks.get(pickKey(g.id, "spread"))}
        totalPick={picks.get(pickKey(g.id, "total"))}
        mlPick={picks.get(pickKey(g.id, "ml"))}
        expanded={openGameId === g.id}
        onToggleExpand={onToggleExpand}
      />
    ));

  const next = buckets.upcoming[0];

  return (
    <div>
      <div className="mt-4 hidden border-b border-white/15 pb-1 text-[11px] text-neutral-500 lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)_repeat(3,10.5rem)] lg:gap-x-3">
        <div>Kick ({zone})</div>
        <div>Matchup</div>
        <div>Spread</div>
        <div>Total</div>
        <div>Moneyline</div>
      </div>

      {inPlay.length > 0 ? (
        <section aria-label="In play">
          <h3 className="flex items-center gap-2 pb-1 pt-5 text-sm font-medium text-orange-200">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
            Live · {inPlay.length} game{inPlay.length === 1 ? "" : "s"}
          </h3>
          <ol>{rows(inPlay)}</ol>
        </section>
      ) : null}

      {open.length === 0 ? (
        <p className="py-6 text-sm text-neutral-400">
          {view === "soon" ? (
            <>
              Nothing kicks off in the next hour.
              {next ? (
                <>
                  {" "}Next up is {displayTeam(next.league, next.away_team)} at {displayTeam(next.league, next.home_team)}, {fmtKickLong(next.commence_time, tz)} {zone}.
                </>
              ) : null}{" "}
              <button type="button" onClick={onShowAll} className="text-orange-300 underline-offset-2 hover:underline">
                Show all games
              </button>
            </>
          ) : view === "conf" ? (
            <>No {conf} games left to pick this week.</>
          ) : (
            <>Every game this week has kicked off.</>
          )}
        </p>
      ) : (
        openDays.map((d) => (
          <section key={d.key}>
            <h3 className="pb-1 pt-5 text-sm font-medium text-neutral-300">
              {d.label}
              <span className="ml-2 text-xs text-neutral-500 lg:hidden">{zone}</span>
            </h3>
            <ol>{rows(d.games)}</ol>
          </section>
        ))
      )}

      {finals.length > 0 ? (
        <details className="mt-8 border-t border-white/15 pt-2">
          <summary className="cursor-pointer select-none py-2 text-sm text-neutral-300 hover:text-white">
            Final · {finals.length} game{finals.length === 1 ? "" : "s"}
          </summary>
          {finalDays.map((d) => (
            <section key={d.key}>
              <h3 className="pb-1 pt-4 text-sm font-medium text-neutral-300">{d.label}</h3>
              <ol>{rows(d.games)}</ol>
            </section>
          ))}
        </details>
      ) : null}
    </div>
  );
}
