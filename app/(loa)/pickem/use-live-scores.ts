"use client";

// Polls the live-score route every 30 seconds while a game on the slate is
// in play and the tab is visible. What it learns sticks: the route stops
// reporting a game once the database has graded it, and the row keeps its
// final until the refreshed server data arrives.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { League, PickemGame } from "@/lib/pickem";
import { hasGamesInPlay, type LiveMap, type LivePayload } from "@/lib/pickem-live";

export const LIVE_POLL_MS = 30_000;

export function useLiveScores(league: League, games: PickemGame[], now: number): LiveMap {
  const [live, setLive] = useState<LiveMap>({});
  const active = hasGamesInPlay(games, live, now);

  // Read inside the poll without being effect dependencies: a re-render
  // must not restart the poll and throw away a response in flight.
  const router = useRouter();
  const routerRef = useRef(router);
  const liveRef = useRef<LiveMap>({});
  useEffect(() => {
    routerRef.current = router;
    liveRef.current = live;
  }, [router, live]);

  useEffect(() => {
    if (!active) return;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/pickem/${league}/live`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as LivePayload;
        if (body.league !== league) return; // the reader switched leagues mid-flight
        const prev = liveRef.current;
        setLive({ ...prev, ...body.scores });
        // A game just went final: pull the graded rows and the leaderboard.
        if (Object.entries(body.scores).some(([id, s]) => s.completed && !prev[id]?.completed)) routerRef.current.refresh();
      } catch {
        // Keep the last scores; the next tick tries again.
      }
    };
    poll();
    const timer = setInterval(poll, LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, league]);

  return live;
}
