import type { Metadata } from "next";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase";
import {
  PICKEM_SEASON,
  parseLeague,
  seasonWeek,
  type League,
  type LeaderboardRow,
  type PickemGame,
  type PickemParlay,
} from "@/lib/pickem";
import PickemClient from "./pickem-client";

export const metadata: Metadata = {
  title: "Football Pick'em — Late Onset Audiophile",
  description:
    "Weekly NFL and college football pick'em with live lines, line movement, house picks with confidence scores on every game, and house parlays ranked by expected value. Free to play.",
};

// Lines and scores change all day Saturday; never serve a cached page.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ at?: string; league?: string }>;

export default async function PickemPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createServerSupabase();
  // Outside production, ?at=<ISO> pretends it is another time so the
  // "starting soon" and "started" states can be checked at any hour.
  const { at, league: leagueParam } = await searchParams;
  const pretend = process.env.NODE_ENV !== "production" && at ? Date.parse(at) : NaN;
  const now = Number.isNaN(pretend) ? new Date() : new Date(pretend);

  // No league in the URL: show whichever league kicks off next, so Saturday
  // opens on college and Sunday on the NFL.
  let league = parseLeague(leagueParam);
  if (!league) {
    const { data: next } = await supabase
      .from("pickem_games")
      .select("league")
      .gt("commence_time", now.toISOString())
      .order("commence_time")
      .limit(1);
    league = parseLeague(next?.[0]?.league) ?? "ncaaf";
  }
  let week = seasonWeek(league, now);

  let { data: games } = await supabase
    .from("pickem_games")
    .select("*")
    .eq("league", league)
    .eq("season", PICKEM_SEASON)
    .eq("week", week)
    .order("commence_time");

  // Before the week's first sync lands, show the most recent week that has games.
  if (!games?.length) {
    const { data: latest } = await supabase
      .from("pickem_games")
      .select("week")
      .eq("league", league)
      .eq("season", PICKEM_SEASON)
      .order("week", { ascending: false })
      .limit(1);
    if (latest?.length) {
      week = latest[0].week;
      ({ data: games } = await supabase
        .from("pickem_games")
        .select("*")
        .eq("league", league)
        .eq("season", PICKEM_SEASON)
        .eq("week", week)
        .order("commence_time"));
    }
  }

  const [{ data: parlays }, { data: leaderboard }] = await Promise.all([
    supabase
      .from("pickem_parlays")
      .select("*")
      .eq("league", league)
      .eq("season", PICKEM_SEASON)
      .eq("week", week)
      .order("leg_count")
      .order("created_at", { ascending: false }),
    supabase.from("pickem_leaderboard").select("*").eq("season", PICKEM_SEASON),
  ]);

  const slate = (games ?? []) as PickemGame[];
  const linesAsOf = slate.reduce<string | null>(
    (acc, g) => (g.lines_updated_at && (!acc || g.lines_updated_at > acc) ? g.lines_updated_at : acc),
    null
  );

  return (
    // useSearchParams in the client shell wants a boundary, even on a
    // dynamic route where the fallback never shows.
    <Suspense fallback={null}>
      <PickemClient
        league={league satisfies League}
        week={week}
        games={slate}
        parlays={(parlays ?? []) as PickemParlay[]}
        leaderboard={(leaderboard ?? []) as LeaderboardRow[]}
        initialNow={now.getTime()}
        linesAsOf={linesAsOf}
      />
    </Suspense>
  );
}
