"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  getBrowserSupabase,
  type DbRecord,
  type PendingPriceChange,
  type PriceRun,
} from "@/lib/supabase";

const inputClass =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none";
const buttonClass =
  "rounded-lg border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white";

function pct(n: number) {
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

export default function AdminClient() {
  const supabase = getBrowserSupabase();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [authError, setAuthError] = useState("");

  const [records, setRecords] = useState<DbRecord[]>([]);
  const [pending, setPending] = useState<PendingPriceChange[]>([]);
  const [runs, setRuns] = useState<PriceRun[]>([]);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isAdmin = session?.user?.email === ADMIN_EMAIL;

  const loadData = useCallback(async () => {
    setLoadError("");
    const [recordsRes, pendingRes, runsRes] = await Promise.all([
      supabase.from("records").select("*").order("artist").order("title"),
      supabase
        .from("pending_price_changes")
        .select("*, records(artist, title, pressing, price)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("price_runs")
        .select("*")
        .order("ran_at", { ascending: false })
        .limit(14),
    ]);
    if (recordsRes.error || pendingRes.error || runsRes.error) {
      setLoadError(
        recordsRes.error?.message ||
          pendingRes.error?.message ||
          runsRes.error?.message ||
          "Failed to load"
      );
      return;
    }
    setRecords((recordsRes.data ?? []) as DbRecord[]);
    setPending((pendingRes.data ?? []) as PendingPriceChange[]);
    setRuns((runsRes.data ?? []) as PriceRun[]);
  }, [supabase]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + "/admin" },
    });
    if (error) setAuthError(error.message);
    else setLinkSent(true);
  }

  async function updateRecord(id: number, patch: Partial<DbRecord>) {
    setSavingId(id);
    const { error } = await supabase
      .from("records")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      setLoadError(error.message);
      return false;
    }
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    return true;
  }

  async function savePrice(r: DbRecord) {
    const raw = priceEdits[r.id];
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) return;
    if (await updateRecord(r.id, { price: value })) {
      setPriceEdits((prev) => {
        const next = { ...prev };
        delete next[r.id];
        return next;
      });
    }
  }

  async function resolvePending(p: PendingPriceChange, approve: boolean) {
    if (approve) {
      const ok = await updateRecord(p.record_id, {
        price: p.suggested_price,
      });
      if (!ok) return;
    }
    const { error } = await supabase
      .from("pending_price_changes")
      .update({
        status: approve ? "approved" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setPending((prev) => prev.filter((x) => x.id !== p.id));
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      `${r.artist} ${r.title} ${r.pressing}`.toLowerCase().includes(q)
    );
  }, [records, search]);

  if (!authReady) {
    return (
      <main className="min-h-screen bg-black p-8 text-neutral-400">
        Loading…
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-black text-white">
        <section className="mx-auto max-w-md px-4 py-24">
          <h1 className="text-3xl font-semibold">Admin</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Enter your email and we&apos;ll send you a sign-in link.
          </p>
          {linkSent ? (
            <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-300">
              Check your inbox — a sign-in link is on its way. You can close
              this tab.
            </p>
          ) : (
            <form onSubmit={sendMagicLink} className="mt-6 flex flex-col gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
              <button type="submit" className={buttonClass}>
                Send magic link
              </button>
              {authError ? (
                <p className="text-sm text-red-400">{authError}</p>
              ) : null}
            </form>
          )}
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-black text-white">
        <section className="mx-auto max-w-md px-4 py-24">
          <h1 className="text-3xl font-semibold">Not authorized</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Signed in as {session.user.email}, which doesn&apos;t have access
            to this page.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className={`mt-6 ${buttonClass}`}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Records Admin</h1>
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span>{session.user.email}</span>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className={buttonClass}
            >
              Sign out
            </button>
          </div>
        </div>

        {loadError ? (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {loadError}
          </p>
        ) : null}

        {/* Pending price approvals */}
        <h2 className="mt-10 text-xl font-medium">
          Pending price changes{" "}
          <span className="text-sm text-neutral-400">
            (moves over ±5% from the daily Discogs run)
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Nothing waiting for approval.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div>
                  <p className="font-medium">
                    {p.records?.artist} — {p.records?.title}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">
                    ${p.old_price} → ${p.suggested_price}{" "}
                    <span
                      className={
                        p.pct_change > 0 ? "text-green-400" : "text-red-400"
                      }
                    >
                      ({pct(p.pct_change)})
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolvePending(p, true)}
                    className={buttonClass}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => resolvePending(p, false)}
                    className={buttonClass}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Records editor */}
        <h2 className="mt-12 text-xl font-medium">Listings</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Shown controls whether a record appears on /records at all; Sold
          keeps it visible with a SOLD badge.
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search artist, title, label…"
          className={`mt-4 w-full max-w-md ${inputClass}`}
        />
        <p className="mt-2 text-sm text-neutral-500">
          {filteredRecords.length} of {records.length} records
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-400">
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 text-center font-medium">Shown</th>
                <th className="px-3 py-3 text-center font-medium">Sold</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((r) => {
                const edited =
                  priceEdits[r.id] !== undefined &&
                  priceEdits[r.id] !== String(r.price);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">
                        {r.artist} — {r.title}
                      </p>
                      <p className="text-xs text-neutral-500">{r.pressing}</p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-500">$</span>
                        <input
                          type="number"
                          min="0"
                          value={priceEdits[r.id] ?? String(r.price)}
                          onChange={(e) =>
                            setPriceEdits((prev) => ({
                              ...prev,
                              [r.id]: e.target.value,
                            }))
                          }
                          className={`w-20 ${inputClass}`}
                        />
                        {edited ? (
                          <button
                            type="button"
                            disabled={savingId === r.id}
                            onClick={() => savePrice(r)}
                            className={buttonClass}
                          >
                            {savingId === r.id ? "…" : "Save"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.listed}
                        disabled={savingId === r.id}
                        onChange={(e) =>
                          updateRecord(r.id, { listed: e.target.checked })
                        }
                        className="h-4 w-4 accent-white"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.sold}
                        disabled={savingId === r.id}
                        onChange={(e) =>
                          updateRecord(r.id, { sold: e.target.checked })
                        }
                        className="h-4 w-4 accent-white"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Price run reports */}
        <h2 className="mt-12 text-xl font-medium">Daily price runs</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">No runs yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedRun(expandedRun === run.id ? null : run.id)
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="font-medium">
                    {new Date(run.ran_at).toLocaleString()}
                  </span>
                  <span className="text-sm text-neutral-400">
                    {run.checked} checked · {run.auto_applied} auto-applied ·{" "}
                    {run.flagged} flagged
                    {run.errors ? ` · ${run.errors} errors` : ""}
                  </span>
                </button>
                {expandedRun === run.id ? (
                  run.summary.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-400">
                      No price movement.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-1 text-sm text-neutral-300">
                      {run.summary.map((s, i) => (
                        <li key={i}>
                          {s.artist} — {s.title}: ${s.old_price} → $
                          {s.new_price}{" "}
                          <span
                            className={
                              s.pct > 0 ? "text-green-400" : "text-red-400"
                            }
                          >
                            ({pct(s.pct)})
                          </span>{" "}
                          <span className="text-neutral-500">
                            {s.action === "applied"
                              ? "auto-applied"
                              : "flagged for approval"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
