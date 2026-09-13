"use client";

import { useState } from "react";
import { LEAGUES, LEAGUE_META, type League } from "@/lib/pickem";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass as btn } from "../_shell/ui";

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
      setLog(`${res.ok ? "OK" : `HTTP ${res.status}`} · ${JSON.stringify(body)}`);
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
        NFL. College house picks post Thursday midday and Saturday morning Central; NFL picks post Thursday
        morning. Use these to run a job for the selected league now. Refreshing lines spends about 3 of the
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
        <button type="button" disabled={busy !== null} onClick={() => run("house?only=parlays", "parlays")} className={btn}>
          {busy === "parlays" ? "Rebuilding…" : "Rebuild parlays"}
        </button>
      </div>
      {log ? <pre className="mt-3 whitespace-pre-wrap break-all text-xs text-neutral-300">{log}</pre> : null}
    </section>
  );
}
