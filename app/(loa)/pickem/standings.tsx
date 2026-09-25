"use client";

// Season standings in net units across both leagues, with the active
// league's week beside each name. The House is ranked with the players: its
// calls at 6 or better are graded at the number it took, staked by tier.
import { useMemo } from "react";
import type { HouseRecordRow, League, LeaderboardRow } from "@/lib/pickem";

type Props = { leaderboard: LeaderboardRow[]; houseRecord: HouseRecordRow[]; league: League; week: number; userId: string | null };

type Row = { id: string; name: string; house: boolean; w: number; l: number; p: number; units: number; weekUnits: number; weekRecord: string };

const HOUSE_ID = "house";

export default function Standings({ leaderboard, houseRecord, league, week, userId }: Props) {
  const standings = useMemo(() => {
    const fresh = (name: string, house: boolean): Row => ({ id: "", name, house, w: 0, l: 0, p: 0, units: 0, weekUnits: 0, weekRecord: "" });
    const add = (cur: Row, r: { wins: number; losses: number; pushes: number; units: number; week: number; league: League }) => {
      cur.w += Number(r.wins);
      cur.l += Number(r.losses);
      cur.p += Number(r.pushes);
      cur.units += Number(r.units);
      if (r.week === week && r.league === league) {
        cur.weekUnits = Number(r.units);
        cur.weekRecord = `${r.wins}-${r.losses}${Number(r.pushes) ? `-${r.pushes}` : ""}`;
      }
    };
    const byUser = new Map<string, Row>();
    for (const r of leaderboard) {
      const cur = byUser.get(r.user_id) ?? { ...fresh(r.display_name, false), id: r.user_id };
      add(cur, r);
      byUser.set(r.user_id, cur);
    }
    const rows = [...byUser.values()];
    if (houseRecord.length) {
      const house = { ...fresh("The House", true), id: HOUSE_ID };
      for (const r of houseRecord) add(house, r);
      rows.push(house);
    }
    return rows.sort((a, b) => b.units - a.units || b.w - a.w);
  }, [leaderboard, houseRecord, league, week]);

  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Net units, season to date, NFL and college together. The House plays its own calls: 1 unit on a lean, 2 on a like, 3 on a best bet.
      </p>
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
                <span className={`truncate font-medium ${s.house ? "text-orange-300" : "text-white"}`}>{s.name}</span>
                {s.house ? (
                  <span className="ml-1.5 rounded-sm border border-orange-400/60 px-1 align-[1px] text-[8px] font-semibold uppercase tracking-wide text-orange-300">
                    AI
                  </span>
                ) : null}
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
