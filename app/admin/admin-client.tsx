"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LETTERS, SELLER_INFO, artistLetter } from "@/lib/records";
import {
  ADMIN_EMAIL,
  getBrowserSupabase,
  type DbRecord,
  type PendingPriceChange,
  type PriceRun,
} from "@/lib/supabase";

// Reddit markdown pipes inside a cell break the table — escape them.
function cell(s: string | undefined) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function redditMarkdown(records: DbRecord[]) {
  const list = records
    .filter((r) => r.listed && !r.sold)
    .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title));
  const rows = list.map((r) => {
    const title = r.photos
      ? `[${cell(r.title)}](${r.photos.trim()})`
      : cell(r.title);
    return `| ${cell(r.artist)} | ${title} | ${cell(r.pressing)} | ${cell(r.media)} | ${cell(r.sleeve)} | $${r.price} | ${cell(r.notes)} |`;
  });
  return [
    `**${SELLER_INFO.pageTitle}** — full list with photos: https://lateonsetaudiophile.com/records`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    "| Artist | Title | Pressing | Media | Sleeve | Price | Notes |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    SELLER_INFO.contact,
  ].join("\n");
}

const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];

type NewRecordDraft = {
  discogs_release_id: number;
  artist: string;
  title: string;
  pressing: string;
  media: string;
  sleeve: string;
  price: string;
  cover_image: string;
  genres: string; // comma-separated in the form; stored as text[]
  collection: string;
};

// Known curated series, matched against Discogs label/series/company names
// and format descriptions. Order matters: first match wins, so the more
// specific series (e.g. UHQR) come before their parent label.
const COLLECTION_PATTERNS: [RegExp, string][] = [
  [/vinyl me,? please/i, "VMP"],
  [/interscope vinyl collective/i, "IVC"],
  [/uhqr|ultra high quality record/i, "UHQR"],
  [/rhino high fidelity|rhino hi-?fi/i, "RHF"],
  [/atlantic 75/i, "Atlantic 75"],
  [/definitive sound/i, "Definitive Sound"],
  [/tone poet/i, "Tone Poet"],
  [/mobile fidelity|mofi/i, "MoFi"],
  [/acoustic sounds/i, "Acoustic Sounds"],
  [/analogue productions/i, "Analogue Productions"],
];

function detectCollection(rel: {
  labels?: { name?: string }[];
  series?: { name?: string }[];
  companies?: { name?: string }[];
  formats?: { descriptions?: string[]; text?: string }[];
}): string {
  const haystack = [
    ...[...(rel.labels ?? []), ...(rel.series ?? []), ...(rel.companies ?? [])].map(
      (x) => x.name ?? ""
    ),
    ...(rel.formats ?? []).flatMap((f) => [
      ...(f.descriptions ?? []),
      f.text ?? "",
    ]),
  ];
  for (const [re, tag] of COLLECTION_PATTERNS) {
    if (haystack.some((n) => re.test(n))) return tag;
  }
  return "";
}

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
  const [password, setPassword] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState("");

  const [records, setRecords] = useState<DbRecord[]>([]);
  const [pending, setPending] = useState<PendingPriceChange[]>([]);
  const [runs, setRuns] = useState<PriceRun[]>([]);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [buyerEdits, setBuyerEdits] = useState<Record<number, string>>({});
  const [trackingEdits, setTrackingEdits] = useState<Record<number, string>>({});
  const [soldPriceEdits, setSoldPriceEdits] = useState<Record<number, string>>({});
  const [genreRowEdits, setGenreRowEdits] = useState<Record<number, string>>({});
  const [collectionRowEdits, setCollectionRowEdits] = useState<Record<number, string>>({});
  const [notesEdits, setNotesEdits] = useState<Record<number, string>>({});
  const [genreFilter, setGenreFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [discogsStatus, setDiscogsStatus] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [postUrlStatus, setPostUrlStatus] = useState<"idle" | "saved">("idle");
  const [confirmCopiedId, setConfirmCopiedId] = useState<number | null>(null);
  const [tableCopied, setTableCopied] = useState(false);

  async function copyRedditTable() {
    const md = redditMarkdown(records);
    try {
      await navigator.clipboard.writeText(md);
      setTableCopied(true);
      setTimeout(() => setTableCopied(false), 1600);
    } catch {
      window.prompt("Copy the table below:", md);
    }
  }

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
    const [recordsRes, pendingRes, runsRes, settingsRes] = await Promise.all([
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
      supabase
        .from("settings")
        .select("value")
        .eq("key", "reddit_post_url")
        .single(),
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
    setPostUrl(settingsRes.data?.value ?? "");
  }, [supabase]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  async function sendMagicLink() {
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + "/admin" },
    });
    if (error) setAuthError(error.message);
    else setLinkSent(true);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (!password) {
      setAuthError("Enter your password, or use the magic-link button.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error)
      setAuthError(
        error.message === "Invalid login credentials"
          ? "Invalid login — if you haven't set a password yet, sign in with a magic link once and set one in the Account section."
          : error.message
      );
  }

  async function savePassword() {
    setPwStatus("");
    if (newPassword.length < 8) {
      setPwStatus("Password must be at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwStatus(
      error
        ? error.message
        : "Password saved — next time you can sign in with it directly."
    );
    if (!error) setNewPassword("");
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
    if (await updateRecord(r.id, { price: value, prev_price: r.price })) {
      setPriceEdits((prev) => {
        const next = { ...prev };
        delete next[r.id];
        return next;
      });
    }
  }

  async function savePostUrl() {
    const { error } = await supabase
      .from("settings")
      .update({ value: postUrl.trim() })
      .eq("key", "reddit_post_url");
    if (error) {
      setLoadError(error.message);
      return;
    }
    setPostUrlStatus("saved");
    setTimeout(() => setPostUrlStatus("idle"), 2000);
  }

  async function saveBuyer(r: DbRecord) {
    const value = (buyerEdits[r.id] ?? "").trim().replace(/^u\//, "");
    if (value === (r.buyer_username ?? "")) return;
    await updateRecord(r.id, { buyer_username: value });
  }

  async function saveTracking(r: DbRecord) {
    const value = (trackingEdits[r.id] ?? "").trim();
    if (value === (r.tracking_number ?? "")) return;
    await updateRecord(r.id, { tracking_number: value });
  }

  async function saveSoldPrice(r: DbRecord) {
    const raw = (soldPriceEdits[r.id] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    if (value === (r.sold_price ?? null)) return;
    await updateRecord(r.id, { sold_price: value });
  }

  async function saveGenres(r: DbRecord) {
    const raw = genreRowEdits[r.id];
    if (raw === undefined) return;
    const value = raw
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    if (value.join(", ") === (r.genres ?? []).join(", ")) return;
    await updateRecord(r.id, { genres: value });
  }

  async function saveCollection(r: DbRecord) {
    const raw = collectionRowEdits[r.id];
    if (raw === undefined) return;
    const value = raw.trim() || null;
    if (value === (r.collection ?? null)) return;
    await updateRecord(r.id, { collection: value });
  }

  async function saveNotes(r: DbRecord) {
    const raw = notesEdits[r.id];
    if (raw === undefined) return;
    const value = raw.trim();
    if (value === (r.notes ?? "")) return;
    await updateRecord(r.id, { notes: value });
  }

  async function removeFromDiscogs(r: DbRecord) {
    if (!r.discogs_release_id) return;
    setDiscogsStatus((prev) => ({ ...prev, [r.id]: "Removing…" }));
    try {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/discogs-remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current?.access_token ?? ""}`,
        },
        body: JSON.stringify({ releaseId: r.discogs_release_id }),
      });
      const body = await res.json();
      setDiscogsStatus((prev) => ({
        ...prev,
        [r.id]: res.ok ? "Removed from Discogs ✓" : body.error || "Failed",
      }));
    } catch {
      setDiscogsStatus((prev) => ({ ...prev, [r.id]: "Request failed" }));
    }
  }

  async function markSold(r: DbRecord, sold: boolean) {
    const ok = await updateRecord(r.id, { sold });
    if (!ok || !sold || !r.discogs_release_id) return;
    if (
      window.confirm(
        `Also remove "${r.artist} — ${r.title}" from your Discogs collection?`
      )
    ) {
      await removeFromDiscogs(r);
    }
  }

  async function copyConfirmation(r: DbRecord) {
    const buyer = (r.buyer_username ?? "").trim();
    const text = `Confirming my sale of ${r.artist} — ${r.title} to u/${buyer}. Thanks!`;
    try {
      await navigator.clipboard.writeText(text);
      setConfirmCopiedId(r.id);
      setTimeout(() => setConfirmCopiedId(null), 2000);
    } catch {
      window.prompt("Copy this confirmation comment:", text);
    }
  }

  const [pendingFilter, setPendingFilter] = useState<"all" | "act" | "other">(
    "all"
  );
  const [bulkPendingBusy, setBulkPendingBusy] = useState(false);

  // copies-for-sale per record, from the most recent run summaries — used
  // to split pending cuts the same way the email report does.
  const forSaleById = useMemo(() => {
    const m = new Map<number, number>();
    for (const run of runs) {
      for (const s of run.summary ?? []) {
        if (s.for_sale != null && !m.has(s.record_id)) {
          m.set(s.record_id, s.for_sale);
        }
      }
    }
    return m;
  }, [runs]);

  // Same heuristic as the email: a cut worth acting on is modest (≤30%)
  // with several copies competing; everything else is likely condition
  // noise, a scarce copy, or a suggestion-based increase.
  const isActionable = useCallback(
    (p: PendingPriceChange) =>
      p.pct_change < 0 &&
      Math.abs(p.pct_change) <= 0.3 &&
      (forSaleById.get(p.record_id) ?? 0) >= 3,
    [forSaleById]
  );

  const visiblePending = useMemo(
    () =>
      pending.filter((p) =>
        pendingFilter === "all"
          ? true
          : pendingFilter === "act"
            ? isActionable(p)
            : !isActionable(p)
      ),
    [pending, pendingFilter, isActionable]
  );

  async function bulkResolvePending(
    list: PendingPriceChange[],
    approve: boolean
  ) {
    if (list.length === 0 || bulkPendingBusy) return;
    const ok = window.confirm(
      `${approve ? "Approve" : "Reject"} ${list.length} pending price change${
        list.length > 1 ? "s" : ""
      }?${approve ? " This updates the listed prices immediately." : ""}`
    );
    if (!ok) return;
    setBulkPendingBusy(true);
    try {
      if (approve) {
        const chunk = 10;
        for (let i = 0; i < list.length; i += chunk) {
          const results = await Promise.all(
            list.slice(i, i + chunk).map((p) =>
              supabase
                .from("records")
                .update({
                  price: p.suggested_price,
                  prev_price: p.old_price,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", p.record_id)
            )
          );
          const failed = results.find((r) => r.error);
          if (failed?.error) throw new Error(failed.error.message);
        }
      }
      const ids = list.map((p) => p.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase
          .from("pending_price_changes")
          .update({
            status: approve ? "approved" : "rejected",
            resolved_at: new Date().toISOString(),
          })
          .in("id", ids.slice(i, i + 200));
        if (error) throw new Error(error.message);
      }
      const idSet = new Set(ids);
      setPending((prev) => prev.filter((x) => !idSet.has(x.id)));
      if (approve) {
        const byRecord = new Map(list.map((p) => [p.record_id, p]));
        setRecords((prev) =>
          prev.map((r) => {
            const p = byRecord.get(r.id);
            return p
              ? { ...r, price: p.suggested_price, prev_price: p.old_price }
              : r;
          })
        );
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Bulk update failed");
    }
    setBulkPendingBusy(false);
  }

  async function resolvePending(p: PendingPriceChange, approve: boolean) {
    if (approve) {
      const ok = await updateRecord(p.record_id, {
        price: p.suggested_price,
        prev_price: p.old_price,
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
    return records.filter((r) => {
      if (genreFilter !== "all" && !(r.genres ?? []).includes(genreFilter))
        return false;
      if (collectionFilter === "none" && r.collection) return false;
      if (
        collectionFilter !== "all" &&
        collectionFilter !== "none" &&
        r.collection !== collectionFilter
      )
        return false;
      if (letterFilter && artistLetter(r.artist) !== letterFilter) return false;
      if (!q) return true;
      return `${r.artist} ${r.title} ${r.pressing} ${(r.genres ?? []).join(" ")} ${r.collection ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [records, search, genreFilter, collectionFilter, letterFilter]);

  const activeLetters = useMemo(
    () => new Set(records.map((r) => artistLetter(r.artist))),
    [records]
  );

  const allGenres = useMemo(
    () =>
      [...new Set(records.flatMap((r) => r.genres ?? []))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [records]
  );
  const allCollections = useMemo(
    () =>
      [...new Set(records.map((r) => r.collection).filter(Boolean))].sort() as string[],
    [records]
  );

  // Live collection value — recomputed from local state, so it updates the
  // moment a price is edited, a change is approved, or a record is sold.
  const stats = useMemo(() => {
    const forSale = records.filter((r) => r.listed && !r.sold);
    const sold = records.filter((r) => r.sold);
    const hidden = records.filter((r) => !r.listed && !r.sold);
    const sum = (list: DbRecord[], pick: (r: DbRecord) => number) =>
      list.reduce((total, r) => total + pick(r), 0);
    return {
      forSaleCount: forSale.length,
      askingTotal: sum(forSale, (r) => Number(r.price)),
      soldCount: sold.length,
      soldTotal: sum(sold, (r) => Number(r.sold_price ?? r.price)),
      hiddenCount: hidden.length,
      hiddenTotal: sum(hidden, (r) => Number(r.price)),
    };
  }, [records]);

  const [bulkSaving, setBulkSaving] = useState(false);

  // --- Add record ---
  const [newRelInput, setNewRelInput] = useState("");
  const [fetchingRelease, setFetchingRelease] = useState(false);
  const [draft, setDraft] = useState<NewRecordDraft | null>(null);
  const [addError, setAddError] = useState("");
  const [addingRecord, setAddingRecord] = useState(false);

  async function fetchReleaseDetails() {
    setAddError("");
    // accept a bare ID or a pasted Discogs URL
    const match = newRelInput.match(/release\/(\d+)/) ?? newRelInput.match(/(\d+)/);
    if (!match) {
      setAddError("Paste a Discogs release URL or ID.");
      return;
    }
    const releaseId = Number(match[1]);
    setFetchingRelease(true);
    try {
      const res = await fetch(`https://api.discogs.com/releases/${releaseId}`);
      if (!res.ok) throw new Error(`Discogs returned ${res.status}`);
      const rel = await res.json();
      const label = rel.labels?.[0];
      const descriptions = (rel.formats ?? [])
        .flatMap((f: { descriptions?: string[] }) => f.descriptions ?? [])
        .join(", ");
      const pressing = [
        rel.year ? String(rel.year) : null,
        [label?.name, label?.catno].filter(Boolean).join(" ") || null,
        descriptions || null,
      ]
        .filter(Boolean)
        .join(" · ");
      const primary =
        rel.images?.find((im: { type: string }) => im.type === "primary") ??
        rel.images?.[0];
      setDraft({
        discogs_release_id: releaseId,
        artist: rel.artists?.map((a: { name: string }) => a.name).join(", ") ?? "",
        title: rel.title ?? "",
        pressing,
        media: "NM",
        sleeve: "NM",
        price: "0",
        cover_image: primary?.uri ?? rel.thumb ?? "",
        genres: (rel.genres ?? []).join(", "),
        collection: detectCollection(rel),
      });
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to fetch release");
    } finally {
      setFetchingRelease(false);
    }
  }

  async function addRecord() {
    if (!draft) return;
    const price = Number(draft.price);
    if (!draft.artist.trim() || !draft.title.trim() || !Number.isFinite(price) || price < 0) {
      setAddError("Artist, title, and a valid price (0 is fine) are required.");
      return;
    }
    setAddingRecord(true);
    const { data, error } = await supabase
      .from("records")
      .insert({
        artist: draft.artist.trim(),
        title: draft.title.trim(),
        pressing: draft.pressing.trim(),
        media: draft.media,
        sleeve: draft.sleeve,
        price,
        cover_image: draft.cover_image,
        discogs_release_id: draft.discogs_release_id,
        genres: draft.genres
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
        collection: draft.collection.trim() || null,
      })
      .select()
      .single();
    setAddingRecord(false);
    if (error) {
      setAddError(error.message);
      return;
    }
    setRecords((prev) =>
      [...prev, data as DbRecord].sort((a, b) =>
        (a.artist + a.title).localeCompare(b.artist + b.title)
      )
    );
    setDraft(null);
    setNewRelInput("");
  }

  // Toggle listed/sold for every record currently shown by the search filter.
  async function toggleAllFiltered(field: "listed" | "sold", value: boolean) {
    const ids = filteredRecords.map((r) => r.id);
    if (ids.length === 0) return;
    setBulkSaving(true);
    const { error } = await supabase
      .from("records")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .in("id", ids);
    setBulkSaving(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const idSet = new Set(ids);
    setRecords((prev) =>
      prev.map((r) => (idSet.has(r.id) ? { ...r, [field]: value } : r))
    );
  }

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
            Sign in with your password, or request a magic link.
          </p>
          {linkSent ? (
            <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-300">
              Check your inbox — a sign-in link is on its way. You can close
              this tab.
            </p>
          ) : (
            <form
              onSubmit={signInWithPassword}
              className="mt-6 flex flex-col gap-3"
            >
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputClass}
              />
              <button type="submit" className={buttonClass}>
                Sign in
              </button>
              <button
                type="button"
                onClick={sendMagicLink}
                className="text-sm text-neutral-500 transition hover:text-white"
              >
                Email me a magic link instead
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

        {/* Collection value summary */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-neutral-400">For sale</p>
            <p className="mt-1 text-2xl font-semibold">
              ${stats.askingTotal.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {stats.forSaleCount} records at asking price
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-neutral-400">Sold</p>
            <p className="mt-1 text-2xl font-semibold text-green-400">
              ${stats.soldTotal.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {stats.soldCount} records · uses final sold price when entered
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-neutral-400">Hidden</p>
            <p className="mt-1 text-2xl font-semibold text-neutral-300">
              ${stats.hiddenTotal.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {stats.hiddenCount} records not shown on the site
            </p>
          </div>
        </div>

        {/* Reddit tools */}
        <h2 className="mt-10 text-xl font-medium">Reddit tools</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Copies a ready-to-paste markdown table of every shown, unsold record
          for a new sale post.
        </p>
        <button
          type="button"
          onClick={copyRedditTable}
          className={`mt-3 ${buttonClass}`}
        >
          {tableCopied ? "Copied!" : "Copy Reddit table"}
        </button>

        <h3 className="mt-8 text-lg font-medium">Active Reddit post</h3>
        <p className="mt-1 text-sm text-neutral-400">
          Paste the URL of your current sale post. Buyers then get a
          &ldquo;Comment on the post&rdquo; button that copies a &ldquo;Sent
          you a DM&rdquo; comment and opens the post.
        </p>
        <div className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.reddit.com/r/VinylCollectors/comments/…"
            className={`flex-1 ${inputClass}`}
          />
          <button type="button" onClick={savePostUrl} className={buttonClass}>
            {postUrlStatus === "saved" ? "Saved!" : "Save"}
          </button>
        </div>

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
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", `All (${pending.length})`],
                  [
                    "act",
                    `Worth acting on (${pending.filter(isActionable).length})`,
                  ],
                  [
                    "other",
                    `Noise / scarce / raises (${pending.filter((p) => !isActionable(p)).length})`,
                  ],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPendingFilter(key)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    pendingFilter === key
                      ? "border-white bg-white text-black"
                      : "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="mx-2 text-neutral-700">|</span>
              <button
                type="button"
                disabled={bulkPendingBusy || visiblePending.length === 0}
                onClick={() => bulkResolvePending(visiblePending, true)}
                className={`rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300`}
              >
                {bulkPendingBusy
                  ? "Working…"
                  : `Approve all shown (${visiblePending.length})`}
              </button>
              <button
                type="button"
                disabled={bulkPendingBusy || visiblePending.length === 0}
                onClick={() => bulkResolvePending(visiblePending, false)}
                className={`rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-300`}
              >
                {bulkPendingBusy
                  ? "Working…"
                  : `Reject all shown (${visiblePending.length})`}
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {visiblePending.map((p) => (
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
                      {forSaleById.has(p.record_id) ? (
                        <span className="text-neutral-500">
                          {" "}
                          · {forSaleById.get(p.record_id)} for sale
                        </span>
                      ) : null}
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
          </>
        )}

        {/* Add record */}
        <h2 className="mt-12 text-xl font-medium">Add a record</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Paste a Discogs release URL or ID and Fetch fills in the details and
          cover art. Leave the price at 0 and tonight&apos;s run will set it to
          85% of the Discogs suggested price for its grade.
        </p>
        <div className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newRelInput}
            onChange={(e) => setNewRelInput(e.target.value)}
            placeholder="https://www.discogs.com/release/16426854-…  or  16426854"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="button"
            onClick={fetchReleaseDetails}
            disabled={fetchingRelease}
            className={buttonClass}
          >
            {fetchingRelease ? "Fetching…" : "Fetch"}
          </button>
        </div>
        {addError ? (
          <p className="mt-2 text-sm text-red-400">{addError}</p>
        ) : null}
        {draft ? (
          <div className="mt-4 flex max-w-2xl flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex gap-4">
              {draft.cover_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.cover_image}
                  alt="Cover"
                  className="h-24 w-24 rounded-lg object-cover"
                />
              ) : null}
              <div className="flex flex-1 flex-col gap-2">
                <input
                  type="text"
                  value={draft.artist}
                  onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
                  placeholder="Artist"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Title"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={draft.pressing}
                  onChange={(e) =>
                    setDraft({ ...draft, pressing: e.target.value })
                  }
                  placeholder="Pressing"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.genres}
                    onChange={(e) =>
                      setDraft({ ...draft, genres: e.target.value })
                    }
                    placeholder="Genres (comma-separated)"
                    className={`flex-1 ${inputClass}`}
                  />
                  <input
                    type="text"
                    value={draft.collection}
                    onChange={(e) =>
                      setDraft({ ...draft, collection: e.target.value })
                    }
                    placeholder="Collection (VMP…)"
                    className={`w-36 ${inputClass}`}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                Media
                <select
                  value={draft.media}
                  onChange={(e) => setDraft({ ...draft, media: e.target.value })}
                  className={`${inputClass} [&>option]:bg-neutral-900`}
                >
                  {GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                Sleeve
                <select
                  value={draft.sleeve}
                  onChange={(e) =>
                    setDraft({ ...draft, sleeve: e.target.value })
                  }
                  className={`${inputClass} [&>option]:bg-neutral-900`}
                >
                  {GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                $
                <input
                  type="number"
                  min="0"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  className={`w-24 ${inputClass}`}
                />
              </label>
              <button
                type="button"
                onClick={addRecord}
                disabled={addingRecord}
                className={buttonClass}
              >
                {addingRecord ? "Adding…" : "Add record"}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-sm text-neutral-500 transition hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* Records editor */}
        <h2 className="mt-12 text-xl font-medium">Listings</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Shown controls whether a record appears on /records at all; Sold
          keeps it visible with a SOLD badge.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artist, title, label, genre…"
            className={`w-full max-w-md ${inputClass}`}
          />
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Genre: All</option>
            {allGenres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Collection: All</option>
            {allCollections.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="none">No collection</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setLetterFilter(null)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
              letterFilter === null
                ? "border-white bg-white text-black"
                : "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
            }`}
          >
            All
          </button>
          {LETTERS.map((l) => {
            const hasRecords = activeLetters.has(l);
            return (
              <button
                key={l}
                type="button"
                disabled={!hasRecords}
                onClick={() => setLetterFilter(letterFilter === l ? null : l)}
                className={`w-8 rounded-lg border px-0 py-1.5 text-center text-xs transition ${
                  letterFilter === l
                    ? "border-white bg-white text-black"
                    : hasRecords
                      ? "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
                      : "cursor-default border-white/5 text-neutral-700"
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          {filteredRecords.length} of {records.length} records
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-400">
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 text-center font-medium">
                  <div className="flex flex-col items-center gap-1">
                    Shown
                    <input
                      type="checkbox"
                      title="Select/deselect Shown for all records in the current search"
                      checked={
                        filteredRecords.length > 0 &&
                        filteredRecords.every((r) => r.listed)
                      }
                      disabled={bulkSaving}
                      onChange={(e) =>
                        toggleAllFiltered("listed", e.target.checked)
                      }
                      className="admin-checkbox"
                    />
                  </div>
                </th>
                <th className="px-3 py-3 text-center font-medium">
                  <div className="flex flex-col items-center gap-1">
                    Sold
                    <input
                      type="checkbox"
                      title="Select/deselect Sold for all records in the current search"
                      checked={
                        filteredRecords.length > 0 &&
                        filteredRecords.every((r) => r.sold)
                      }
                      disabled={bulkSaving}
                      onChange={(e) =>
                        toggleAllFiltered("sold", e.target.checked)
                      }
                      className="admin-checkbox"
                    />
                  </div>
                </th>
                <th className="px-3 py-3 font-medium">Sale details</th>
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={genreRowEdits[r.id] ?? (r.genres ?? []).join(", ")}
                          onChange={(e) =>
                            setGenreRowEdits((prev) => ({
                              ...prev,
                              [r.id]: e.target.value,
                            }))
                          }
                          onBlur={() => saveGenres(r)}
                          placeholder="Genres"
                          title="Comma-separated genres — saves when you click away"
                          className={`w-44 ${inputClass}`}
                        />
                        <input
                          type="text"
                          value={collectionRowEdits[r.id] ?? (r.collection ?? "")}
                          onChange={(e) =>
                            setCollectionRowEdits((prev) => ({
                              ...prev,
                              [r.id]: e.target.value,
                            }))
                          }
                          onBlur={() => saveCollection(r)}
                          placeholder="Collection"
                          title="Collection tag like VMP or IVC — saves when you click away"
                          className={`w-28 ${inputClass}`}
                        />
                        <label className="flex items-center gap-1 text-xs text-neutral-500">
                          Media
                          <select
                            value={r.media}
                            disabled={savingId === r.id}
                            onChange={(e) =>
                              updateRecord(r.id, { media: e.target.value })
                            }
                            className={`${inputClass} [&>option]:bg-neutral-900`}
                          >
                            {GRADES.map((g) => (
                              <option key={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-xs text-neutral-500">
                          Sleeve
                          <select
                            value={r.sleeve}
                            disabled={savingId === r.id}
                            onChange={(e) =>
                              updateRecord(r.id, { sleeve: e.target.value })
                            }
                            className={`${inputClass} [&>option]:bg-neutral-900`}
                          >
                            {GRADES.map((g) => (
                              <option key={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={notesEdits[r.id] ?? (r.notes ?? "")}
                        onChange={(e) =>
                          setNotesEdits((prev) => ({
                            ...prev,
                            [r.id]: e.target.value,
                          }))
                        }
                        onBlur={() => saveNotes(r)}
                        placeholder="Notes shown to buyers (e.g. “Signed by Maynard — cover has a bent corner”)"
                        title="Shown on the public record card and in the Reddit table — saves when you click away"
                        rows={1}
                        className={`mt-2 w-full max-w-md resize-y ${inputClass}`}
                      />
                      <p className="mt-1 flex gap-3 text-xs">
                        {r.discogs_release_id ? (
                          <a
                            href={`https://www.discogs.com/release/${r.discogs_release_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                          >
                            Discogs
                          </a>
                        ) : null}
                        <a
                          href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${r.artist} ${r.title} vinyl`)}&LH_Sold=1&LH_Complete=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          eBay solds
                        </a>
                        <a
                          href={`https://www.popsike.com/php/quicksearch.php?searchtext=${encodeURIComponent(`${r.artist} ${r.title}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          Popsike
                        </a>
                      </p>
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
                      <label
                        className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500"
                        title="Manual price: the daily Discogs run won't reprice, undercut, or flag this record"
                      >
                        <input
                          type="checkbox"
                          checked={!!r.manual_price}
                          disabled={savingId === r.id}
                          onChange={(e) =>
                            updateRecord(r.id, {
                              manual_price: e.target.checked,
                            })
                          }
                          className="admin-checkbox"
                        />
                        manual
                      </label>
                      {r.prev_price != null &&
                      Number(r.prev_price) > 0 &&
                      Number(r.prev_price) !== r.price ? (
                        <p
                          className={`mt-1 text-xs ${
                            r.price > Number(r.prev_price)
                              ? "text-green-400"
                              : "text-red-400"
                          }`}
                          title={`Was $${r.prev_price} before the last change`}
                        >
                          {pct(
                            (r.price - Number(r.prev_price)) /
                              Number(r.prev_price)
                          )}{" "}
                          vs last
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.listed}
                        disabled={savingId === r.id}
                        onChange={(e) =>
                          updateRecord(r.id, { listed: e.target.checked })
                        }
                        className="admin-checkbox"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.sold}
                        disabled={savingId === r.id}
                        onChange={(e) => markSold(r, e.target.checked)}
                        className="admin-checkbox"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {r.sold ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-neutral-500">u/</span>
                            <input
                              type="text"
                              value={buyerEdits[r.id] ?? r.buyer_username ?? ""}
                              onChange={(e) =>
                                setBuyerEdits((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                              onBlur={() => saveBuyer(r)}
                              placeholder="buyer"
                              className={`w-28 ${inputClass}`}
                            />
                            {(r.buyer_username ?? "").trim() ? (
                              <button
                                type="button"
                                onClick={() => copyConfirmation(r)}
                                title="Copy a confirmation-thread comment for this sale"
                                className={`whitespace-nowrap ${buttonClass}`}
                              >
                                {confirmCopiedId === r.id
                                  ? "Copied!"
                                  : "Copy confirm"}
                              </button>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className="text-neutral-500"
                              title="Final sold price"
                            >
                              $
                            </span>
                            <input
                              type="number"
                              min="0"
                              value={
                                soldPriceEdits[r.id] ??
                                (r.sold_price != null ? String(r.sold_price) : "")
                              }
                              onChange={(e) =>
                                setSoldPriceEdits((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                              onBlur={() => saveSoldPrice(r)}
                              placeholder="sold for"
                              className={`w-24 ${inputClass}`}
                            />
                            <input
                              type="text"
                              value={
                                trackingEdits[r.id] ?? r.tracking_number ?? ""
                              }
                              onChange={(e) =>
                                setTrackingEdits((prev) => ({
                                  ...prev,
                                  [r.id]: e.target.value,
                                }))
                              }
                              onBlur={() => saveTracking(r)}
                              placeholder="tracking #"
                              className={`w-40 ${inputClass}`}
                            />
                          </div>
                          {r.discogs_release_id ? (
                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => removeFromDiscogs(r)}
                                className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                Remove from Discogs collection
                              </button>
                              {discogsStatus[r.id] ? (
                                <span
                                  className={
                                    discogsStatus[r.id].includes("✓")
                                      ? "text-green-400"
                                      : "text-yellow-400"
                                  }
                                >
                                  {discogsStatus[r.id]}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
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
                    {run.undercuts ? ` · ${run.undercuts} auto-undercut` : ""}
                    {run.above_lowest
                      ? ` · ${run.above_lowest} above lowest listing`
                      : ""}
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
                          {s.action === "above-lowest" ? (
                            <>
                              {s.artist} — {s.title}: yours ${s.old_price},
                              suggested ${s.new_price}
                              {s.lowest ? <> (lowest listing ${s.lowest})</> : null}{" "}
                              <span className="text-yellow-400">
                                ({pct(s.pct)})
                              </span>{" "}
                              <span className="text-neutral-500">
                                above cheapest Discogs listing
                                {s.for_sale != null
                                  ? ` · ${s.for_sale} for sale`
                                  : ""}{" "}
                                — approve the cut under Pending price changes
                              </span>
                            </>
                          ) : s.action === "undercut" ? (
                            <>
                              {s.artist} — {s.title}: ${s.old_price} → $
                              {s.new_price}{" "}
                              <span className="text-red-400">
                                ({pct(s.pct)})
                              </span>{" "}
                              <span className="text-neutral-500">
                                auto-undercut cheapest listing
                                {s.for_sale != null
                                  ? ` · ${s.for_sale} for sale`
                                  : ""}
                              </span>
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Account */}
        <h2 className="mt-12 text-xl font-medium">Account</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Set a password to sign in directly — magic-link emails are
          rate-limited by Supabase.
        </p>
        <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            className={`flex-1 ${inputClass}`}
          />
          <button type="button" onClick={savePassword} className={buttonClass}>
            Save password
          </button>
        </div>
        {pwStatus ? (
          <p
            className={`mt-2 text-sm ${
              pwStatus.startsWith("Password saved")
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {pwStatus}
          </p>
        ) : null}
      </section>
    </main>
  );
}
