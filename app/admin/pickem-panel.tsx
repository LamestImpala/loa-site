"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// Two buttons that run the pick'em jobs on demand with the admin's session
// token (the cron runs the same routes with CRON_SECRET).
export function PickemPanel({ supabase }: { supabase: SupabaseClient }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState("");

  async function run(path: string, label: string) {
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

  const btn =
    "rounded-lg border border-white/20 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-50";

  return (
    <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-white">Pick&apos;em</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Lines refresh on a schedule (3× daily) and house picks post Thursday and Saturday mornings. Use these
        to run either job now. Refreshing lines spends 4 of the 500 monthly Odds API requests.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null} onClick={() => run("/api/pickem/sync", "sync")} className={btn}>
          {busy === "sync" ? "Refreshing…" : "Refresh lines & scores"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => run("/api/pickem/house", "house")} className={btn}>
          {busy === "house" ? "Picking…" : "Generate missing house picks"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Re-pick every upcoming game and replace this week's house parlays?")) {
              run("/api/pickem/house?force=1", "force");
            }
          }}
          className={btn}
        >
          {busy === "force" ? "Picking…" : "Re-pick whole week"}
        </button>
      </div>
      {log ? <pre className="mt-3 whitespace-pre-wrap break-all text-xs text-neutral-300">{log}</pre> : null}
    </section>
  );
}
