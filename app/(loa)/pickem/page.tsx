import type { Metadata } from "next";
import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase";
import {
  PICKEM_SEASON,
  seasonWeek,
  type LeaderboardRow,
  type PickemGame,
  type PickemParlay,
} from "@/lib/pickem";
import PickemClient from "./pickem-client";

export const metadata: Metadata = {
  title: "College Football Pick'em — Late Onset Audiophile",
  description:
    "Weekly college football pick'em with live lines, line movement, house picks with confidence scores, and recommended parlays. Free to play.",
};

// Lines and scores change all day Saturday; never serve a cached page.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ at?: string }>;

export default async function PickemPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createServerSupabase();
  // Outside production, ?at=<ISO> pretends it is another time so the
  // "starting soon" and "started" states can be checked at any hour.
  const { at } = await searchParams;
  const pretend = process.env.NODE_ENV !== "production" && at ? Date.parse(at) : NaN;
  const now = Number.isNaN(pretend) ? new Date() : new Date(pretend);
  let week = seasonWeek(now);

  let { data: games } = await supabase
    .from("pickem_games")
    .select("*")
    .eq("season", PICKEM_SEASON)
    .eq("week", week)
    .order("commence_time");

  // Before Tuesday's sync lands, show the most recent week that has games.
  if (!games?.length) {
    const { data: latest } = await supabase
      .from("pickem_games")
      .select("week")
      .eq("season", PICKEM_SEASON)
      .order("week", { ascending: false })
      .limit(1);
    if (latest?.length) {
      week = latest[0].week;
      ({ data: games } = await supabase
        .from("pickem_games")
        .select("*")
        .eq("season", PICKEM_SEASON)
        .eq("week", week)
        .order("commence_time"));
    }
  }

  const [{ data: parlays }, { data: leaderboard }] = await Promise.all([
    supabase
      .from("pickem_parlays")
      .select("*")
      .eq("season", PICKEM_SEASON)
      .eq("week", week)
      .order("id"),
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
