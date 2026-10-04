"use client";

// Everything about the signed-in player: magic-link auth, profile, and the
// picks and parlay tails they own. Writes go straight to Supabase from the
// browser; the kickoff lock is enforced by RLS, the client checks are UX.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Market, PickemGame, PickemParlay, PickemPick, Selection, UserParlay, Wager } from "@/lib/pickem";
import { betPayload, importable, type SlipReview } from "@/lib/pickem-slip";

export function pickKey(gameId: string, market: Market) {
  return `${gameId}:${market}`;
}

/** The picked side's own number and the best price we'd lock for it. */
export function sideLine(g: PickemGame, market: Market, sel: Selection): { line: number | null; price: number } {
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

export function usePickemSession() {
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
  const [myParlays, setMyParlays] = useState<UserParlay[]>([]);
  const [wagers, setWagers] = useState<Wager[]>([]);
  // Bumped after a slip import to load what the database now holds.
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState("");

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
        setMyParlays([]);
        setWagers([]);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const userId = session?.user.id ?? null;

  // Load the signed-in user's profile, picks, tails, and imported parlays and stakes.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [{ data: profile }, { data: myPicks }, { data: myTails }, { data: parlays }, { data: myWagers }] = await Promise.all([
        supabase.from("pickem_profiles").select("display_name").eq("user_id", userId).maybeSingle(),
        supabase.from("pickem_picks").select("*").eq("user_id", userId),
        supabase.from("pickem_parlay_tails").select("parlay_id").eq("user_id", userId),
        // Both come back null until the slip-import migration is applied.
        supabase.from("pickem_user_parlays").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("pickem_wagers").select("id, pick_id, user_parlay_id, book, stake, payout").eq("user_id", userId),
      ]);
      if (cancelled) return;
      setDisplayName(profile?.display_name ?? "");
      const m = new Map<string, PickemPick>();
      for (const p of (myPicks ?? []) as PickemPick[]) m.set(pickKey(p.game_id, p.market), p);
      setPicks(m);
      setTails(new Set((myTails ?? []).map((t) => t.parlay_id as number)));
      setMyParlays((parlays ?? []) as UserParlay[]);
      setWagers((myWagers ?? []) as Wager[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, reloads]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Keep the view the player was on when the link brings them back.
      options: { emailRedirectTo: window.location.origin + "/pickem" + window.location.search },
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

  const signOut = useCallback(() => {
    supabase.auth.signOut();
  }, [supabase]);

  const canPick = Boolean(userId && displayName);

  const togglePick = useCallback(
    async (g: PickemGame, market: Market, sel: Selection) => {
      if (!userId || !canPick) return;
      if (new Date(g.commence_time).getTime() <= Date.now()) return;
      const key = pickKey(g.id, market);
      const current = picks.get(key);
      setError("");
      // Put back whatever was there before the optimistic update.
      const rollback = () =>
        setPicks((prev) => {
          const n = new Map(prev);
          if (current) n.set(key, current);
          else n.delete(key);
          return n;
        });
      if (current && current.selection === sel) {
        setPicks((prev) => {
          const n = new Map(prev);
          n.delete(key);
          return n;
        });
        const { error } = await supabase.from("pickem_picks").delete().eq("user_id", userId).eq("game_id", g.id).eq("market", market);
        if (error) {
          setError(error.message);
          rollback();
        }
        return;
      }
      const { line, price } = sideLine(g, market, sel);
      const row: PickemPick = { user_id: userId, game_id: g.id, market, selection: sel, line, price };
      setPicks((prev) => new Map(prev).set(key, row));
      const { error } = await supabase
        .from("pickem_picks")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,game_id,market" });
      if (error) {
        setError(error.message.includes("policy") ? "That game has kicked off, so picks are locked." : error.message);
        rollback();
      }
    },
    [supabase, userId, canPick, picks]
  );

  const toggleTail = useCallback(
    async (p: PickemParlay) => {
      if (!userId || !canPick) return;
      if (new Date(p.locks_at).getTime() <= Date.now()) return;
      setError("");
      const had = tails.has(p.id);
      const flip = (on: boolean) =>
        setTails((prev) => {
          const n = new Set(prev);
          if (on) n.add(p.id);
          else n.delete(p.id);
          return n;
        });
      flip(!had);
      const { error } = had
        ? await supabase.from("pickem_parlay_tails").delete().eq("user_id", userId).eq("parlay_id", p.id)
        : await supabase.from("pickem_parlay_tails").insert({ user_id: userId, parlay_id: p.id });
      if (error) {
        setError(error.message);
        flip(had);
      }
    },
    [supabase, userId, canPick, tails]
  );

  /** Save a reviewed slip, one bet per call so a bad bet does not sink the rest. Returns what could not be saved. */
  const importSlip = useCallback(
    async (review: SlipReview): Promise<string[]> => {
      if (!userId || !canPick) return ["Sign in to import a bet slip."];
      const problems: string[] = [];
      for (const bet of review.bets.filter(importable)) {
        const { data, error } = await supabase.rpc("pickem_import_bet", { p_bet: betPayload(bet, review.book) });
        if (error) {
          problems.push(error.message);
          continue;
        }
        const saved = data as { legs: { status: string; reason: string | null }[]; parlay: string };
        if (saved.legs.some((l) => l.reason === "started")) problems.push("A game kicked off before the slip was saved, so that leg is locked.");
        else if (saved.legs.some((l) => l.status !== "saved")) problems.push("One leg could not be saved.");
        if (saved.parlay === "duplicate") problems.push("That parlay was already imported.");
      }
      setReloads((n) => n + 1);
      return problems;
    },
    [supabase, userId, canPick]
  );

  const removeParlay = useCallback(
    async (id: number) => {
      setError("");
      const { error } = await supabase.from("pickem_user_parlays").delete().eq("id", id);
      if (error) setError(error.message);
      else setMyParlays((prev) => prev.filter((p) => p.id !== id));
    },
    [supabase]
  );

  return {
    session,
    authReady,
    email,
    setEmail,
    linkSent,
    authError,
    displayName,
    nameDraft,
    setNameDraft,
    picks,
    tails,
    myParlays,
    wagers,
    error,
    userId,
    canPick,
    sendMagicLink,
    saveProfile,
    signOut,
    togglePick,
    toggleTail,
    importSlip,
    removeParlay,
  };
}

export type PickemSession = ReturnType<typeof usePickemSession>;
