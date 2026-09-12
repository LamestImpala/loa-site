"use client";

// Page shell: owns the clock, the open row, and the view; everything else
// is a section component fed by props.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeaderboardRow, PickemGame, PickemParlay } from "@/lib/pickem";
import { bucketGames, conferencesOnSlate, defaultView, fmtKickLong, tzLabel, type View } from "@/lib/pickem-board";
import { PickemActionsContext } from "./pickem-context";
import { usePickemSession } from "./use-pickem-session";
import { useViewerTimeZone } from "./use-viewer-timezone";
import AuthCard from "./auth-card";
import ViewPicker, { useBoardView } from "./view-picker";
import Board from "./board";
import Parlays from "./parlays";
import Standings from "./standings";
import HowItWorks from "./how-it-works";

type Props = {
  week: number;
  games: PickemGame[];
  parlays: PickemParlay[];
  leaderboard: LeaderboardRow[];
  /** Server clock at render, so the first client render matches the HTML. */
  initialNow: number;
  linesAsOf: string | null;
};

export default function PickemClient({ week, games, parlays, leaderboard, initialNow, linesAsOf }: Props) {
  const auth = usePickemSession();
  const tz = useViewerTimeZone();

  // Starts on the server's clock (fresh at render, and what the HTML was
  // built from) and moves to the browser's from the first tick on.
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const conferences = useMemo(() => conferencesOnSlate(games), [games]);
  const { view: urlView, conf, setView } = useBoardView(conferences);
  const buckets = useMemo(() => bucketGames(games, now), [games, now]);

  // Decide the auto view once so it does not flip under the reader when the
  // last "soon" game kicks off; the picker's live count shows the change.
  const [autoView] = useState<View>(() => defaultView(buckets.soon.length));
  const view: View = urlView === "auto" ? autoView : urlView;

  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const onToggleExpand = useCallback((id: string) => setOpenGameId((cur) => (cur === id ? null : id)), []);
  const onShowAll = useCallback(() => setView("all", null), [setView]);

  const actions = useMemo(
    () => ({ canPick: auth.canPick, togglePick: auth.togglePick, toggleTail: auth.toggleTail }),
    [auth.canPick, auth.togglePick, auth.toggleTail]
  );

  const myPickCount = useMemo(() => {
    const ids = new Set(games.map((g) => g.id));
    return [...auth.picks.values()].filter((p) => ids.has(p.game_id)).length;
  }, [auth.picks, games]);

  return (
    <PickemActionsContext.Provider value={actions}>
      <section className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">
        <header className="mb-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Pick&apos;em</h1>
            <p className="text-sm tabular-nums text-neutral-400">
              College football · Week {week} · {games.length} games
              {linesAsOf ? (
                <>
                  {" "}· lines as of {fmtKickLong(linesAsOf, tz)} {tzLabel(tz, now)}
                </>
              ) : null}
            </p>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            One unit a pick at the best price across nine books. House picks are there to fade or follow. No money changes hands.
          </p>
        </header>

        <AuthCard auth={auth} myPickCount={myPickCount} openCount={buckets.upcoming.length} />

        <h2 className="sr-only">Games</h2>
        {games.length === 0 ? (
          <p className="py-8 text-sm text-neutral-400">This week&apos;s lines haven&apos;t been pulled yet. Check back after Tuesday morning.</p>
        ) : (
          <>
            <ViewPicker
              view={view}
              conf={conf}
              soonCount={buckets.soon.length}
              openCount={buckets.upcoming.length}
              conferences={conferences}
              onChange={setView}
            />
            <Board
              games={games}
              view={view}
              conf={conf}
              now={now}
              tz={tz}
              picks={auth.picks}
              openGameId={openGameId}
              onToggleExpand={onToggleExpand}
              onShowAll={onShowAll}
            />
          </>
        )}

        <Parlays parlays={parlays} games={games} tails={auth.tails} now={now} />
        <Standings leaderboard={leaderboard} week={week} userId={auth.userId} />
        <HowItWorks />
      </section>
    </PickemActionsContext.Provider>
  );
}
