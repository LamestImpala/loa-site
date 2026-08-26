"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  LETTERS,
  RECORDS_PER_PARCEL,
  SELLER_INFO,
  artistLetter,
  bundleBreakdown,
  makeRefCode,
} from "@/lib/records";
import {
  ADMIN_EMAIL,
  getBrowserSupabase,
  type DbRecord,
  type Invoice,
  type OrderRequest,
  type PendingPriceChange,
  type PriceRun,
  type RecordInterest,
  type Shipment,
} from "@/lib/supabase";
import { FulfillmentPanel } from "./fulfillment-panel";
import {
  extractRefCode,
  matchLines,
  parseOrderText,
  recordFlags,
  type LineMatch,
} from "@/lib/order-parse";

// Reddit markdown pipes inside a cell break the table — escape them.
function cell(s: string | undefined) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

// Reddit posts should funnel buyers to the site, where every record has a
// "Request to buy" button that pre-fills the DM; SELLER_INFO.contact stays
// as-is for the site's own hero card.
const SHOP_URL = "https://curiouserrecords.com";
const REDDIT_HOW_TO_BUY = `**How to buy:** browse the full list with live prices at ${SHOP_URL} — every record has a "Request to buy" button that pre-fills a DM to me. Or just PM me here; I'm happy to complete everything through Reddit messages. First come, first served.`;

// The first line of each copied post is a ready-made [For Sale] title —
// paste it into Reddit's title field, then delete it from the body.
function topCollections(list: DbRecord[], n: number) {
  const counts = new Map<string, number>();
  for (const r of list)
    if (r.collection)
      counts.set(r.collection, (counts.get(r.collection) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
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
  const series = topCollections(list, 3);
  const title = `[For Sale] ${list.length} vinyl records — collection sale, audiophile pressings${series.length ? ` (${series.join(", ")})` : ""} — PayPal G&S`;
  return [
    title,
    "",
    `**${SELLER_INFO.pageTitle}** — browse everything at ${SHOP_URL}`,
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    "| Artist | Title | Pressing | Media | Sleeve | Price | Notes |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// Weekly post is built from the hand-picked records ("Sel" column), not the
// whole catalog, and never shows an old price — steep markdowns read as
// suspicious to buyers.
const weeklyRow = (r: DbRecord) =>
  `| ${cell(r.artist)} | ${cell(r.title)} | ${cell(r.pressing)} | ${cell(r.media)}/${cell(r.sleeve)} | $${r.price} |`;

const REDDIT_TABLE_HEADER = [
  "| Artist | Title | Pressing | Grade (M/S) | Price |",
  "|---|---|---|---|---|",
];

function redditWeeklyMarkdown(selected: DbRecord[], liveCount: number) {
  const list = [...selected].sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  const title = `[For Sale] Weekly update — ${list.length} picks from a ${liveCount}-record collection sale — PayPal G&S`;
  return [
    title,
    "",
    `**Weekly update** — browse everything at ${SHOP_URL}`,
    "",
    ...REDDIT_TABLE_HEADER,
    ...list.map(weeklyRow),
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// Body-only refresh of the live weekly post (Reddit titles can't be edited,
// so there's no title line — paste this over the existing post body). Sold
// records stay visible as struck-through rows with the price hidden.
function redditUpdateMarkdown(posted: DbRecord[]) {
  const list = [...posted].sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  const openCount = list.filter((r) => !r.sold).length;
  const row = (r: DbRecord) =>
    r.sold
      ? `| ~~${cell(r.artist)}~~ | ~~${cell(r.title)}~~ | ${cell(r.pressing)} | ${cell(r.media)}/${cell(r.sleeve)} | **SOLD** |`
      : weeklyRow(r);
  return [
    `**Weekly update** — ${openCount} of ${list.length} still available — browse everything at ${SHOP_URL}`,
    "",
    ...REDDIT_TABLE_HEADER,
    ...list.map(row),
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];

// Collapsible page sections — keys double as the localStorage payload, so
// renaming one silently resets its saved state.
const SECTIONS = [
  "reddit",
  "requests",
  "fulfillment",
  "pending",
  "add",
  "listings",
  "runs",
  "account",
] as const;
type SectionKey = (typeof SECTIONS)[number];
const COLLAPSED_SECTIONS_KEY = "admin-collapsed-sections";

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

const holdActive = (r: DbRecord) =>
  !!r.hold_until && new Date(r.hold_until).getTime() > Date.now();

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Transient feedback shown in a fixed stack near the bottom-right corner, so
// results of an action are visible no matter how far down the page it fired.
type Toast = {
  id: number;
  kind: "error" | "success" | "info";
  text: string;
  action?: { label: string; onClick: () => void };
};
let toastSeq = 0;

// Commit a blur-save field with the keyboard.
function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}

type SortKey = "artist" | "price-desc" | "price-asc" | "interest" | "added";

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
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pending, setPending] = useState<PendingPriceChange[]>([]);
  const [runs, setRuns] = useState<PriceRun[]>([]);
  const [orderRequests, setOrderRequests] = useState<OrderRequest[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [clipboardFallback, setClipboardFallback] = useState<null | {
    title: string;
    text: string;
  }>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("artist");
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [buyerEdits, setBuyerEdits] = useState<Record<number, string>>({});
  const [soldPriceEdits, setSoldPriceEdits] = useState<Record<number, string>>({});
  const [genreRowEdits, setGenreRowEdits] = useState<Record<number, string>>({});
  const [collectionRowEdits, setCollectionRowEdits] = useState<Record<number, string>>({});
  const [notesEdits, setNotesEdits] = useState<Record<number, string>>({});
  const [genreFilter, setGenreFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [interest, setInterest] = useState<Record<number, RecordInterest>>({});
  const [interestFilter, setInterestFilter] = useState<
    "all" | "clicked-no-request"
  >("all");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [shownFilter, setShownFilter] = useState<"all" | "shown" | "hidden">(
    "all"
  );
  const [discogsStatus, setDiscogsStatus] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [postUrlStatus, setPostUrlStatus] = useState<"idle" | "saved">("idle");
  // Record ids included in the live weekly post, saved when the post is
  // copied so "update post" can regenerate the exact posted list later.
  const [postedInfo, setPostedInfo] = useState<{
    ids: number[];
    posted_at: string | null;
  }>({ ids: [], posted_at: null });
  const [confirmCopiedId, setConfirmCopiedId] = useState<number | null>(null);
  const [tableCopied, setTableCopied] = useState(false);

  const [collapsedSections, setCollapsedSections] = useState<Set<SectionKey>>(
    () => {
      if (typeof window === "undefined") return new Set();
      try {
        const saved = JSON.parse(
          window.localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? "[]"
        );
        return new Set(
          (Array.isArray(saved) ? saved : []).filter(
            (k): k is SectionKey => (SECTIONS as readonly string[]).includes(k)
          )
        );
      } catch {
        return new Set();
      }
    }
  );

  const setCollapsed = useCallback((next: Set<SectionKey>) => {
    setCollapsedSections(next);
    try {
      window.localStorage.setItem(
        COLLAPSED_SECTIONS_KEY,
        JSON.stringify([...next])
      );
    } catch {
      // localStorage may be unavailable (private mode) — collapsing still works
    }
  }, []);

  const toggleSection = useCallback(
    (key: SectionKey) => {
      const next = new Set(collapsedSections);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setCollapsed(next);
    },
    [collapsedSections, setCollapsed]
  );

  const allCollapsed = SECTIONS.every((k) => collapsedSections.has(k));

  // Expand a section if needed, then scroll its heading under the jump nav.
  const jumpToSection = useCallback(
    (key: SectionKey) => {
      if (collapsedSections.has(key)) {
        const next = new Set(collapsedSections);
        next.delete(key);
        setCollapsed(next);
      }
      setTimeout(() => {
        document
          .getElementById(`section-${key}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    },
    [collapsedSections, setCollapsed]
  );

  const pushToast = useCallback(
    (kind: Toast["kind"], text: string, action?: Toast["action"]) => {
      const id = ++toastSeq;
      setToasts((prev) => [
        // Only one success toast at a time — rapid blur-saves shouldn't stack
        ...(kind === "success" ? prev.filter((t) => t.kind !== "success") : prev),
        { id, kind, text, action },
      ]);
      const ttl = kind === "success" ? 2500 : kind === "info" ? 8000 : 10000;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Clipboard writes fall back to a copyable modal (window.prompt truncates
  // multi-KB markdown). Returns whether the silent copy worked.
  const copyText = useCallback(
    async (text: string, fallbackTitle: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        setClipboardFallback({ title: fallbackTitle, text });
        return false;
      }
    },
    []
  );

  function sectionHeading(
    key: SectionKey,
    title: ReactNode,
    className: string
  ) {
    const open = !collapsedSections.has(key);
    return (
      <h2 id={`section-${key}`} className={`scroll-mt-16 ${className}`}>
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left transition hover:text-neutral-300"
        >
          <span
            aria-hidden
            className={`text-sm text-neutral-500 transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          {title}
        </button>
      </h2>
    );
  }

  async function copyRedditTable() {
    const md = redditMarkdown(records);
    if (await copyText(md, "Copy the Reddit table")) {
      setTableCopied(true);
      setTimeout(() => setTableCopied(false), 1600);
    }
  }

  const [weeklyCopied, setWeeklyCopied] = useState(false);
  async function copyWeeklyPost() {
    const picks = records.filter((r) => selectedIds.has(r.id) && !r.sold);
    if (picks.length === 0) return;
    const liveCount = records.filter((r) => r.listed && !r.sold).length;
    const md = redditWeeklyMarkdown(picks, liveCount);
    // Copy before the settings round-trip — Safari drops the clipboard
    // permission if the user gesture has to wait on a network call.
    if (await copyText(md, "Copy the weekly post")) {
      setWeeklyCopied(true);
      setTimeout(() => setWeeklyCopied(false), 1600);
    }
    await savePostedIds(picks.map((r) => r.id));
  }

  async function savePostedIds(ids: number[]) {
    const posted_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("settings")
      .update({ value: JSON.stringify({ ids, posted_at }) })
      .eq("key", "reddit_post_records")
      .select("key");
    if (error || !data?.length) {
      pushToast(
        "error",
        error?.message ??
          "Couldn't save the posted record list — the reddit_post_records settings row is missing."
      );
      return;
    }
    setPostedInfo({ ids, posted_at });
  }

  const [updateCopied, setUpdateCopied] = useState(false);
  async function copyUpdatePost() {
    // Records deleted since the post went up just drop out of the list.
    const lookup = new Map(records.map((r) => [r.id, r]));
    const posted = postedInfo.ids
      .map((id) => lookup.get(id))
      .filter((r): r is DbRecord => Boolean(r));
    if (posted.length === 0) return;
    const md = redditUpdateMarkdown(posted);
    if (await copyText(md, "Copy the post update")) {
      setUpdateCopied(true);
      setTimeout(() => setUpdateCopied(false), 1600);
    }
  }

  const [uploadingId, setUploadingId] = useState<number | null>(null);

  async function uploadPhotos(r: DbRecord, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingId(r.id);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const path = `${r.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]+/g, "_")}`;
        const { error } = await supabase.storage
          .from("record-photos")
          .upload(path, file);
        if (error) throw new Error(error.message);
        const { data } = supabase.storage
          .from("record-photos")
          .getPublicUrl(path);
        urls.push(data.publicUrl);
      }
      await updateRecord(r.id, {
        photo_urls: [...(r.photo_urls ?? []), ...urls],
      });
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Photo upload failed");
    }
    setUploadingId(null);
  }

  async function removePhoto(r: DbRecord, url: string) {
    if (
      !window.confirm(
        `Delete this photo of "${r.artist} — ${r.title}" permanently? It can't be undone.`
      )
    )
      return;
    const path = url.split("/record-photos/")[1];
    if (path) {
      await supabase.storage
        .from("record-photos")
        .remove([decodeURIComponent(path)]);
    }
    await updateRecord(r.id, {
      photo_urls: (r.photo_urls ?? []).filter((u) => u !== url),
    });
  }

  // For copies that were never actually sold (given away, no longer owned).
  // Real sales should stay as history — un-check "sold" instead.
  async function deleteRecord(r: DbRecord) {
    setSavingId(r.id);
    const { data: parcels, error: parcelErr } = await supabase
      .from("shipments")
      .select("id")
      .contains("record_ids", [r.id]);
    setSavingId(null);
    if (parcelErr) {
      pushToast("error", `Couldn't check parcels: ${parcelErr.message}`);
      return;
    }
    if ((parcels ?? []).length > 0) {
      pushToast(
        "error",
        `"${r.artist} — ${r.title}" is in a parcel — remove it in Fulfillment first.`
      );
      return;
    }
    if (
      !window.confirm(
        `Delete "${r.artist} — ${r.title}" permanently? Its photos and price history go with it. Meant for records that were never actually sold — this can't be undone.`
      )
    )
      return;
    setSavingId(r.id);
    const paths = (r.photo_urls ?? [])
      .map((url) => url.split("/record-photos/")[1])
      .filter((p): p is string => !!p)
      .map((p) => decodeURIComponent(p));
    if (paths.length > 0) {
      await supabase.storage.from("record-photos").remove(paths);
    }
    const { error } = await supabase.from("records").delete().eq("id", r.id);
    setSavingId(null);
    if (error) {
      pushToast("error", `Delete failed: ${error.message}`);
      return;
    }
    setRecords((prev) => prev.filter((x) => x.id !== r.id));
    setPending((prev) => prev.filter((x) => x.record_id !== r.id));
    pushToast("success", `Deleted "${r.artist} — ${r.title}"`);
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
    setLoading(true);
    const [
      recordsRes,
      pendingRes,
      runsRes,
      settingsRes,
      requestsRes,
      interestRes,
      shipmentsRes,
      invoicesRes,
    ] = await Promise.all([
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
          .select("key,value")
          .in("key", ["reddit_post_url", "reddit_post_records"]),
        supabase
          .from("order_requests")
          .select("*")
          .in("status", ["new", "loaded"])
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("record_interest").select("*"),
        supabase
          .from("shipments")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("invoices").select("*"),
      ]);
    setLoading(false);
    if (recordsRes.error || pendingRes.error || runsRes.error || requestsRes.error) {
      setLoadError(
        recordsRes.error?.message ||
          pendingRes.error?.message ||
          runsRes.error?.message ||
          requestsRes.error?.message ||
          "Failed to load"
      );
      return;
    }
    setRecords((recordsRes.data ?? []) as DbRecord[]);
    // Shipments are non-fatal, like interest — an error just leaves the
    // fulfillment panel empty, but say so instead of failing silently.
    if (shipmentsRes.error) {
      pushToast("error", `Shipments didn't load: ${shipmentsRes.error.message}`);
    }
    if (interestRes.error) {
      pushToast("error", `Interest data didn't load: ${interestRes.error.message}`);
    }
    if (invoicesRes.error) {
      pushToast("error", `Invoice costs didn't load: ${invoicesRes.error.message}`);
    }
    setShipments((shipmentsRes.data ?? []) as Shipment[]);
    setInvoices((invoicesRes.data ?? []) as Invoice[]);
    setPending((pendingRes.data ?? []) as PendingPriceChange[]);
    setRuns((runsRes.data ?? []) as PriceRun[]);
    setOrderRequests((requestsRes.data ?? []) as OrderRequest[]);
    const settingsMap = new Map(
      ((settingsRes.data ?? []) as { key: string; value: string }[]).map(
        (s) => [s.key, s.value]
      )
    );
    setPostUrl(settingsMap.get("reddit_post_url") ?? "");
    try {
      const saved = JSON.parse(settingsMap.get("reddit_post_records") || "null");
      if (saved && Array.isArray(saved.ids)) {
        setPostedInfo({
          ids: saved.ids.filter((id: unknown) => typeof id === "number"),
          posted_at: typeof saved.posted_at === "string" ? saved.posted_at : null,
        });
      }
    } catch {
      // Malformed saved post list — treat as no saved post.
    }
    // Interest is non-fatal — a failed read shouldn't blank the admin.
    setInterest(
      Object.fromEntries(
        ((interestRes.data ?? []) as RecordInterest[]).map((x) => [
          x.record_id,
          x,
        ])
      )
    );
  }, [supabase, pushToast]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  // Flag this browser so the owner's own shop browsing isn't tracked.
  useEffect(() => {
    if (!isAdmin) return;
    try {
      localStorage.setItem("cr_no_track", "1");
    } catch {}
  }, [isAdmin]);

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
      pushToast("error", `Save failed: ${error.message}`);
      return false;
    }
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    pushToast("success", "Saved ✓");
    return true;
  }

  async function savePrice(r: DbRecord) {
    const raw = priceEdits[r.id];
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) {
      pushToast("error", `"${raw}" isn't a valid price — enter 0 or more.`);
      return;
    }
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
      pushToast("error", `Saving the post URL failed: ${error.message}`);
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

  async function saveSoldPrice(r: DbRecord) {
    const raw = (soldPriceEdits[r.id] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      pushToast("error", `"${raw}" isn't a valid sold price — enter 0 or more.`);
      return;
    }
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

  // Inline hold editor (which row is asking for a buyer name, and the draft)
  const [holdEditId, setHoldEditId] = useState<number | null>(null);
  const [holdBuyerInput, setHoldBuyerInput] = useState("");

  async function confirmHold(r: DbRecord) {
    const buyer = holdBuyerInput.trim().replace(/^u\//, "");
    if (!buyer) return;
    const ok = await updateRecord(r.id, {
      hold_buyer: buyer,
      hold_until: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    });
    if (ok) {
      setHoldEditId(null);
      setHoldBuyerInput("");
    }
  }

  async function releaseHold(r: DbRecord) {
    await updateRecord(r.id, { hold_buyer: null, hold_until: null });
  }

  async function markSold(r: DbRecord, sold: boolean) {
    // Un-selling erases the sale date — make sure it's deliberate.
    if (
      !sold &&
      !window.confirm(
        `Un-mark "${r.artist} — ${r.title}" as sold? This clears its sold date.`
      )
    )
      return;
    // Selling a held record carries the hold's buyer over and clears the hold
    const patch: Partial<DbRecord> = {
      sold,
      sold_at: sold ? new Date().toISOString() : null,
    };
    if (sold && r.hold_buyer && !(r.buyer_username ?? "").trim()) {
      patch.buyer_username = r.hold_buyer;
    }
    if (sold) {
      patch.hold_buyer = null;
      patch.hold_until = null;
    }
    const ok = await updateRecord(r.id, patch);
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
    if (await copyText(text, "Copy this confirmation comment")) {
      setConfirmCopiedId(r.id);
      setTimeout(() => setConfirmCopiedId(null), 2000);
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
    // Track what actually landed so the UI always matches the DB, even when
    // a chunk fails partway through.
    const applied: PendingPriceChange[] = [];
    let failure: string | null = null;
    if (approve) {
      const chunk = 10;
      for (let i = 0; i < list.length && !failure; i += chunk) {
        const slice = list.slice(i, i + chunk);
        const results = await Promise.all(
          slice.map((p) =>
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
        slice.forEach((p, j) => {
          if (results[j].error) failure = failure ?? results[j].error!.message;
          else applied.push(p);
        });
      }
    } else {
      applied.push(...list);
    }
    const ids = applied.map((p) => p.id);
    const resolvedIds: number[] = [];
    for (let i = 0; i < ids.length && !failure; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error } = await supabase
        .from("pending_price_changes")
        .update({
          status: approve ? "approved" : "rejected",
          resolved_at: new Date().toISOString(),
        })
        .in("id", slice);
      if (error) failure = error.message;
      else resolvedIds.push(...slice);
    }
    const resolvedSet = new Set(resolvedIds);
    setPending((prev) => prev.filter((x) => !resolvedSet.has(x.id)));
    if (approve && applied.length > 0) {
      const byRecord = new Map(applied.map((p) => [p.record_id, p]));
      setRecords((prev) =>
        prev.map((r) => {
          const p = byRecord.get(r.id);
          return p
            ? { ...r, price: p.suggested_price, prev_price: p.old_price }
            : r;
        })
      );
    }
    if (failure) {
      pushToast(
        "error",
        `Bulk ${approve ? "approve" : "reject"} stopped early — ${resolvedIds.length} of ${list.length} completed: ${failure}`
      );
    } else {
      pushToast(
        "success",
        `${approve ? "Approved" : "Rejected"} ${resolvedIds.length} price change${resolvedIds.length === 1 ? "" : "s"} ✓`
      );
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
      pushToast("error", `Couldn't resolve the price change: ${error.message}`);
      return;
    }
    setPending((prev) => prev.filter((x) => x.id !== p.id));
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = records.filter((r) => {
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
      if (shownFilter === "shown" && !r.listed) return false;
      if (shownFilter === "hidden" && r.listed) return false;
      if (interestFilter === "clicked-no-request") {
        const i = interest[r.id];
        const held =
          !!r.hold_until && new Date(r.hold_until).getTime() > Date.now();
        if (
          !i ||
          i.interest_sessions === 0 ||
          i.request_sessions > 0 ||
          r.sold ||
          held
        )
          return false;
      }
      if (!q) return true;
      return `${r.artist} ${r.title} ${r.pressing} ${(r.genres ?? []).join(" ")} ${r.collection ?? ""}`
        .toLowerCase()
        .includes(q);
    });
    if (sortBy !== "artist") {
      const alpha = (a: DbRecord, b: DbRecord) =>
        (a.artist + a.title).localeCompare(b.artist + b.title);
      list = [...list].sort((a, b) => {
        switch (sortBy) {
          case "price-desc":
            return b.price - a.price || alpha(a, b);
          case "price-asc":
            return a.price - b.price || alpha(a, b);
          case "interest":
            return (
              (interest[b.id]?.interest_sessions ?? 0) -
                (interest[a.id]?.interest_sessions ?? 0) || alpha(a, b)
            );
          case "added":
            return (
              (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
              b.id - a.id
            );
          default:
            return alpha(a, b);
        }
      });
    }
    return list;
  }, [records, search, sortBy, genreFilter, collectionFilter, letterFilter, shownFilter, interestFilter, interest]);

  // --- Sale desk: multi-select records for a Reddit-DM sale ---
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saleBuyer, setSaleBuyer] = useState("");
  const [saleEmail, setSaleEmail] = useState("");
  const [saleBusy, setSaleBusy] = useState<null | "hold" | "sold" | "invoice">(null);
  const [saleStatus, setSaleStatus] = useState("");
  const [saleInvoice, setSaleInvoice] = useState<null | {
    id: string;
    url: string | null;
    status: string;
    warning?: string;
  }>(null);
  const [replyCopied, setReplyCopied] = useState(false);
  const [invoiceLinkCopied, setInvoiceLinkCopied] = useState(false);

  // From records, not filteredRecords — selection survives filter changes.
  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id)),
    [records, selectedIds]
  );
  const saleRecords = useMemo(
    () => selectedRecords.filter((r) => !r.sold),
    [selectedRecords]
  );
  const saleTotals = useMemo(() => bundleBreakdown(saleRecords), [saleRecords]);
  const saleSoldCount = selectedRecords.length - saleRecords.length;
  // Selected records the current filters are hiding — bulk actions still
  // include them, so the sale desk calls them out.
  const filteredIdSet = useMemo(
    () => new Set(filteredRecords.map((r) => r.id)),
    [filteredRecords]
  );
  const offFilterSelectedCount = useMemo(
    () => selectedRecords.filter((r) => !filteredIdSet.has(r.id)).length,
    [selectedRecords, filteredIdSet]
  );

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Seed the buyer input from an active hold the first time it's useful
    setSaleBuyer((prev) => {
      if (prev.trim()) return prev;
      const r = records.find((x) => x.id === id);
      return r && holdActive(r) && r.hold_buyer ? r.hold_buyer : prev;
    });
  }

  function toggleSelectAllFiltered(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of filteredRecords) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  function clearSaleDesk() {
    setSelectedIds(new Set());
    setSaleBuyer("");
    setSaleEmail("");
    setSaleStatus("");
    setSaleInvoice(null);
  }

  async function copySaleReply() {
    if (saleRecords.length === 0) return;
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const { lines, subtotal, parcels, shipping, total } = saleTotals;
    const text = `${buyer ? `Hi u/${buyer}!` : "Hi!"} Here's the breakdown for the records you asked about:\n\n${lines.join(
      "\n"
    )}\n\nSubtotal: $${subtotal}\nShipping (${parcels} parcel${parcels === 1 ? "" : "s"} of up to ${RECORDS_PER_PARCEL} records): $${shipping}\nTotal: $${total}\n\nPayment is PayPal G&S invoice — I cover the fee. Reply with your PayPal email and I'll send the invoice there, or I can post a payment link here.`;
    if (await copyText(text, "Copy this reply")) {
      setReplyCopied(true);
      setTimeout(() => setReplyCopied(false), 1600);
    }
  }

  async function holdSelected() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const ids = saleRecords.map((r) => r.id);
    if (!buyer || ids.length === 0 || saleBusy) return;
    setSaleBusy("hold");
    const patch = {
      hold_buyer: buyer,
      hold_until: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    };
    const { error } = await supabase
      .from("records")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .in("id", ids);
    setSaleBusy(null);
    if (error) {
      pushToast("error", `Hold failed: ${error.message}`);
      return;
    }
    const idSet = new Set(ids);
    setRecords((prev) =>
      prev.map((r) => (idSet.has(r.id) ? { ...r, ...patch } : r))
    );
    pushToast("success", `Held ${ids.length} record${ids.length === 1 ? "" : "s"} for 48h ✓`);
  }

  async function markSelectedSold() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (targets.length === 0 || saleBusy) return;
    if (
      !window.confirm(
        `Mark ${targets.length} record${targets.length > 1 ? "s" : ""} sold${buyer ? ` to u/${buyer}` : ""}? Each record's sold price is set to its listed price.`
      )
    )
      return;
    setSaleBusy("sold");
    try {
      const patches = new Map(
        targets.map((r) => [
          r.id,
          {
            sold: true,
            sold_at: new Date().toISOString(),
            sold_price: Number(r.price),
            buyer_username:
              buyer || r.hold_buyer || (r.buyer_username ?? "").trim() || "",
            hold_buyer: null,
            hold_until: null,
          } satisfies Partial<DbRecord>,
        ])
      );
      // Track per-record success so the UI reflects exactly what landed in
      // the DB, even when a chunk fails partway through.
      const chunk = 10;
      const done: number[] = [];
      let failure: string | null = null;
      for (let i = 0; i < targets.length && !failure; i += chunk) {
        const slice = targets.slice(i, i + chunk);
        const results = await Promise.all(
          slice.map((r) =>
            supabase
              .from("records")
              .update({
                ...patches.get(r.id),
                updated_at: new Date().toISOString(),
              })
              .eq("id", r.id)
          )
        );
        slice.forEach((r, j) => {
          if (results[j].error) failure = failure ?? results[j].error!.message;
          else done.push(r.id);
        });
      }
      const doneSet = new Set(done);
      if (done.length > 0) {
        setRecords((prev) =>
          prev.map((r) =>
            doneSet.has(r.id) ? { ...r, ...patches.get(r.id) } : r
          )
        );
      }
      if (failure) {
        pushToast(
          "error",
          `Marked ${done.length} of ${targets.length} sold before an error: ${failure}`
        );
        return;
      }
      pushToast("success", `Marked ${done.length} sold ✓`);
      // Best-effort: close loaded order requests whose records are now all
      // sold. Failures are non-fatal — the card keeps its manual buttons.
      const finished = orderRequests.filter(
        (req) =>
          req.status === "loaded" &&
          req.record_ids.every((id) => doneSet.has(id) || byId.get(id)?.sold)
      );
      if (finished.length > 0) {
        supabase
          .from("order_requests")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .in(
            "id",
            finished.map((r) => r.id)
          )
          .then(({ error }) => {
            if (error) {
              console.warn("order request auto-complete failed:", error.message);
              return;
            }
            const finishedIds = new Set(finished.map((r) => r.id));
            setOrderRequests((prev) => prev.filter((r) => !finishedIds.has(r.id)));
          });
      }
      const withDiscogs = targets.filter(
        (r) => doneSet.has(r.id) && r.discogs_release_id
      );
      if (
        withDiscogs.length > 0 &&
        window.confirm(
          `Also remove ${withDiscogs.length} record${withDiscogs.length > 1 ? "s" : ""} from your Discogs collection?`
        )
      ) {
        // Sequential to be gentle on Discogs rate limits
        for (const r of withDiscogs) {
          await removeFromDiscogs(r);
        }
      }
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Bulk mark-sold failed");
    } finally {
      setSaleBusy(null);
    }
  }

  async function createInvoice() {
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const targets = saleRecords;
    if (!buyer || targets.length === 0 || saleBusy) return;
    setSaleBusy("invoice");
    setSaleStatus("");
    setSaleInvoice(null);
    try {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/paypal-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          ids: targets.map((r) => r.id),
          buyer,
          email: saleEmail.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (res.status === 409) {
        setSaleStatus(
          `Already sold: ${(body.soldIds ?? []).join(", ")} — refreshing records…`
        );
        await loadData();
        return;
      }
      if (!res.ok) {
        setSaleStatus(body.error || "Invoice failed");
        return;
      }
      setSaleInvoice({
        id: body.invoiceId,
        url: body.recipientViewUrl,
        status: body.status,
        warning: body.warning,
      });
      // The route stamps paypal_invoice_id on the records — mirror it locally
      // so the fulfillment panel links up without a reload, but only when
      // the stamp actually landed (otherwise the panel would show a link
      // that vanishes on reload).
      if (body.invoiceStamped !== false) {
        const invoicedIds = new Set(targets.map((r) => r.id));
        setRecords((prev) =>
          prev.map((r) =>
            invoicedIds.has(r.id)
              ? { ...r, paypal_invoice_id: body.invoiceId }
              : r
          )
        );
      }
    } catch {
      setSaleStatus("Request failed");
    } finally {
      setSaleBusy(null);
    }
  }

  async function copyInvoiceLink() {
    if (!saleInvoice?.url) return;
    if (await copyText(saleInvoice.url, "Copy the payment link")) {
      setInvoiceLinkCopied(true);
      setTimeout(() => setInvoiceLinkCopied(false), 1600);
    }
  }

  // --- Incoming order requests + paste-a-DM parser ---
  const byId = useMemo(
    () => new Map(records.map((r) => [r.id, r])),
    [records]
  );
  const newRequestCount = orderRequests.filter((r) => r.status === "new").length;

  const [refCopiedId, setRefCopiedId] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [parseResult, setParseResult] = useState<null | {
    ref: string | null;
    refRequest: OrderRequest | null;
    rows: LineMatch[];
    choices: Record<number, number>; // row index -> chosen record id
  }>(null);
  const [saveParsedChecked, setSaveParsedChecked] = useState(true);

  // Orders in progress that have no inbox card: unsold records with an
  // active hold, grouped per buyer.
  const activeHolds = useMemo(() => {
    const groups = new Map<string, DbRecord[]>();
    for (const r of records) {
      if (r.sold || !holdActive(r)) continue;
      const buyer = (r.hold_buyer ?? "").trim() || "(no buyer name)";
      const list = groups.get(buyer);
      if (list) list.push(r);
      else groups.set(buyer, [r]);
    }
    return [...groups.entries()]
      .map(([buyer, recs]) => ({
        buyer,
        recs,
        // Holds in a group can expire at different times; show the soonest.
        until: recs.reduce(
          (min, r) => Math.min(min, new Date(r.hold_until!).getTime()),
          Infinity
        ),
      }))
      .sort((a, b) => a.until - b.until);
  }, [records]);

  // Replace the sale-desk selection (with confirmation when it differs),
  // open the Listings section, and scroll to the sticky bar.
  function applySaleSelection(ids: number[]): boolean {
    const next = new Set(ids);
    const differs =
      selectedIds.size !== next.size ||
      [...selectedIds].some((id) => !next.has(id));
    if (selectedIds.size > 0 && differs) {
      if (
        !window.confirm(
          `Replace the current sale desk selection (${selectedIds.size} record${selectedIds.size === 1 ? "" : "s"})?`
        )
      )
        return false;
    }
    setSelectedIds(next);
    if (collapsedSections.has("listings")) {
      const opened = new Set(collapsedSections);
      opened.delete("listings");
      setCollapsed(opened);
    }
    // The sticky bar only exists once the selection renders.
    setTimeout(() => {
      document
        .getElementById("sale-desk")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return true;
  }

  async function loadRequestIntoSaleDesk(req: OrderRequest) {
    const available = req.record_ids.filter((id) => {
      const r = byId.get(id);
      return r && !r.sold;
    });
    if (available.length === 0) {
      pushToast("info", "None of this request's records are still available.");
      return;
    }
    if (!applySaleSelection(available)) return;
    if (req.status === "new") {
      const { error } = await supabase
        .from("order_requests")
        .update({ status: "loaded", updated_at: new Date().toISOString() })
        .eq("id", req.id);
      if (!error) {
        setOrderRequests((prev) =>
          prev.map((r) => (r.id === req.id ? { ...r, status: "loaded" } : r))
        );
      }
    }
  }

  function loadHoldIntoSaleDesk(group: { buyer: string; recs: DbRecord[] }) {
    if (!applySaleSelection(group.recs.map((r) => r.id))) return;
    // Seed the buyer field like a row-toggle would, without clobbering a
    // name the admin already typed.
    setSaleBuyer((prev) =>
      prev.trim() || group.buyer.startsWith("(") ? prev : group.buyer
    );
  }

  // Track a paste-parsed order in the inbox like any buyer-submitted request.
  // The insert goes through the same validation trigger, so ids are
  // revalidated and totals recomputed server-side.
  async function saveParsedRequest(ids: number[]) {
    const { data, error } = await supabase
      .from("order_requests")
      .insert({ ref_code: makeRefCode(), record_ids: ids })
      .select()
      .single();
    if (error || !data) {
      console.warn("could not save parsed order as request:", error?.message);
      return;
    }
    // It's going straight onto the sale desk, so it starts out loaded.
    const { error: statusError } = await supabase
      .from("order_requests")
      .update({ status: "loaded", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    const saved = {
      ...(data as OrderRequest),
      status: statusError ? "new" : "loaded",
    } as OrderRequest;
    setOrderRequests((prev) => [saved, ...prev]);
  }

  async function updateRequestStatus(
    req: OrderRequest,
    status: "completed" | "dismissed"
  ) {
    const { error } = await supabase
      .from("order_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) {
      pushToast("error", `Couldn't update the request: ${error.message}`);
      return;
    }
    setOrderRequests((prev) => prev.filter((r) => r.id !== req.id));
    // The card disappears from the open list, so offer a way back.
    pushToast(
      "info",
      `Request ${req.ref_code} ${status === "dismissed" ? "dismissed" : "marked completed"}.`,
      { label: "Undo", onClick: () => restoreRequest(req) }
    );
  }

  async function restoreRequest(req: OrderRequest) {
    const { error } = await supabase
      .from("order_requests")
      .update({ status: "new", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) {
      pushToast("error", `Couldn't restore the request: ${error.message}`);
      return;
    }
    setOrderRequests((prev) =>
      prev.some((r) => r.id === req.id)
        ? prev
        : [...prev, { ...req, status: "new" as const }].sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          )
    );
  }

  async function copyRefCode(req: OrderRequest) {
    if (await copyText(req.ref_code, "Copy the ref code")) {
      setRefCopiedId(req.id);
      setTimeout(() => setRefCopiedId(null), 1600);
    }
  }

  async function parsePasted() {
    const text = pasteText;
    if (!text.trim()) return;
    const ref = extractRefCode(text);
    let refRequest = ref
      ? (orderRequests.find((r) => r.ref_code === ref) ?? null)
      : null;
    if (ref && !refRequest) {
      // Not in the open list — maybe already completed/dismissed or older
      // than the load window.
      const { data } = await supabase
        .from("order_requests")
        .select("*")
        .eq("ref_code", ref)
        .maybeSingle();
      refRequest = (data as OrderRequest | null) ?? null;
    }
    const rows = matchLines(parseOrderText(text), records);
    setParseResult({ ref, refRequest, rows, choices: {} });
  }

  // Records the review panel would put on the sale desk right now.
  const parsedIds = useMemo(() => {
    if (!parseResult) return [] as number[];
    const ids: number[] = [];
    parseResult.rows.forEach((row, i) => {
      if (row.status === "matched" && row.match && !row.match.sold) {
        ids.push(row.match.id);
      } else if (row.status === "ambiguous") {
        const chosen = parseResult.choices[i];
        if (chosen !== undefined && !byId.get(chosen)?.sold) ids.push(chosen);
      }
    });
    return [...new Set(ids)];
  }, [parseResult, byId]);

  function applyParsedSelection() {
    if (parsedIds.length === 0) return;
    if (!applySaleSelection(parsedIds)) return;
    // Don't double-track: a DM whose ref matched a saved request is already
    // in the inbox.
    if (saveParsedChecked && !parseResult?.refRequest) {
      void saveParsedRequest(parsedIds);
    }
    setPasteText("");
    setParseResult(null);
  }

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
    const soldTotal = sum(sold, (r) => Number(r.sold_price ?? r.price));
    // Costs typed in from PayPal's transaction pages: fees and buyer-paid
    // shipping per invoice, postage per parcel. Net is what actually landed
    // in the account — record sales + shipping income − fees − postage.
    const feesTotal = invoices.reduce(
      (t, inv) => t + Number(inv.paypal_fee ?? 0),
      0
    );
    const shippingCharged = invoices.reduce(
      (t, inv) => t + Number(inv.shipping_charged ?? 0),
      0
    );
    const postageTotal = shipments.reduce(
      (t, s) => t + Number(s.postage_cost ?? 0),
      0
    );
    return {
      forSaleCount: forSale.length,
      askingTotal: sum(forSale, (r) => Number(r.price)),
      soldCount: sold.length,
      soldTotal,
      asp: sold.length ? soldTotal / sold.length : 0,
      hiddenCount: hidden.length,
      hiddenTotal: sum(hidden, (r) => Number(r.price)),
      feesTotal,
      postageTotal,
      shippingCharged,
      netTotal: soldTotal + shippingCharged - feesTotal - postageTotal,
    };
  }, [records, shipments, invoices]);

  const draftParcelCount = useMemo(
    () => shipments.filter((s) => s.status === "draft").length,
    [shipments]
  );

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
      // Server route carries the Discogs token — anonymous browser calls
      // to api.discogs.com hit rate limits quickly.
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch(`/api/discogs-release?id=${releaseId}`, {
        headers: { Authorization: `Bearer ${current?.access_token ?? ""}` },
      });
      const rel = await res.json();
      if (!res.ok) throw new Error(rel.error || `Discogs returned ${res.status}`);
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
    // Skip records already in the target state — bulk "Sold ON" must not
    // re-stamp sold_at on historical sales.
    const ids = filteredRecords
      .filter((r) => r[field] !== value)
      .map((r) => r.id);
    if (ids.length === 0) return;
    const label = field === "listed" ? "Shown" : "Sold";
    if (
      !window.confirm(
        `Set ${label} ${value ? "ON" : "OFF"} for all ${ids.length} record${ids.length === 1 ? "" : "s"} in the current filter?`
      )
    )
      return;
    setBulkSaving(true);
    const patch: Partial<DbRecord> = { [field]: value };
    if (field === "sold") patch.sold_at = value ? new Date().toISOString() : null;
    const { error } = await supabase
      .from("records")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .in("id", ids);
    setBulkSaving(false);
    if (error) {
      pushToast("error", `Bulk ${label} update failed: ${error.message}`);
      return;
    }
    const idSet = new Set(ids);
    setRecords((prev) =>
      prev.map((r) => (idSet.has(r.id) ? { ...r, ...patch } : r))
    );
    pushToast("success", `${label} ${value ? "on" : "off"} for ${ids.length} record${ids.length === 1 ? "" : "s"} ✓`);
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
              onClick={loadData}
              disabled={loading}
              title="Reload everything from the database — useful after working in another tab"
              className={buttonClass}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() =>
                setCollapsed(allCollapsed ? new Set() : new Set(SECTIONS))
              }
              title="Collapse or expand every section on the page"
              className={buttonClass}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
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
          <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => setLoadError("")}
              aria-label="Dismiss error"
              className="text-red-300 transition hover:text-white"
            >
              ×
            </button>
          </div>
        ) : null}

        {/* Section jump nav — the page is long; this stays pinned on scroll */}
        <nav
          aria-label="Page sections"
          className="sticky top-0 z-20 mt-6 flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-neutral-950/95 p-2 backdrop-blur"
        >
          {(
            [
              ["reddit", "Reddit", 0],
              ["requests", "Requests", orderRequests.length],
              ["fulfillment", "Fulfillment", draftParcelCount],
              ["pending", "Pending", pending.length],
              ["add", "Add"],
              ["listings", "Listings", records.length],
              ["runs", "Runs"],
              ["account", "Account"],
            ] as [SectionKey, string, number?][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => jumpToSection(key)}
              className={`rounded-lg border border-white/10 px-2.5 py-1 text-xs transition hover:bg-white hover:text-black ${
                key === "requests" && newRequestCount > 0
                  ? "text-amber-300"
                  : "text-neutral-300"
              }`}
            >
              {label}
              {count ? ` (${count})` : ""}
            </button>
          ))}
        </nav>

        {/* Collection value summary */}
        {loading && records.length === 0 ? (
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["For sale", "Sold", "Net", "Hidden"].map((label) => (
              <div
                key={label}
                className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-5"
              >
                <p className="text-sm text-neutral-400">{label}</p>
                <p className="mt-2 h-7 w-24 rounded bg-white/10" />
                <p className="mt-2 h-3 w-32 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <p
              className="mt-1 text-xs text-neutral-500"
              title="Uses the final sold price when entered, listed price otherwise"
            >
              {stats.soldCount} sold · ${stats.asp.toFixed(2)} avg selling price
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-neutral-400">Net</p>
            <p
              className="mt-1 text-2xl font-semibold text-green-400"
              title="Sold total + shipping collected − PayPal fees − postage. Fees and postage are entered per order in the fulfillment section."
            >
              ${stats.netTotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              ${stats.feesTotal.toFixed(2)} fees · ${stats.postageTotal.toFixed(2)}{" "}
              postage · ${stats.shippingCharged.toFixed(2)} shipping collected
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
        )}

        {/* Reddit tools */}
        {sectionHeading("reddit", "Reddit tools", "mt-10 text-xl font-medium")}
        {collapsedSections.has("reddit") ? null : (
          <>
        <p className="mt-1 text-sm text-neutral-400">
          The weekly post uses the records ticked in the listings table&rsquo;s
          &ldquo;Sel&rdquo; column (shared with the sale desk) — pick 15&ndash;20,
          copy, and the list is remembered so you can post an update later with
          sold records crossed out (no price shown). &ldquo;Copy Reddit
          table&rdquo; is still the full catalog.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyRedditTable} className={buttonClass}>
            {tableCopied ? "Copied!" : "Copy Reddit table"}
          </button>
          <button
            type="button"
            onClick={copyWeeklyPost}
            className={buttonClass}
            disabled={saleRecords.length === 0}
            title="Builds the weekly post from the records selected in the listings table"
          >
            {weeklyCopied
              ? "Copied!"
              : `Copy weekly post (${saleRecords.length} selected)`}
          </button>
          <button
            type="button"
            onClick={copyUpdatePost}
            className={buttonClass}
            disabled={postedInfo.ids.length === 0}
            title="Regenerates the last copied weekly post with sold records crossed out — paste over the live post's body"
          >
            {updateCopied
              ? "Copied!"
              : `Copy post update${
                  postedInfo.ids.length
                    ? ` (${postedInfo.ids.filter((id) => byId.get(id)?.sold).length} sold / ${postedInfo.ids.length} posted)`
                    : ""
                }`}
          </button>
        </div>
        {saleRecords.length > 0 &&
        (saleRecords.length < 15 || saleRecords.length > 20) ? (
          <p className="mt-2 text-xs text-amber-400">
            Tip: 15&ndash;20 records works well for a weekly post — you have{" "}
            {saleRecords.length} selected.
          </p>
        ) : null}
        {postedInfo.posted_at ? (
          <p className="mt-2 text-xs text-neutral-500">
            Current post: {postedInfo.ids.length} records, copied{" "}
            {new Date(postedInfo.posted_at).toLocaleDateString()}.
          </p>
        ) : null}

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
          </>
        )}

        {/* Incoming order requests */}
        {sectionHeading(
          "requests",
          <>
            Incoming requests{" "}
            {newRequestCount > 0 ? (
              <span className="text-sm text-amber-400">
                ({newRequestCount} new)
              </span>
            ) : (
              <span className="text-sm text-neutral-400">
                ({orderRequests.length} open)
              </span>
            )}
          </>,
          "mt-10 text-xl font-medium"
        )}
        {collapsedSections.has("requests") ? null : (
          <>
            <p className="mt-1 text-sm text-neutral-400">
              Saved automatically when a buyer clicks &ldquo;Request to
              buy&rdquo; on the site — the ref code also appears in their DM.
              Load one to check its records into the sale desk, or paste the DM
              itself below.
            </p>
            {orderRequests.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-400">No open requests.</p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {orderRequests.map((req) => {
                  const unavailable = req.record_ids.filter((id) => {
                    const r = byId.get(id);
                    return !r || r.sold;
                  }).length;
                  return (
                    <div
                      key={req.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyRefCode(req)}
                          title="Copy ref code"
                          className="font-mono text-sm text-amber-300 transition hover:text-amber-100"
                        >
                          {refCopiedId === req.id ? "Copied!" : req.ref_code}
                        </button>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            req.status === "new"
                              ? "border-amber-400/40 text-amber-300"
                              : "border-white/15 text-neutral-400"
                          }`}
                        >
                          {req.status}
                        </span>
                        <span className="ml-auto text-xs text-neutral-500">
                          {timeAgo(req.created_at)}
                        </span>
                      </div>
                      <ul className="mt-3 space-y-1 text-sm">
                        {req.items.map((it) => {
                          const r = byId.get(it.id);
                          const flags = r
                            ? recordFlags(r, it.price)
                            : ["no longer in the system"];
                          return (
                            <li key={it.id}>
                              {it.artist} — {it.title}{" "}
                              <span className="text-neutral-500">
                                {it.media}/{it.sleeve}
                              </span>{" "}
                              — ${it.price}
                              {flags.length > 0 ? (
                                <span className="text-amber-400">
                                  {" "}
                                  · {flags.join(" · ")}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-sm text-neutral-400">
                        Subtotal ${req.subtotal} · Shipping ${req.shipping} ·{" "}
                        <span className="font-medium text-white">
                          Total ${req.total}
                        </span>
                      </p>
                      {unavailable > 0 ? (
                        <p className="mt-1 text-xs text-amber-400">
                          {unavailable} of {req.record_ids.length} unavailable —
                          will not be selected.
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => loadRequestIntoSaleDesk(req)}
                        >
                          Load into sale desk
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => updateRequestStatus(req, "completed")}
                        >
                          Mark completed
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => updateRequestStatus(req, "dismissed")}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeHolds.length > 0 ? (
              <>
                <h3 className="mt-8 text-lg font-medium">Active holds</h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Records currently held for a buyer — orders in progress even
                  when there&rsquo;s no request card above. Holds expire on
                  their own; when payment lands, load one and mark it sold.
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {activeHolds.map((group) => {
                    const totals = bundleBreakdown(group.recs);
                    const hoursLeft = Math.max(
                      0,
                      Math.round((group.until - Date.now()) / 3600000)
                    );
                    return (
                      <div
                        key={group.buyer}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">
                            {group.buyer.startsWith("(")
                              ? group.buyer
                              : `u/${group.buyer}`}
                          </span>
                          <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-xs text-amber-300">
                            on hold
                          </span>
                          <span className="ml-auto text-xs text-neutral-500">
                            ~{hoursLeft}h left
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1 text-sm">
                          {group.recs.map((r) => (
                            <li key={r.id}>
                              {r.artist} — {r.title}{" "}
                              <span className="text-neutral-500">
                                {r.media}/{r.sleeve}
                              </span>{" "}
                              — ${r.price}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-sm text-neutral-400">
                          Subtotal ${totals.subtotal} · Shipping $
                          {totals.shipping} ·{" "}
                          <span className="font-medium text-white">
                            Total ${totals.total}
                          </span>
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => loadHoldIntoSaleDesk(group)}
                          >
                            Load into sale desk
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h3 className="mt-8 text-lg font-medium">Paste a DM</h3>
            <p className="mt-1 text-sm text-neutral-400">
              Paste the buyer&rsquo;s message — even edited — and it&rsquo;s
              matched against your listings for review. Nothing is selected
              until you confirm.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={
                "1. Artist — Title — Media: M / Sleeve: NM — $63\n2. …"
              }
              className={`mt-3 w-full max-w-3xl ${inputClass}`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={!pasteText.trim()}
                onClick={parsePasted}
              >
                Parse
              </button>
              {parseResult ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    setPasteText("");
                    setParseResult(null);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            {parseResult ? (
              <div className="mt-3 max-w-3xl space-y-2 text-sm">
                {parseResult.refRequest ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <span className="text-emerald-300">
                      Exact match: saved request{" "}
                      <span className="font-mono">
                        {parseResult.refRequest.ref_code}
                      </span>{" "}
                      ({parseResult.refRequest.record_ids.length} records, $
                      {parseResult.refRequest.total}
                      {parseResult.refRequest.status !== "new" &&
                      parseResult.refRequest.status !== "loaded"
                        ? ` · ${parseResult.refRequest.status}`
                        : ""}
                      )
                    </span>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() =>
                        loadRequestIntoSaleDesk(parseResult.refRequest!)
                      }
                    >
                      Load request
                    </button>
                  </div>
                ) : parseResult.ref ? (
                  <p className="text-amber-400">
                    Ref code {parseResult.ref} found, but no saved request
                    matches it — using the parsed lines below.
                  </p>
                ) : null}
                {parseResult.rows.length === 0 ? (
                  <p className="text-neutral-400">
                    No order lines found in the pasted text.
                  </p>
                ) : (
                  parseResult.rows.map((row, i) => {
                    if (row.status === "matched" && row.match) {
                      const excluded = row.match.sold;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
                        >
                          <span className="text-emerald-400">✓</span>{" "}
                          {row.match.artist} — {row.match.title} ($
                          {row.match.price})
                          {row.flags && row.flags.length > 0 ? (
                            <span className="text-amber-400">
                              {" "}
                              · {row.flags.join(" · ")}
                              {excluded ? " — will not be selected" : ""}
                            </span>
                          ) : null}
                        </div>
                      );
                    }
                    if (row.status === "ambiguous") {
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                        >
                          <p className="text-amber-300">
                            Which record is &ldquo;{row.parsed.raw}&rdquo;?
                          </p>
                          <div className="mt-2 space-y-1">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`ambiguous-${i}`}
                                className="admin-radio"
                                checked={parseResult.choices[i] === undefined}
                                onChange={() =>
                                  setParseResult((prev) => {
                                    if (!prev) return prev;
                                    const choices = { ...prev.choices };
                                    delete choices[i];
                                    return { ...prev, choices };
                                  })
                                }
                              />
                              <span className="text-neutral-400">
                                None of these
                              </span>
                            </label>
                            {(row.candidates ?? []).map((c) => {
                              const flags = recordFlags(c, row.parsed.price);
                              return (
                                <label
                                  key={c.id}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="radio"
                                    name={`ambiguous-${i}`}
                                    className="admin-radio"
                                    checked={parseResult.choices[i] === c.id}
                                    onChange={() =>
                                      setParseResult((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              choices: {
                                                ...prev.choices,
                                                [i]: c.id,
                                              },
                                            }
                                          : prev
                                      )
                                    }
                                  />
                                  <span>
                                    {c.artist} — {c.title}{" "}
                                    <span className="text-neutral-500">
                                      {c.pressing}
                                    </span>{" "}
                                    — ${c.price}
                                    {flags.length > 0 ? (
                                      <span className="text-amber-400">
                                        {" "}
                                        · {flags.join(" · ")}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-300"
                      >
                        No match — select manually in Listings:{" "}
                        <span className="text-red-200">{row.parsed.raw}</span>
                      </div>
                    );
                  })
                )}
                {parseResult.rows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={parsedIds.length === 0}
                      onClick={applyParsedSelection}
                    >
                      Add {parsedIds.length} to sale desk
                    </button>
                    {!parseResult.refRequest ? (
                      <label className="flex items-center gap-2 text-sm text-neutral-400">
                        <input
                          type="checkbox"
                          checked={saveParsedChecked}
                          onChange={(e) => setSaveParsedChecked(e.target.checked)}
                          className="admin-checkbox"
                        />
                        Also save to Incoming requests
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {/* Fulfillment: parcels + tracking for sold records */}
        {sectionHeading(
          "fulfillment",
          <>
            Fulfillment{" "}
            <span className="text-sm text-neutral-400">
              ({draftParcelCount} parcel{draftParcelCount === 1 ? "" : "s"}{" "}
              awaiting tracking)
            </span>
          </>,
          "mt-10 text-xl font-medium"
        )}
        {collapsedSections.has("fulfillment") ? null : (
          <FulfillmentPanel
            records={records.filter((r) => r.sold)}
            shipments={shipments}
            invoices={invoices}
            supabase={supabase}
            onShipmentsChange={setShipments}
            onInvoicesChange={setInvoices}
            onRecordPatched={(id, patch) =>
              setRecords((prev) =>
                prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
              )
            }
            getAccessToken={async () => {
              const {
                data: { session: current },
              } = await supabase.auth.getSession();
              return current?.access_token ?? "";
            }}
            copyText={copyText}
            defaultThreadUrl={postUrl}
          />
        )}

        {/* Pending price approvals */}
        {sectionHeading(
          "pending",
          <>
            Pending price changes{" "}
            <span className="text-sm text-neutral-400">
              ({pending.length} waiting · moves over ±5% from the daily Discogs
              run)
            </span>
          </>,
          "mt-10 text-xl font-medium"
        )}
        {collapsedSections.has("pending") ? null : pending.length === 0 ? (
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
        {sectionHeading("add", "Add a record", "mt-12 text-xl font-medium")}
        {collapsedSections.has("add") ? null : (
          <>
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
          </>
        )}

        {/* Records editor */}
        {sectionHeading(
          "listings",
          <>
            Listings{" "}
            <span className="text-sm text-neutral-400">
              ({records.length} records)
            </span>
          </>,
          "mt-12 text-xl font-medium"
        )}
        {collapsedSections.has("listings") ? null : (
          <>
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
          <select
            value={interestFilter}
            onChange={(e) =>
              setInterestFilter(e.target.value as "all" | "clicked-no-request")
            }
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Interest: All</option>
            <option value="clicked-no-request">Clicked, no request</option>
          </select>
          <select
            value={shownFilter}
            onChange={(e) =>
              setShownFilter(e.target.value as "all" | "shown" | "hidden")
            }
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Shown: All</option>
            <option value="shown">Shown only</option>
            <option value="hidden">Hidden only</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="artist">Sort: Artist A–Z</option>
            <option value="price-desc">Price high → low</option>
            <option value="price-asc">Price low → high</option>
            <option value="interest">Most interest</option>
            <option value="added">Newest added</option>
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
        {selectedIds.size > 0 ? (
          <div
            id="sale-desk"
            className="sticky top-12 z-10 mt-4 rounded-2xl border border-amber-400/30 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">
                  {saleRecords.length} record{saleRecords.length === 1 ? "" : "s"}
                </span>{" "}
                <span className="text-neutral-400">
                  · Subtotal ${saleTotals.subtotal} · Shipping $
                  {saleTotals.shipping} ({saleTotals.parcels} parcel
                  {saleTotals.parcels === 1 ? "" : "s"}) ·{" "}
                </span>
                <span className="font-semibold">Total ${saleTotals.total}</span>
              </p>
              <button
                type="button"
                onClick={clearSaleDesk}
                className="text-xs text-neutral-500 underline transition hover:text-white"
              >
                Clear
              </button>
            </div>
            {saleSoldCount > 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                {saleSoldCount} selected record{saleSoldCount === 1 ? " is" : "s are"}{" "}
                already sold and will be skipped.
              </p>
            ) : null}
            {offFilterSelectedCount > 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                {offFilterSelectedCount} selected record
                {offFilterSelectedCount === 1 ? " is" : "s are"} hidden by the
                current filters but still included in these actions.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-neutral-500">u/</span>
              <input
                type="text"
                value={saleBuyer}
                onChange={(e) => setSaleBuyer(e.target.value)}
                placeholder="reddit buyer"
                className={`w-36 ${inputClass}`}
              />
              <input
                type="email"
                value={saleEmail}
                onChange={(e) => setSaleEmail(e.target.value)}
                placeholder="PayPal email (optional)"
                className={`w-56 ${inputClass}`}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={saleRecords.length === 0}
                onClick={copySaleReply}
              >
                {replyCopied ? "Copied!" : "Copy reply"}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!saleBuyer.trim() || saleRecords.length === 0 || saleBusy !== null}
                onClick={holdSelected}
              >
                {saleBusy === "hold" ? "Holding…" : "Hold all 48h"}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={saleRecords.length === 0 || saleBusy !== null}
                onClick={markSelectedSold}
              >
                {saleBusy === "sold" ? "Saving…" : "Mark all sold"}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!saleBuyer.trim() || saleRecords.length === 0 || saleBusy !== null}
                onClick={createInvoice}
              >
                {saleBusy === "invoice" ? "Creating…" : "PayPal invoice"}
              </button>
            </div>
            {saleStatus ? (
              <p className="mt-2 text-xs text-red-400">{saleStatus}</p>
            ) : null}
            {saleInvoice ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-400">
                  Invoice {saleInvoice.id} · {saleInvoice.status}
                  {saleEmail.trim() && !saleInvoice.warning
                    ? " — PayPal also emailed the buyer."
                    : ""}
                </span>
                {saleInvoice.url ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-white/15 px-2 py-1 text-white transition hover:bg-white hover:text-black"
                      onClick={copyInvoiceLink}
                    >
                      {invoiceLinkCopied ? "Copied!" : "Copy payment link"}
                    </button>
                    <a
                      href={saleInvoice.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-400 underline hover:text-white"
                    >
                      Open ↗
                    </a>
                  </>
                ) : null}
                {saleInvoice.warning ? (
                  <span className="text-amber-400">
                    {saleInvoice.warning}{" "}
                    <a
                      href="https://www.paypal.com/invoices"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      PayPal dashboard ↗
                    </a>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-400">
                <th className="px-3 py-3 text-center font-medium">
                  <div className="flex flex-col items-center gap-1">
                    Sel
                    <input
                      type="checkbox"
                      title="Select/deselect all records in the current search for the sale desk"
                      checked={
                        filteredRecords.length > 0 &&
                        filteredRecords.every((r) => selectedIds.has(r.id))
                      }
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            filteredRecords.some((r) => selectedIds.has(r.id)) &&
                            !filteredRecords.every((r) => selectedIds.has(r.id));
                      }}
                      onChange={(e) => toggleSelectAllFiltered(e.target.checked)}
                      className="admin-checkbox"
                    />
                  </div>
                </th>
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-3 py-3 font-medium">Price</th>
                <th className="px-3 py-3 font-medium">Interest</th>
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
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            filteredRecords.some((r) => r.listed) &&
                            !filteredRecords.every((r) => r.listed);
                      }}
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
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            filteredRecords.some((r) => r.sold) &&
                            !filteredRecords.every((r) => r.sold);
                      }}
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
              {filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                  >
                    No records match the current filters — try clearing the
                    search or a filter above.
                  </td>
                </tr>
              ) : null}
              {filteredRecords.map((r) => {
                const edited =
                  priceEdits[r.id] !== undefined &&
                  priceEdits[r.id] !== String(r.price);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 last:border-b-0"
                  >
                    <td className="px-3 py-3 text-center align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelected(r.id)}
                        className="admin-checkbox"
                      />
                    </td>
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
                          onKeyDown={blurOnEnter}
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
                          onKeyDown={blurOnEnter}
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(r.photo_urls ?? []).map((url) => (
                          <span key={url} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt=""
                              className="h-12 w-12 rounded-lg object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => removePhoto(r, url)}
                              title="Remove photo"
                              className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-red-800 text-center text-[10px] leading-4 text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <label
                          className="cursor-pointer rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black"
                          title="Photos of the actual copy — shown on the public card with an “Actual copy pictured” badge"
                        >
                          {uploadingId === r.id ? "Uploading…" : "+ Photos"}
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            disabled={uploadingId === r.id}
                            onChange={(e) => {
                              uploadPhotos(r, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
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
                        <button
                          type="button"
                          disabled={savingId === r.id}
                          onClick={() => deleteRecord(r)}
                          title="Permanently delete this record — for copies that were never actually sold (e.g. no longer owned)"
                          className="text-neutral-500 underline underline-offset-2 transition hover:text-red-400"
                        >
                          Delete…
                        </button>
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
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && edited) savePrice(r);
                          }}
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
                    <td className="px-3 py-3 whitespace-nowrap">
                      {interest[r.id] ? (
                        <span
                          className="text-neutral-300"
                          title={`${interest[r.id].interest_events} clicks · ${interest[r.id].request_events} requests · last ${new Date(interest[r.id].last_event_at).toLocaleDateString()}`}
                        >
                          {interest[r.id].interest_sessions} looked
                          {interest[r.id].request_sessions > 0 ? (
                            <span className="text-green-400">
                              {" "}
                              · {interest[r.id].request_sessions} asked
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
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
                              onKeyDown={blurOnEnter}
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
                              onKeyDown={blurOnEnter}
                              placeholder="sold for"
                              className={`w-24 ${inputClass}`}
                            />
                            {/* Tracking lives on parcels in Fulfillment —
                                shown read-only here so the two can't disagree */}
                            {r.tracking_number ? (
                              <span
                                className="font-mono text-xs text-neutral-400"
                                title="Tracking number, managed per parcel in the Fulfillment section"
                              >
                                {r.tracking_number}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => jumpToSection("fulfillment")}
                                title="Tracking numbers are managed per parcel in the Fulfillment section"
                                className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                add tracking in Fulfillment
                              </button>
                            )}
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
                      ) : holdActive(r) ? (
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-amber-300">
                            Held for u/{r.hold_buyer} until{" "}
                            {new Date(r.hold_until as string).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => releaseHold(r)}
                            className="self-start text-neutral-500 underline underline-offset-2 transition hover:text-white"
                          >
                            Release hold
                          </button>
                        </div>
                      ) : holdEditId === r.id ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-neutral-500">u/</span>
                          <input
                            type="text"
                            autoFocus
                            value={holdBuyerInput}
                            onChange={(e) => setHoldBuyerInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmHold(r);
                              if (e.key === "Escape") setHoldEditId(null);
                            }}
                            placeholder="reddit buyer"
                            className={`w-28 ${inputClass}`}
                          />
                          <button
                            type="button"
                            disabled={!holdBuyerInput.trim() || savingId === r.id}
                            onClick={() => confirmHold(r)}
                            className="rounded-lg border border-white/15 px-2 py-1 text-white transition hover:bg-white hover:text-black disabled:opacity-40"
                          >
                            Hold 48h
                          </button>
                          <button
                            type="button"
                            onClick={() => setHoldEditId(null)}
                            aria-label="Cancel hold"
                            className="text-neutral-500 transition hover:text-white"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setHoldEditId(r.id);
                            setHoldBuyerInput(r.hold_buyer ?? "");
                          }}
                          title="Reserve for a buyer for 48 hours — the public card shows On hold"
                          className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          Hold…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          </>
        )}

        {/* Price run reports */}
        {sectionHeading(
          "runs",
          "Daily price runs",
          "mt-12 text-xl font-medium"
        )}
        {collapsedSections.has("runs") ? null : runs.length === 0 ? (
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
                                  : ""}
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
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
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
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
                                {s.ebay_median != null
                                  ? ` · eBay median $${s.ebay_median}`
                                  : ""}
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
        {sectionHeading("account", "Account", "mt-12 text-xl font-medium")}
        {collapsedSections.has("account") ? null : (
          <>
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
          </>
        )}
      </section>

      {/* Toast stack — action feedback that's visible from anywhere on the page */}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.kind === "error"
                ? "border-red-500/40 bg-red-950/90 text-red-200"
                : t.kind === "success"
                  ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
                  : "border-white/20 bg-neutral-900/95 text-neutral-200"
            }`}
          >
            <span>{t.text}</span>
            <span className="flex shrink-0 items-center gap-2">
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    dismissToast(t.id);
                  }}
                  className="rounded-md border border-white/25 px-2 py-0.5 text-xs text-white transition hover:bg-white hover:text-black"
                >
                  {t.action.label}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                className="text-current opacity-60 transition hover:opacity-100"
              >
                ×
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Clipboard fallback — shown when navigator.clipboard is unavailable */}
      {clipboardFallback ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setClipboardFallback(null)}
        >
          <div
            role="dialog"
            aria-label={clipboardFallback.title}
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-neutral-950 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-neutral-300">
              {clipboardFallback.title} — automatic copy was blocked, so select
              and copy it from here:
            </p>
            <textarea
              readOnly
              autoFocus
              value={clipboardFallback.text}
              onFocus={(e) => e.currentTarget.select()}
              rows={12}
              className={`mt-3 w-full resize-y ${inputClass} font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => setClipboardFallback(null)}
              className={`mt-3 ${buttonClass}`}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
