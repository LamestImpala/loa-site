import type { Metadata } from "next";
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

export default async function PickemPage() {
  const supabase = createServerSupabase();
  const now = new Date();
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

  return (
    <PickemClient
      week={week}
      games={(games ?? []) as PickemGame[]}
      parlays={(parlays ?? []) as PickemParlay[]}
      leaderboard={(leaderboard ?? []) as LeaderboardRow[]}
    />
  );
}
