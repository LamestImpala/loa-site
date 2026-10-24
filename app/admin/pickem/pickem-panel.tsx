"use client";

import { useEffect, useState } from "react";
import { LEAGUES, LEAGUE_META, PICKEM_SEASON, tallyAvgClv, tallyWinPct, type CalibrationRow, type League, type Market } from "@/lib/pickem";
import { calibrationTable, FEEDBACK_MIN_CALLS, type CalibrationSplit } from "@/lib/pickem-feedback";
import { stakeTable, STAKE_MIN_CALLS } from "@/lib/pickem-house";
import { HOUSE_VARIANTS } from "@/lib/pickem-variants";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass as btn } from "../_shell/ui";

type Call = { confidence: number; pick?: string; basis?: string };
type PreviewBody = {
  preview?: { picks?: Record<string, { spread: Call; total: Call; ml: Call; variant?: string }> };
  batches?: { projections_dropped?: number }[];
};

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
  // Each prompt variant's spread and total calls, to see whether one shifts the confidence.
  const variants = [...new Set(games.map((g) => g.variant ?? "?"))].sort();
  const byVariant = variants.map((v) => {
    const mine = games.filter((g) => (g.variant ?? "?") === v);
    return `${v} (${mine.length}) ${tally(mine.flatMap((g) => [g.spread, g.total]))}`;
  });
  return [
    `${games.length} games`,
    `all ${tally(all)}`,
    `spread ${tally(games.map((g) => g.spread))}`,
    `total ${tally(games.map((g) => g.total))}`,
    `ml ${tally(games.map((g) => g.ml))}`,
    `unders ${unders}/${games.length}`,
    `basis at 6+ ${[...bases.entries()].map(([k, n]) => `${k}:${n}`).join(" ") || "none"}`,
    `projections dropped ${dropped}`,
    `by variant, spread+total: ${byVariant.join(" | ")}`,
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

const MARKET_FILTERS: (Market | "all")[] = ["all", "spread", "total", "ml"];
const SPLITS: { key: CalibrationSplit; label: string }[] = [
  { key: "confidence", label: "Confidence" },
  { key: "basis", label: "Basis" },
  { key: "prompt_version", label: "Prompt" },
];

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-md border border-white/15 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`h-7 rounded px-2.5 text-xs transition ${o.key === value ? "bg-white text-neutral-950" : "text-neutral-300 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The house's record on its latest calls (view pickem_house_calibration),
// split by confidence, basis or prompt: what the house is shown after each
// slate, and what its stakes and parlay odds are read from. Read-only.
function Calibration({ league }: { league: League }) {
  const { supabase } = useAdmin();
  const [rows, setRows] = useState<CalibrationRow[] | null>(null);
  const [market, setMarket] = useState<Market | "all">("all");
  const [by, setBy] = useState<CalibrationSplit>("confidence");
  useEffect(() => {
    let live = true;
    supabase
      .from("pickem_house_calibration")
      .select("*")
      .eq("league", league)
      .eq("season", PICKEM_SEASON)
      .then(({ data }) => {
        if (live) setRows((data ?? []) as CalibrationRow[]);
      });
    return () => {
      live = false;
    };
  }, [supabase, league]);
  if (!rows?.length) return null;
  const table = calibrationTable(rows, { market, by });
  const stakes = stakeTable(rows, league, PICKEM_SEASON);
  const clvClass = (v: number | null) => (v == null || v === 0 ? "" : v > 0 ? "text-emerald-300" : "text-red-300");
  const fmt = (v: number | null, places: number, sign = false) => (v == null ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(places)}`);
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-white">Calibration</h3>
      <p className="mt-1 text-sm text-neutral-400">
        The latest call on every completed game. Win% leaves pushes out; CLV is points better than the last line before
        kickoff (spread and total calls with a locked line). Units are at each tier&apos;s full stake; flat is 1u on every
        call, passes included. The house is shown this record with anything under {FEEDBACK_MIN_CALLS} calls marked too few to judge.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Segmented label="Market" value={market} options={MARKET_FILTERS.map((m) => ({ key: m, label: m === "ml" ? "moneyline" : m }))} onChange={setMarket} />
        <Segmented label="Split by" value={by} options={SPLITS} onChange={setBy} />
      </div>
      <table className="mt-2 text-left text-xs text-neutral-300">
        <thead className="text-neutral-500">
          <tr>
            {[SPLITS.find((x) => x.key === by)!.label, "Calls", "W-L-P", "Win%", "CLV n", "Avg CLV", "Units", "Flat"].map((h) => (
              <th key={h} className="pr-4 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {table.map(({ key, tally: t }) => {
            const win = tallyWinPct(t);
            const clv = tallyAvgClv(t);
            return (
              <tr key={key}>
                <td className="pr-4">{key}</td>
                <td className="pr-4">{t.calls}</td>
                <td className="pr-4">{t.wins}-{t.losses}-{t.pushes}</td>
                <td className="pr-4">{win == null ? "—" : `${(win * 100).toFixed(1)}%`}</td>
                <td className="pr-4">{t.clv_calls}</td>
                <td className={`pr-4 ${clvClass(clv)}`}>{fmt(clv, 2, true)}</td>
                <td className="pr-4">{fmt(t.units, 2, true)}</td>
                <td className="pr-4">{fmt(t.units_flat, 2, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-neutral-400">
        Stakes now (a tier earns its full stake at {STAKE_MIN_CALLS}+ spread and total calls winning 55%):{" "}
        {stakes.map((s) => (
          <span key={s.confidence} className="mr-3 tabular-nums">
            {s.confidence} → {s.stake}u{s.stake !== s.full ? <span className="text-neutral-500"> of {s.full}u</span> : null}
          </span>
        ))}
      </p>
    </div>
  );
}

type ExperimentRow = {
  league: string;
  variant: string;
  prompt_versions: string;
  calls: number;
  wins: number;
  losses: number;
  pushes: number;
  win_pct: number | null;
  win_lo: number | null;
  win_hi: number | null;
  plays: number;
  play_wins: number;
  play_losses: number;
  play_win_pct: number | null;
  play_lo: number | null;
  play_hi: number | null;
  clv_calls: number;
  avg_clv: number | null;
  units: number;
};

// The prompt variants side by side (view pickem_house_experiment), on the
// latest call of every completed game made under the experiment. No winner is
// picked here: promote a variant by editing HOUSE_VARIANTS.
function Experiment({ league }: { league: League }) {
  const { supabase } = useAdmin();
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [scope, setScope] = useState<"league" | "all">("league");
  useEffect(() => {
    let live = true;
    supabase
      .from("pickem_house_experiment")
      .select("*")
      .eq("season", PICKEM_SEASON)
      .in("league", [league, "all"])
      .then(({ data }) => {
        if (live) setRows((data ?? []) as ExperimentRow[]);
      });
    return () => {
      live = false;
    };
  }, [supabase, league]);
  if (!rows?.length) return null;
  const want = scope === "all" ? "all" : league;
  const shown = rows.filter((r) => r.league === want);
  // Variants in play first, in map order, then retired ones still on record.
  const order = (v: string) => (HOUSE_VARIANTS.some((x) => x.id === v) ? HOUSE_VARIANTS.findIndex((x) => x.id === v) : HOUSE_VARIANTS.length);
  const cols = [...shown].sort((a, b) => order(a.variant) - order(b.variant) || a.variant.localeCompare(b.variant));
  const n = (v: number | string | null) => (v == null ? null : Number(v));
  const pct = (v: number | string | null) => (n(v) == null ? "—" : `${(n(v)! * 100).toFixed(1)}%`);
  const band = (lo: number | null, hi: number | null) => (lo == null || hi == null ? "—" : `${pct(lo)}–${pct(hi)}`);
  const signed = (v: number | string | null) => (n(v) == null ? "—" : `${n(v)! > 0 ? "+" : ""}${n(v)!.toFixed(2)}`);
  const metrics: { label: string; cell: (r: ExperimentRow) => React.ReactNode }[] = [
    { label: "Prompt", cell: (r) => r.prompt_versions },
    { label: "Spread + total calls", cell: (r) => `${r.calls} (${r.wins}-${r.losses}-${r.pushes})` },
    { label: "Win%", cell: (r) => pct(r.win_pct) },
    { label: "95% interval", cell: (r) => band(r.win_lo, r.win_hi) },
    { label: "Plays (6+)", cell: (r) => `${r.plays} (${r.play_wins}-${r.play_losses})` },
    { label: "Play win%", cell: (r) => pct(r.play_win_pct) },
    { label: "Play 95% interval", cell: (r) => band(r.play_lo, r.play_hi) },
    {
      label: "Avg CLV",
      cell: (r) => <span className={n(r.avg_clv) ? (n(r.avg_clv)! > 0 ? "text-emerald-300" : "text-red-300") : ""}>{signed(r.avg_clv)} on {r.clv_calls}</span>,
    },
    { label: "Units (all markets)", cell: (r) => signed(r.units) },
  ];
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-white">Prompt experiment</h3>
      <p className="mt-1 text-sm text-neutral-400">
        Each week&apos;s games are dealt to the variants in turn. Overlapping intervals mean the record cannot tell
        them apart yet. Promote a variant by editing <code>HOUSE_VARIANTS</code> in lib/pickem-variants.ts.
      </p>
      <div className="mt-2">
        <Segmented label="Scope" value={scope} options={[{ key: "league", label: LEAGUE_META[league].short }, { key: "all", label: "Both leagues" }]} onChange={setScope} />
      </div>
      {cols.length ? (
        <table className="mt-2 text-left text-xs text-neutral-300">
          <thead className="text-neutral-500">
            <tr>
              <th className="pr-4 font-normal" />
              {cols.map((r) => (
                <th key={r.variant} className="pr-6 font-normal">{r.variant}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {metrics.map((m) => (
              <tr key={m.label}>
                <td className="pr-4 text-neutral-500">{m.label}</td>
                {cols.map((r) => (
                  <td key={r.variant} className="pr-6">{m.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">No completed games under the experiment here yet.</p>
      )}
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
        numbers are early ones; college fills in late additions Saturday morning and the NFL on Thursday. Research digests are gathered Friday (college) and Wednesday and Thursday (NFL), and the news pass that follows re-picks only the games with news since their call.
        College line refreshes also store ESPN&apos;s FPI prediction for each upcoming game. Use these to run a job for the selected league now. Refreshing lines spends about 3 of the
        500 monthly Odds API requests (5 when there are finals to grade); a house run is a handful of Claude
        calls, plus 3 Odds API requests for Pinnacle&apos;s line when there are games to pick (at most once every 6 hours). Parlays are rebuilt from the picks on every house run; tailed and locked tickets are never
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
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Research the news for games in the next four days? One Claude call with web search per game not researched in the last 20 hours, plus a Pinnacle fetch (3 Odds API requests).")) {
              run("research", "research");
            }
          }}
          className={btn}
        >
          {busy === "research" ? "Researching…" : "Research news"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Preview research digests? Nothing is stored and Pinnacle is not fetched, but it spends a Claude call per game.")) {
              run("research?dry=1", "researchdry");
            }
          }}
          className={btn}
        >
          {busy === "researchdry" ? "Researching…" : "Preview research (dry run)"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Run the news pass? Re-picks only the games whose research digest is newer than their call and has news since it; the rest keep their calls. One Claude call per batch, plus Pinnacle when the last fetch is older than 6 hours.")) {
              run("house?since=call", "news");
            }
          }}
          className={btn}
        >
          {busy === "news" ? "Picking…" : "Run news pass"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Preview the news pass? Shows which games would be re-picked and their picks. Nothing is written, but it spends a Claude call per batch.")) {
              run("house?since=call&dry=1", "newsdry");
            }
          }}
          className={btn}
        >
          {busy === "newsdry" ? "Previewing…" : "Preview news pass (dry run)"}
        </button>
      </div>
      {log ? <pre className="mt-3 whitespace-pre-wrap break-all text-xs text-neutral-300">{log}</pre> : null}
      <ClosingLineValue league={league} />
      <Calibration league={league} />
      <Experiment league={league} />
    </section>
  );
}
