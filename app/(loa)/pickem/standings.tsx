"use client";

// Season standings in net units, with this week's line beside each name.
import { useMemo } from "react";
import type { LeaderboardRow } from "@/lib/pickem";

type Props = { leaderboard: LeaderboardRow[]; week: number; userId: string | null };

export default function Standings({ leaderboard, week, userId }: Props) {
  const standings = useMemo(() => {
    const byUser = new Map<string, { name: string; w: number; l: number; p: number; units: number; weekUnits: number; weekRecord: string }>();
    for (const r of leaderboard) {
      const cur = byUser.get(r.user_id) ?? { name: r.display_name, w: 0, l: 0, p: 0, units: 0, weekUnits: 0, weekRecord: "" };
      cur.w += Number(r.wins);
      cur.l += Number(r.losses);
      cur.p += Number(r.pushes);
      cur.units += Number(r.units);
      if (r.week === week) {
        cur.weekUnits = Number(r.units);
        cur.weekRecord = `${r.wins}-${r.losses}${Number(r.pushes) ? `-${r.pushes}` : ""}`;
      }
      byUser.set(r.user_id, cur);
    }
    return [...byUser.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.units - a.units || b.w - a.w);
  }, [leaderboard, week]);

  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
      <p className="mt-1 text-sm text-neutral-400">Net units, season to date.</p>
      {standings.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">Nobody has a graded pick yet. Standings appear after the first final.</p>
      ) : (
        <ol className="mt-4 text-sm">
          <li className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] gap-x-3 pb-1 text-[11px] text-neutral-500">
            <span>#</span>
            <span>Player</span>
            <span className="text-right">Week {week}</span>
            <span className="text-right">Units</span>
          </li>
          {standings.map((s, i) => (
            <li
              key={s.id}
              className={`grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-t border-white/10 py-2 tabular-nums ${
                s.id === userId ? "bg-orange-500/10 -mx-2 px-2" : ""
              }`}
            >
              <span className="text-neutral-500">{i + 1}</span>
              <span className="min-w-0">
                <span className="truncate font-medium text-white">{s.name}</span>
                <span className="ml-2 text-neutral-500">
                  {s.w}-{s.l}
                  {s.p ? `-${s.p}` : ""}
                </span>
              </span>
              <span className="text-right text-neutral-400">{s.weekRecord ? `${s.weekRecord} · ${signed(s.weekUnits)}` : "—"}</span>
              <span className={`text-right font-semibold ${s.units >= 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(s.units)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
