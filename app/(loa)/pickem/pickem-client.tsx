"use client";

// Page shell: owns the clock, the live scores, the open row, and the view;
// everything else is a section component fed by props.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LEAGUES, LEAGUE_META, type League, type LeaderboardRow, type PickemGame, type PickemParlay } from "@/lib/pickem";
import { bucketGames, conferencesOnSlate, defaultView, fmtKickLong, tzLabel, type View } from "@/lib/pickem-board";
import { applyLive } from "@/lib/pickem-live";
import { PickemActionsContext } from "./pickem-context";
import { usePickemSession } from "./use-pickem-session";
import { useLiveScores } from "./use-live-scores";
import { useViewerTimeZone } from "./use-viewer-timezone";
import AuthCard from "./auth-card";
import ViewPicker, { useBoardView } from "./view-picker";
import Board from "./board";
import Parlays from "./parlays";
import Standings from "./standings";
import HowItWorks from "./how-it-works";

type Props = {
  league: League;
  week: number;
  games: PickemGame[];
  parlays: PickemParlay[];
  leaderboard: LeaderboardRow[];
  /** Server clock at render, so the first client render matches the HTML. */
  initialNow: number;
  linesAsOf: string | null;
};

export default function PickemClient({ league, week, games, parlays, leaderboard, initialNow, linesAsOf }: Props) {
  const auth = usePickemSession();
  const tz = useViewerTimeZone();

  // Starts on the server's clock (fresh at render, and what the HTML was
  // built from) and moves to the browser's from the first tick on.
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ESPN's scores laid over the rows while games are on. `games` stays the
  // database's view; everything that shows a score reads `liveGames`.
  const live = useLiveScores(league, games, now);
  const liveGames = useMemo(() => applyLive(games, live), [games, live]);

  // Conferences only mean something for college; NFL teams would all fall through to FCS.
  const conferences = useMemo(() => (league === "ncaaf" ? conferencesOnSlate(games) : []), [league, games]);
  const { view: urlView, conf, setView } = useBoardView(conferences);
  const buckets = useMemo(() => bucketGames(liveGames, now), [liveGames, now]);

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
            <nav aria-label="League" className="inline-flex gap-0.5 self-center rounded-md border border-white/15 p-0.5">
              {LEAGUES.map((l) => (
                <Link
                  key={l}
                  href={{ pathname: "/pickem", query: { league: l } }}
                  aria-current={l === league ? "page" : undefined}
                  className={`h-7 rounded px-2.5 text-sm leading-7 transition ${l === league ? "bg-white text-neutral-950" : "text-neutral-300 hover:text-white"}`}
                >
                  {LEAGUE_META[l].short}
                </Link>
              ))}
            </nav>
            <p className="text-sm tabular-nums text-neutral-400">
              {LEAGUE_META[league].label} · Week {week} · {games.length} games
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
          <p className="py-8 text-sm text-neutral-400">This week&apos;s {league === "nfl" ? "NFL" : "college"} lines haven&apos;t been pulled yet. Check back Tuesday.</p>
        ) : (
          <>
            <ViewPicker
              view={view}
              conf={conf}
              showConference={league === "ncaaf"}
              soonCount={buckets.soon.length}
              openCount={buckets.upcoming.length}
              conferences={conferences}
              onChange={setView}
            />
            <Board
              games={liveGames}
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

        <Parlays parlays={parlays} games={liveGames} tails={auth.tails} now={now} />
        <Standings leaderboard={leaderboard} league={league} week={week} userId={auth.userId} />
        <HowItWorks />
      </section>
    </PickemActionsContext.Provider>
  );
}
