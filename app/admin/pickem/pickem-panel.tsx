"use client";

import { useEffect, useState } from "react";
import { LEAGUES, LEAGUE_META, type League } from "@/lib/pickem";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass as btn } from "../_shell/ui";

type Call = { confidence: number; pick?: string; basis?: string };
type PreviewBody = { preview?: { picks?: Record<string, { spread: Call; total: Call; ml: Call }> }; batches?: { projections_dropped?: number }[] };

// One line on how a preview's confidences fell, so a dry run can be read
// without scrolling the JSON: "12 games · 5:14 6:18 7:4 · spread 5:2 6:8 7:2 …".
function confidenceSpread(body: PreviewBody): string {
  const picks = body.preview?.picks;
  if (!picks) return "";
  const games = Object.values(picks);
  if (!games.length) return "0 games previewed";
  const tally = (calls: Call[]) => {
    const by = new Map<number, number>();
    for (const c of calls) by.set(c.confidence, (by.get(c.confidence) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(" ");
  };
  const all = games.flatMap((g) => [g.spread, g.total, g.ml]);
  const dropped = (body.batches ?? []).reduce((n, b) => n + (b.projections_dropped ?? 0), 0);
  // What the plays (6 and up) rest on, and how one-sided the totals are.
  const bases = new Map<string, number>();
  for (const c of all) if (c.confidence >= 6) bases.set(c.basis ?? "?", (bases.get(c.basis ?? "?") ?? 0) + 1);
  const unders = games.filter((g) => g.total.pick === "under").length;
  return [
    `${games.length} games`,
    `all ${tally(all)}`,
    `spread ${tally(games.map((g) => g.spread))}`,
    `total ${tally(games.map((g) => g.total))}`,
    `ml ${tally(games.map((g) => g.ml))}`,
    `unders ${unders}/${games.length}`,
    `basis at 6+ ${[...bases.entries()].map(([k, n]) => `${k}:${n}`).join(" ") || "none"}`,
    `projections dropped ${dropped}`,
  ].join(" · ");
}

type ClvRow = {
  market: string;
  tier: string;
  calls: number;
  beat_close: number;
  lost_to_close: number;
  same_as_close: number;
  avg_clv: number;
  wins: number;
  losses: number;
  pushes: number;
};
const TIER_ORDER = ["best", "like", "lean", "pass"];

// The house against the closing line (view pickem_house_clv_summary): did the
// number move its way after it picked. Positive points are good. It shows a
// signal in far fewer calls than the win-loss record does.
function ClosingLineValue({ league }: { league: League }) {
  const { supabase } = useAdmin();
  const [rows, setRows] = useState<ClvRow[] | null>(null);
  useEffect(() => {
    let live = true;
    supabase
      .from("pickem_house_clv_summary")
      .select("market, tier, calls, beat_close, lost_to_close, same_as_close, avg_clv, wins, losses, pushes")
      .eq("league", league)
      .then(({ data }) => {
        if (live) setRows((data ?? []) as ClvRow[]);
      });
    return () => {
      live = false;
    };
  }, [supabase, league]);
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.market.localeCompare(b.market) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const calls = rows.reduce((n, r) => n + r.calls, 0);
  const points = rows.reduce((n, r) => n + r.calls * Number(r.avg_clv), 0);
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-white">House against the closing line</h3>
      <p className="mt-1 text-sm text-neutral-400">
        {calls} spread and total calls, passes included, averaging {(points / calls).toFixed(2)} points better than the
        close. Above zero means the line tends to move the house&apos;s way after it picks.
      </p>
      <table className="mt-2 text-left text-xs text-neutral-300">
        <thead className="text-neutral-500">
          <tr>
            {["Market", "Tier", "Calls", "Beat", "Same", "Lost", "Avg pts", "W-L-P"].map((h) => (
              <th key={h} className="pr-4 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sorted.map((r) => (
            <tr key={`${r.market}-${r.tier}`}>
              <td className="pr-4">{r.market}</td>
              <td className="pr-4">{r.tier}</td>
              <td className="pr-4">{r.calls}</td>
              <td className="pr-4">{r.beat_close}</td>
              <td className="pr-4">{r.same_as_close}</td>
              <td className="pr-4">{r.lost_to_close}</td>
              <td className="pr-4">{Number(r.avg_clv).toFixed(2)}</td>
              <td className="pr-4">{r.wins}-{r.losses}-{r.pushes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Buttons that run the pick'em jobs for one league on demand with the admin's
// session token (the cron runs the same routes with CRON_SECRET).
export function PickemPanel() {
  const { supabase } = useAdmin();
  const [league, setLeague] = useState<League>("ncaaf");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState("");

  async function run(job: string, label: string) {
    const path = `/api/pickem/${league}/${job}`;
    setBusy(label);
    setLog("");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const body = await res.json();
      const summary = res.ok ? confidenceSpread(body) : "";
      setLog(`${res.ok ? "OK" : `HTTP ${res.status}`}${summary ? ` · ${summary}\n` : " · "}${JSON.stringify(body)}`);
    } catch (e) {
      setLog(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-white">Pick&apos;em</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Lines refresh once a day per league, plus Saturday afternoon for college and Sunday afternoon for the
        NFL. House picks post Tuesday morning Central for both leagues, as soon as the week&apos;s lines are in, so its
        numbers are early ones; college fills in late additions Saturday morning and the NFL on Thursday.
        College line refreshes also store ESPN&apos;s FPI prediction for each upcoming game. Use these to run a job for the selected league now. Refreshing lines spends about 3 of the
        500 monthly Odds API requests (5 when there are finals to grade); a house run is a handful of Claude
        calls. Parlays are rebuilt from the picks on every house run; tailed and locked tickets are never
        removed.
      </p>
      <div role="group" aria-label="League" className="mt-4 inline-flex gap-0.5 rounded-md border border-white/15 p-0.5">
        {LEAGUES.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={l === league}
            disabled={busy !== null}
            onClick={() => setLeague(l)}
            className={`h-8 rounded px-3 text-sm transition ${l === league ? "bg-white text-neutral-950" : "text-neutral-300 hover:text-white"}`}
          >
            {LEAGUE_META[l].short}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null} onClick={() => run("sync", "sync")} className={btn}>
          {busy === "sync" ? "Refreshing…" : "Refresh lines & scores"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => run("house", "house")} className={btn}>
          {busy === "house" ? "Picking…" : "Generate missing house picks"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Re-pick every upcoming game? Parlays are rebuilt; tailed and locked ones are kept.")) {
              run("house?force=1", "force");
            }
          }}
          className={btn}
        >
          {busy === "force" ? "Picking…" : "Re-pick whole week"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Preview picks for games without them? Nothing is written, but it still spends Claude calls.")) {
              run("house?dry=1", "dry");
            }
          }}
          className={btn}
        >
          {busy === "dry" ? "Previewing…" : "Preview picks (dry run)"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Preview a re-pick of every upcoming game? Nothing is written, but it spends a full run of Claude calls.")) {
              run("house?force=1&dry=1", "forcedry");
            }
          }}
          className={btn}
        >
          {busy === "forcedry" ? "Previewing…" : "Preview full re-pick (dry run)"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => run("house?only=parlays", "parlays")} className={btn}>
          {busy === "parlays" ? "Rebuilding…" : "Rebuild parlays"}
        </button>
      </div>
      {log ? <pre className="mt-3 whitespace-pre-wrap break-all text-xs text-neutral-300">{log}</pre> : null}
      <ClosingLineValue league={league} />
    </section>
  );
}
