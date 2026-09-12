"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  fmtPrice,
  fmtSpread,
  gradePick,
  shortTeam,
  winUnits,
  type LeaderboardRow,
  type Market,
  type PickemGame,
  type PickemParlay,
  type PickemPick,
  type PickResult,
  type Selection,
} from "@/lib/pickem";

type Props = {
  week: number;
  games: PickemGame[];
  parlays: PickemParlay[];
  leaderboard: LeaderboardRow[];
};

const ET = "America/New_York";

function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pickKey(gameId: string, market: Market) {
  return `${gameId}:${market}`;
}

/** The picked side's own number and the best price we'd lock for it. */
function sideLine(g: PickemGame, market: Market, sel: Selection): { line: number | null; price: number } {
  if (market === "ml") {
    return { line: null, price: (sel === "home" ? g.ml_home : g.ml_away) ?? -110 };
  }
  if (market === "total") {
    const b = sel === "over" ? g.best.over : g.best.under;
    return { line: g.total, price: b?.price ?? -110 };
  }
  const b = sel === "home" ? g.best.spread_home : g.best.spread_away;
  const line = sel === "home" ? g.spread_home : g.spread_home == null ? null : -g.spread_home;
  return { line, price: b?.price ?? -110 };
}

function ResultBadge({ result }: { result: PickResult }) {
  if (!result) return null;
  const cls =
    result === "win"
      ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
      : result === "loss"
        ? "bg-red-500/20 text-red-200 border-red-400/30"
        : "bg-neutral-500/20 text-neutral-200 border-neutral-400/30";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${cls}`}>
      {result}
    </span>
  );
}

function Movement({ open, now, kind }: { open: number | null; now: number | null; kind: "spread" | "total" | "ml" }) {
  if (open == null || now == null || open === now) {
    return <span className="text-xs text-neutral-500">no move</span>;
  }
  const f = kind === "ml" ? fmtPrice : kind === "spread" ? fmtSpread : (v: number) => `${v}`;
  return (
    <span className="text-xs text-neutral-400">
      opened <span className="text-neutral-200">{f(open)}</span> → now{" "}
      <span className="text-orange-200">{f(now)}</span>
    </span>
  );
}

export default function PickemClient({ week, games, parlays, leaderboard }: Props) {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [picks, setPicks] = useState<Map<string, PickemPick>>(new Map());
  const [tails, setTails] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        // Signed out: drop everything that belonged to the previous user.
        setDisplayName(null);
        setPicks(new Map());
        setTails(new Set());
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const userId = session?.user.id ?? null;

  // Load the signed-in user's profile, picks and tails.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [{ data: profile }, { data: myPicks }, { data: myTails }] = await Promise.all([
        supabase.from("pickem_profiles").select("display_name").eq("user_id", userId).maybeSingle(),
        supabase.from("pickem_picks").select("*").eq("user_id", userId),
        supabase.from("pickem_parlay_tails").select("parlay_id").eq("user_id", userId),
      ]);
      if (cancelled) return;
      setDisplayName(profile?.display_name ?? "");
      const m = new Map<string, PickemPick>();
      for (const p of (myPicks ?? []) as PickemPick[]) m.set(pickKey(p.game_id, p.market), p);
      setPicks(m);
      setTails(new Set((myTails ?? []).map((t) => t.parlay_id as number)));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + "/pickem" },
    });
    if (error) setAuthError(error.message);
    else setLinkSent(true);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const name = nameDraft.trim();
    if (name.length < 2) return setError("Pick a name with at least 2 characters.");
    const { error } = await supabase
      .from("pickem_profiles")
      .upsert({ user_id: userId, display_name: name }, { onConflict: "user_id" });
    if (error) setError(error.message);
    else {
      setDisplayName(name);
      setError("");
    }
  }

  const canPick = Boolean(userId && displayName);

  async function togglePick(g: PickemGame, market: Market, sel: Selection) {
    if (!userId || !canPick) return;
    if (new Date(g.commence_time).getTime() <= now) return;
    const key = pickKey(g.id, market);
    const current = picks.get(key);
    setError("");
    if (current && current.selection === sel) {
      const next = new Map(picks);
      next.delete(key);
      setPicks(next);
      const { error } = await supabase.from("pickem_picks").delete().eq("user_id", userId).eq("game_id", g.id).eq("market", market);
      if (error) {
        setError(error.message);
        setPicks(picks);
      }
      return;
    }
    const { line, price } = sideLine(g, market, sel);
    const row: PickemPick = { user_id: userId, game_id: g.id, market, selection: sel, line, price };
    const next = new Map(picks);
    next.set(key, row);
    setPicks(next);
    const { error } = await supabase
      .from("pickem_picks")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,game_id,market" });
    if (error) {
      setError(error.message.includes("policy") ? "That game has kicked off, so picks are locked." : error.message);
      setPicks(picks);
    }
  }

  async function toggleTail(p: PickemParlay) {
    if (!userId || !canPick) return;
    if (new Date(p.locks_at).getTime() <= now) return;
    setError("");
    const next = new Set(tails);
    if (tails.has(p.id)) {
      next.delete(p.id);
      setTails(next);
      const { error } = await supabase.from("pickem_parlay_tails").delete().eq("user_id", userId).eq("parlay_id", p.id);
      if (error) {
        setError(error.message);
        setTails(tails);
      }
    } else {
      next.add(p.id);
      setTails(next);
      const { error } = await supabase.from("pickem_parlay_tails").insert({ user_id: userId, parlay_id: p.id });
      if (error) {
        setError(error.message);
        setTails(tails);
      }
    }
  }

  // Season totals and this-week totals per player.
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

  const myPickCount = [...picks.values()].filter((p) => games.some((g) => g.id === p.game_id)).length;
  const pending = games.filter((g) => new Date(g.commence_time).getTime() > now).length;

  return (
    <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 md:py-20">
      <header className="mb-10 max-w-3xl">
        <p className="text-sm uppercase tracking-[0.3em] text-orange-300">College football · Week {week}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">Pick&apos;em</h1>
        <p className="mt-5 text-lg leading-8 text-neutral-300">
          Forty games a week with live lines from nine sportsbooks, the movement since the number opened,
          and house picks with a confidence score on every spread, total, and moneyline. Pick as many as you
          like. Every pick risks one unit at the price you locked; the leaderboard tracks net units. No money
          changes hands.
        </p>
      </header>

      {/* Sign-in / profile */}
      <div className="mb-10 rounded-[1.75rem] border border-white/10 bg-white/5 p-6 md:p-8">
        {!authReady ? (
          <p className="text-neutral-400">Checking sign-in…</p>
        ) : !session ? (
          linkSent ? (
            <p className="text-neutral-200">
              Check <span className="font-semibold text-white">{email}</span> for a sign-in link. It brings you
              straight back here.
            </p>
          ) : (
            <form onSubmit={sendMagicLink} className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex-1">
                <span className="text-sm uppercase tracking-[0.2em] text-neutral-500">Sign in to make picks</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-xl border border-white/15 bg-neutral-900 px-4 py-3 text-white outline-none placeholder:text-neutral-500 focus:border-orange-400/60"
                />
              </label>
              <button
                type="submit"
                className="rounded-xl bg-orange-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-orange-400"
              >
                Email me a link
              </button>
              {authError ? <p className="text-sm text-red-300">{authError}</p> : null}
            </form>
          )
        ) : displayName === "" ? (
          <form onSubmit={saveProfile} className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1">
              <span className="text-sm uppercase tracking-[0.2em] text-neutral-500">Choose a display name</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={24}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="What the leaderboard shows"
                className="mt-2 w-full rounded-xl border border-white/15 bg-neutral-900 px-4 py-3 text-white outline-none placeholder:text-neutral-500 focus:border-orange-400/60"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-orange-500 px-5 py-3 font-semibold text-neutral-950 transition hover:bg-orange-400"
            >
              Save name
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-neutral-200">
              Picking as <span className="font-semibold text-white">{displayName ?? "…"}</span>
              <span className="text-neutral-400">
                {" "}· {myPickCount} pick{myPickCount === 1 ? "" : "s"} this week · {pending} game{pending === 1 ? "" : "s"} still open
              </span>
            </p>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </div>

      {/* Slate */}
      {games.length === 0 ? (
        <p className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8 text-neutral-300">
          This week&apos;s lines haven&apos;t been pulled yet. Check back after Tuesday morning.
        </p>
      ) : (
        <div className="grid gap-4">
          {games.map((g) => {
            const locked = new Date(g.commence_time).getTime() <= now;
            const home = shortTeam(g.home_team);
            const away = shortTeam(g.away_team);
            const rows: { market: Market; label: string; a: Selection; b: Selection; aText: string; bText: string; aPrice: string; bPrice: string; aBook?: string; bBook?: string; move: React.ReactNode }[] = [
              {
                market: "spread",
                label: "Spread",
                a: "away",
                b: "home",
                aText: `${away} ${fmtSpread(g.spread_home == null ? null : -g.spread_home)}`,
                bText: `${home} ${fmtSpread(g.spread_home)}`,
                aPrice: fmtPrice(g.best.spread_away?.price),
                bPrice: fmtPrice(g.best.spread_home?.price),
                aBook: g.best.spread_away?.book,
                bBook: g.best.spread_home?.book,
                move: <Movement open={g.open_spread_home} now={g.spread_home} kind="spread" />,
              },
              {
                market: "total",
                label: "Total",
                a: "over",
                b: "under",
                aText: `Over ${g.total ?? "—"}`,
                bText: `Under ${g.total ?? "—"}`,
                aPrice: fmtPrice(g.best.over?.price),
                bPrice: fmtPrice(g.best.under?.price),
                aBook: g.best.over?.book,
                bBook: g.best.under?.book,
                move: <Movement open={g.open_total} now={g.total} kind="total" />,
              },
              {
                market: "ml",
                label: "Moneyline",
                a: "away",
                b: "home",
                aText: `${away} ML`,
                bText: `${home} ML`,
                aPrice: fmtPrice(g.ml_away),
                bPrice: fmtPrice(g.ml_home),
                aBook: g.best.ml_away ? `${fmtPrice(g.best.ml_away.price)} ${g.best.ml_away.book}` : undefined,
                bBook: g.best.ml_home ? `${fmtPrice(g.best.ml_home.price)} ${g.best.ml_home.book}` : undefined,
                move: <Movement open={g.open_ml_home} now={g.ml_home} kind="ml" />,
              },
            ];
            return (
              <article key={g.id} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 md:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-semibold text-white md:text-2xl">
                    {away} <span className="text-neutral-500">@</span> {home}
                  </h2>
                  <p className="text-sm text-neutral-400">
                    {g.completed ? (
                      <span className="text-neutral-200">
                        Final · {away} {g.away_score}, {home} {g.home_score}
                      </span>
                    ) : locked ? (
                      <span className="text-orange-200">In progress · picks locked</span>
                    ) : (
                      <>{kickoffLabel(g.commence_time)} ET</>
                    )}
                  </p>
                </div>

                <div className="mt-4 grid gap-3">
                  {rows.map((r) => {
                    const mine = picks.get(pickKey(g.id, r.market));
                    const house = g.house?.[r.market];
                    const whyKey = `${g.id}:${r.market}`;
                    const result = mine ? gradePick(r.market, mine.selection, mine.line, g.home_score, g.away_score) : null;
                    const btn = (sel: Selection, text: string, price: string, book?: string) => {
                      const on = mine?.selection === sel;
                      const houseOn = house?.pick === sel;
                      return (
                        <button
                          type="button"
                          disabled={!canPick || locked}
                          onClick={() => togglePick(g, r.market, sel)}
                          className={`flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left transition disabled:cursor-default ${
                            on
                              ? "border-orange-400 bg-orange-500/20 text-white"
                              : "border-white/15 bg-neutral-900/60 text-neutral-200 enabled:hover:border-white/40"
                          }`}
                        >
                          <span className="font-medium">{text}</span>
                          <span className="text-right text-xs text-neutral-400">
                            <span className="block text-sm text-neutral-200">{price}</span>
                            {book ? <span className="block">{book}</span> : null}
                            {houseOn ? (
                              <span className="mt-0.5 block text-orange-300">house {house?.confidence}/10</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    };
                    return (
                      <div key={r.market} className="grid gap-2 md:grid-cols-[6rem_1fr] md:items-start">
                        <div className="flex items-center gap-2 pt-2 text-sm uppercase tracking-[0.2em] text-neutral-500">
                          {r.label}
                          <ResultBadge result={result} />
                        </div>
                        <div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            {btn(r.a, r.aText, r.aPrice, r.aBook)}
                            {btn(r.b, r.bText, r.bPrice, r.bBook)}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                            {r.move}
                            {house ? (
                              <button
                                type="button"
                                onClick={() => setOpenWhy(openWhy === whyKey ? null : whyKey)}
                                className="text-xs text-orange-300 underline-offset-4 hover:underline"
                              >
                                {openWhy === whyKey ? "hide" : "why the house likes"}{" "}
                                {r.market === "total"
                                  ? house.pick === "over" ? "the over" : "the under"
                                  : house.pick === "home" ? home : away}
                              </button>
                            ) : null}
                          </div>
                          {house && openWhy === whyKey ? (
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">{house.why}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Parlays */}
      <div className="mt-16">
        <p className="text-sm uppercase tracking-[0.3em] text-orange-300">House parlays</p>
        <h2 className="mt-3 text-2xl font-semibold md:text-3xl">Tail one if you dare</h2>
        <p className="mt-3 max-w-2xl text-neutral-300">
          Parlays are the riskiest way to play, which is why they pay. Tailing one risks one unit at the combined
          price. A push on any leg pushes the whole ticket.
        </p>
        {parlays.length === 0 ? (
          <p className="mt-6 text-neutral-400">House parlays post Thursday morning once the lines settle.</p>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {parlays.map((p) => {
              const locked = new Date(p.locks_at).getTime() <= now;
              const on = tails.has(p.id);
              return (
                <div key={p.id} className="flex flex-col rounded-[1.5rem] border border-orange-400/20 bg-orange-500/10 p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                    <span className="text-lg font-semibold text-orange-200">{fmtPrice(p.american_odds)}</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-neutral-100">
                    {p.legs.map((l, i) => {
                      const g = games.find((x) => x.id === l.game_id);
                      const res = g ? gradePick(l.market, l.selection, l.line, g.home_score, g.away_score) : null;
                      return (
                        <li key={i} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                          <span>{l.label}</span>
                          <span className="flex items-center gap-2 text-neutral-300">
                            {fmtPrice(l.price)} <ResultBadge result={res} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-sm leading-6 text-neutral-300">{p.note}</p>
                  <p className="mt-2 text-xs text-neutral-400">
                    House confidence {p.confidence ?? "—"}/10 · 1 unit returns {(1 + winUnits(p.american_odds)).toFixed(2)}
                  </p>
                  <button
                    type="button"
                    disabled={!canPick || locked}
                    onClick={() => toggleTail(p)}
                    className={`mt-4 rounded-xl border px-4 py-2.5 font-semibold transition disabled:cursor-default disabled:opacity-60 ${
                      on ? "border-orange-400 bg-orange-500 text-neutral-950" : "border-white/20 text-white enabled:hover:bg-white/10"
                    }`}
                  >
                    {locked ? "Locked" : on ? "Tailing ✓" : "Tail this parlay"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">Leaderboard</p>
          <h2 className="mt-3 text-2xl font-semibold md:text-3xl">Net units, season to date</h2>
          {standings.length === 0 ? (
            <p className="mt-6 text-neutral-400">Nobody has a graded pick yet. Standings appear after the first final.</p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-white/10 bg-white/5">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="text-left text-xs uppercase tracking-[0.2em] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Record</th>
                    <th className="px-4 py-3">Week {week}</th>
                    <th className="px-4 py-3 text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.id} className={`border-t border-white/10 ${s.id === userId ? "bg-orange-500/10" : ""}`}>
                      <td className="px-4 py-3 text-neutral-400">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-white">{s.name}</td>
                      <td className="px-4 py-3 text-neutral-300">
                        {s.w}-{s.l}{s.p ? `-${s.p}` : ""}
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        {s.weekRecord ? `${s.weekRecord} · ${s.weekUnits >= 0 ? "+" : ""}${s.weekUnits.toFixed(2)}` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${s.units >= 0 ? "text-emerald-200" : "text-red-200"}`}>
                        {s.units >= 0 ? "+" : ""}
                        {s.units.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">How it works</p>
          <ul className="mt-5 space-y-3 text-neutral-200">
            <li>• Lines are the median across nine US books, refreshed three times a day. The button shows the best available number and which book has it.</li>
            <li>• Your pick locks the line and price at that moment. Kickoff freezes it; nothing changes after that.</li>
            <li>• Every pick risks 1 unit. A win at -110 returns 0.91, a +200 dog returns 2.00, a loss costs 1, a push is 0.</li>
            <li>• Everyone&apos;s picks become visible once a game kicks off.</li>
            <li>• House picks come from an AI handicapper that reads the lines, the movement, and the week&apos;s news. Fade or follow.</li>
            <li>• The slate is the forty most interesting games of the week: closest Power Four matchups first, and Arkansas always.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
