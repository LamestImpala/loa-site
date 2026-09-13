"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FREE_SHIPPING_MIN,
  LETTERS,
  artistLetter,
  bundleBreakdown,
  makeRefCode,
} from "@/lib/records";
import {
  type DbRecord,
  type Invoice,
  type OrderRequest,
  type RecordEventRow,
} from "@/lib/supabase";
import { FulfillmentPanel } from "./fulfillment-panel";
import Link from "next/link";
import { holdActive } from "@/lib/admin/records";
import { useAdmin } from "./_shell/admin-provider";
import { blurOnEnter, buttonClass, inputClass, pct, timeAgo } from "./_shell/ui";
import {
  extractRefCode,
  matchLines,
  parseOrderText,
  recordFlags,
  type LineMatch,
} from "@/lib/order-parse";

const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];

// Collapsible page sections — keys double as the localStorage payload, so
// renaming one silently resets its saved state.
const SECTIONS = [
  "requests",
  "fulfillment",
  "add",
  "listings",
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




// One local-calendar-day slice of shopper activity; "looked"/"asked" count
// distinct anonymous sessions, "clicks" counts raw events. Days are bucketed
// in the browser's timezone so late-evening visits don't roll into tomorrow.
type DayBucket = {
  key: string; // local yyyy-mm-dd, sorts chronologically
  label: string; // e.g. "Aug 27"
  clicks: number;
  looked: number;
  asked: number;
};

function localDayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function bucketEventsByDay(events: RecordEventRow[]): DayBucket[] {
  const days = new Map<
    string,
    { clicks: number; look: Set<string>; ask: Set<string> }
  >();
  for (const e of events) {
    const key = localDayKey(new Date(e.created_at));
    let day = days.get(key);
    if (!day) {
      day = { clicks: 0, look: new Set(), ask: new Set() };
      days.set(key, day);
    }
    if (e.event_type === "buy_request") {
      day.ask.add(e.session_id);
    } else {
      day.clicks += 1;
      day.look.add(e.session_id);
    }
  }
  return [...days.entries()]
    .map(([key, d]) => ({
      key,
      label: dayLabel(key),
      clicks: d.clicks,
      looked: d.look.size,
      asked: d.ask.size,
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1)); // newest first
}

type SortKey = "artist" | "price-desc" | "price-asc" | "interest" | "added";
// "manual-off-market": hand-priced records sitting far from the Discogs
// grade suggestion — the audit list for deciding what to hand back to the
// daily run (uncheck "manual").
type InterestFilter = "all" | "clicked-no-request" | "manual-off-market";
const OFF_MARKET_HIGH = 1.3;
const OFF_MARKET_LOW = 0.6;

export default function AdminClient() {
  // Shared session, data and helpers from the /admin layout's provider.
  const {
    supabase,
    records,
    setRecords,
    shipments,
    setShipments,
    invoices,
    setInvoices,
    setPending,
    orderRequests,
    setOrderRequests,
    interest,
    events,
    market,
    postUrl,
    loading,
    loadData,
    pushToast,
    copyText,
    savingIds,
    setSaving,
    updateRecord,
    upsertInvoiceLocal,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    saleBuyer,
    setSaleBuyer,
    saleEmail,
    setSaleEmail,
    getAccessToken,
  } = useAdmin();
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
  // Record whose Interest cell is expanded to show its daily history.
  const [interestDetailId, setInterestDetailId] = useState<number | null>(null);
  const [interestFilter, setInterestFilter] =
    useState<InterestFilter>("all");
  const [letterFilter, setLetterFilter] = useState<string | null>(null);
  const [shownFilter, setShownFilter] = useState<"all" | "shown" | "hidden">(
    "all"
  );
  const [soldFilter, setSoldFilter] = useState<"all" | "sold" | "unsold">(
    "all"
  );
  const [discogsStatus, setDiscogsStatus] = useState<Record<number, string>>({});
  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(new Set());
  function toggleRowExpanded(id: number) {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [collapsedSections, setCollapsedSections] = useState<Set<SectionKey>>(
    () => {
      if (typeof window === "undefined") return new Set();
      try {
        const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_KEY);
        // First visit: open just the inbox so the page reads as one task.
        if (raw === null) return new Set(SECTIONS.filter((k) => k !== "requests"));
        const saved = JSON.parse(raw);
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

  // Show one section on its own: collapse the rest, then scroll its heading
  // under the jump nav. The per-heading chevrons and "Expand all" still let
  // several sections stay open side by side when that's useful.
  const showOnly = useCallback(
    (key: SectionKey) => {
      setCollapsed(new Set(SECTIONS.filter((k) => k !== key)));
      setTimeout(() => {
        document
          .getElementById(`section-${key}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    },
    [setCollapsed]
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
    setSaving(r.id, true);
    const { data: parcels, error: parcelErr } = await supabase
      .from("shipments")
      .select("id")
      .contains("record_ids", [r.id]);
    setSaving(r.id, false);
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
    setSaving(r.id, true);
    const paths = (r.photo_urls ?? [])
      .map((url) => url.split("/record-photos/")[1])
      .filter((p): p is string => !!p)
      .map((p) => decodeURIComponent(p));
    if (paths.length > 0) {
      await supabase.storage.from("record-photos").remove(paths);
    }
    const { error } = await supabase.from("records").delete().eq("id", r.id);
    setSaving(r.id, false);
    if (error) {
      pushToast("error", `Delete failed: ${error.message}`);
      return;
    }
    setRecords((prev) => prev.filter((x) => x.id !== r.id));
    setPending((prev) => prev.filter((x) => x.record_id !== r.id));
    pushToast("success", `Deleted "${r.artist} — ${r.title}"`);
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

  // Shared by the per-record flow and the bulk "remove all sold" button.
  // "gone" means Discogs already doesn't have it — success for our purposes.
  async function discogsRemoveRequest(
    releaseId: number
  ): Promise<{ outcome: "removed" | "gone" | "failed"; error?: string }> {
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
        body: JSON.stringify({ releaseId }),
      });
      if (res.ok) return { outcome: "removed" };
      const body = await res.json();
      if (res.status === 404) return { outcome: "gone", error: body.error };
      return { outcome: "failed", error: body.error || "Failed" };
    } catch {
      return { outcome: "failed", error: "Request failed" };
    }
  }

  // Persists that the copy is out of the Discogs collection so the bulk
  // button can skip it on later runs. Deliberately quiet — no toast, and a
  // failure just means the record gets retried (and 404s) next time.
  async function flagDiscogsRemoved(id: number) {
    const { error } = await supabase
      .from("records")
      .update({ discogs_removed: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) {
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, discogs_removed: true } : r))
      );
    }
  }

  async function removeFromDiscogs(r: DbRecord) {
    if (!r.discogs_release_id) return;
    setDiscogsStatus((prev) => ({ ...prev, [r.id]: "Removing…" }));
    const { outcome, error } = await discogsRemoveRequest(r.discogs_release_id);
    setDiscogsStatus((prev) => ({
      ...prev,
      [r.id]:
        outcome === "removed"
          ? "Removed from Discogs ✓"
          : outcome === "gone"
            ? "Already gone from Discogs ✓"
            : error || "Failed",
    }));
    if (outcome !== "failed") await flagDiscogsRemoved(r.id);
  }

  const [discogsBulkBusy, setDiscogsBulkBusy] = useState(false);
  const [discogsBulkStatus, setDiscogsBulkStatus] = useState("");
  const discogsBulkCancel = useRef(false);

  async function removeAllSoldFromDiscogs() {
    const targets = records.filter(
      (r) => r.sold && r.discogs_release_id && !r.discogs_removed
    );
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `Remove ${targets.length} sold record${targets.length === 1 ? "" : "s"} from your Discogs collection? This paces itself for Discogs' rate limit, so it takes about 2 seconds per record.`
      )
    )
      return;
    setDiscogsBulkBusy(true);
    discogsBulkCancel.current = false;
    let removed = 0;
    let gone = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (discogsBulkCancel.current) break;
        const r = targets[i];
        setDiscogsBulkStatus(
          `Removing ${i + 1}/${targets.length}: ${r.artist} — ${r.title}`
        );
        setDiscogsStatus((prev) => ({ ...prev, [r.id]: "Removing…" }));
        const { outcome, error } = await discogsRemoveRequest(
          r.discogs_release_id!
        );
        if (outcome === "removed") removed++;
        else if (outcome === "gone") gone++;
        else failed++;
        setDiscogsStatus((prev) => ({
          ...prev,
          [r.id]:
            outcome === "removed"
              ? "Removed from Discogs ✓"
              : outcome === "gone"
                ? "Already gone from Discogs ✓"
                : error || "Failed",
        }));
        if (outcome !== "failed") await flagDiscogsRemoved(r.id);
        // Each removal is two Discogs API calls; ~2s keeps us under the
        // 60-requests-per-minute token limit.
        if (i < targets.length - 1 && !discogsBulkCancel.current) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } finally {
      setDiscogsBulkBusy(false);
      setDiscogsBulkStatus("");
    }
    const parts = [
      `${removed} removed`,
      ...(gone > 0 ? [`${gone} already gone`] : []),
      ...(failed > 0 ? [`${failed} failed`] : []),
      ...(discogsBulkCancel.current ? ["stopped early"] : []),
    ];
    pushToast(failed > 0 ? "error" : "success", `Discogs cleanup: ${parts.join(", ")}.`);
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

  // Hiding is reversible, so it gets an Undo toast rather than a confirm.
  async function toggleListed(r: DbRecord, listed: boolean) {
    const ok = await updateRecord(r.id, { listed });
    if (!ok || listed) return;
    pushToast("info", `Hidden "${r.artist} — ${r.title}" from the shop`, {
      label: "Undo",
      onClick: () => updateRecord(r.id, { listed: true }),
    });
  }

  async function releaseHold(r: DbRecord) {
    if (
      !window.confirm(
        `Release the hold on "${r.artist} — ${r.title}" for u/${r.hold_buyer}? It goes back on the shop immediately.`
      )
    )
      return;
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
    if (!sold) {
      await updateRecord(r.id, { sold: false, sold_at: null });
      return;
    }
    // Selling goes through the same path as the sale desk, so the row
    // checkbox also records the sold price, carries a hold's buyer over,
    // closes the matching order request and offers the Discogs removal.
    setSaving(r.id, true);
    try {
      await markRecordsSold([r], "");
    } finally {
      setSaving(r.id, false);
    }
  }

  const dailyStrip = useMemo(() => {
    const byKey = new Map(bucketEventsByDay(events).map((d) => [d.key, d]));
    const out: DayBucket[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = localDayKey(d);
      out.push(
        byKey.get(key) ?? {
          key,
          label: dayLabel(key),
          clicks: 0,
          looked: 0,
          asked: 0,
        }
      );
    }
    return out;
  }, [events]);
  const stripMax = Math.max(1, ...dailyStrip.map((d) => d.looked));

  // Daily history for the one record whose Interest cell is expanded.
  const interestDetailDays = useMemo(
    () =>
      interestDetailId == null
        ? []
        : bucketEventsByDay(
            events.filter((e) => e.record_id === interestDetailId)
          ),
    [interestDetailId, events]
  );

  // Same heuristic as the email: a cut worth acting on is modest (≤30%)
  // with several copies competing, or any cut on a stocked release (30+
  // copies — the price run chases the cheapest listing there); everything
  // else is likely condition noise, a scarce copy, or a suggestion-based
  // increase.
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
      if (soldFilter === "sold" && !r.sold) return false;
      if (soldFilter === "unsold" && r.sold) return false;
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
      if (interestFilter === "manual-off-market") {
        const sugg = market[r.id]?.suggested;
        if (!r.manual_price || r.sold || !r.listed || !sugg) return false;
        const ratio = r.price / sugg;
        if (ratio <= OFF_MARKET_HIGH && ratio >= OFF_MARKET_LOW) return false;
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
  }, [records, search, sortBy, genreFilter, collectionFilter, letterFilter, shownFilter, soldFilter, interestFilter, interest, market]);

  // --- Sale desk: multi-select records for a Reddit-DM sale ---
  // selectedIds / selectionMode / saleBuyer / saleEmail live in the admin
  // provider so the selection survives navigating between admin pages.
  // Weekly mode swaps the sticky sale-desk box for a slim picks bar so
  // random picks don't look like a pending sale. Only explicit actions
  // change the mode — checkbox toggles keep it.
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
    setSelectionMode("sale");
    setSaleBuyer("");
    setSaleEmail("");
    setSaleStatus("");
    setSaleInvoice(null);
  }

  async function copySaleReply() {
    if (saleRecords.length === 0) return;
    const buyer = saleBuyer.trim().replace(/^u\//, "");
    const { lines, subtotal, shipping, total } = saleTotals;
    const text = `${buyer ? `Hi u/${buyer}!` : "Hi!"} Here's the breakdown for the records you asked about:\n\n${lines.join(
      "\n"
    )}\n\nSubtotal: $${subtotal}\nShipping: $${shipping}${shipping === 0 ? ` (free on ${FREE_SHIPPING_MIN}+ records)` : ""}\nTotal: $${total}\n\nPayment is PayPal G&S invoice — I cover the fee. Reply with your PayPal email and I'll send the invoice there, or I can post a payment link here.`;
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
      await markRecordsSold(targets, buyer);
    } finally {
      setSaleBusy(null);
    }
  }

  // The shared mark-sold path: sale desk and a paid pending invoice both
  // land here. Writes sold/price/buyer, clears holds, closes finished
  // order requests, and offers the Discogs removal. No confirm — callers
  // decide whether one is needed.
  async function markRecordsSold(targets: DbRecord[], buyer: string) {
    if (targets.length === 0) return;
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
        (r) => doneSet.has(r.id) && r.discogs_release_id && !r.discogs_removed
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
      // The route stamps paypal_invoice_id + a 48h hold on the records —
      // mirror it locally so the pending card and fulfillment panel link
      // up without a reload, but only when the stamp actually landed
      // (otherwise the panel would show a link that vanishes on reload).
      if (body.invoiceStamped !== false) {
        const invoicedIds = new Set(targets.map((r) => r.id));
        setRecords((prev) =>
          prev.map((r) =>
            invoicedIds.has(r.id)
              ? {
                  ...r,
                  paypal_invoice_id: body.invoiceId,
                  hold_buyer: buyer,
                  hold_until: body.holdUntil ?? r.hold_until,
                }
              : r
          )
        );
      }
      // The saved pending-order row keeps the payment link after Clear.
      if (body.invoice) upsertInvoiceLocal(body.invoice as Invoice);
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
  // Invoices sent but not paid, each with the unsold records it covers.
  // This is the durable "order in progress": it survives clearing the
  // sale desk, and disappears once its records are marked sold (the
  // group then shows up in Fulfillment) or the invoice is cancelled.
  const pendingInvoices = useMemo(() => {
    const byInvoice = new Map<string, DbRecord[]>();
    for (const r of records) {
      if (r.sold || !r.paypal_invoice_id) continue;
      const list = byInvoice.get(r.paypal_invoice_id);
      if (list) list.push(r);
      else byInvoice.set(r.paypal_invoice_id, [r]);
    }
    return invoices
      .filter((inv) => !inv.paid_at && inv.status !== "CANCELLED")
      .map((inv) => {
        // Prefer the live stamp; fall back to the ids saved at creation
        // for invoices whose stamp never landed.
        let recs = byInvoice.get(inv.paypal_invoice_id) ?? [];
        if (recs.length === 0 && inv.record_ids?.length) {
          recs = inv.record_ids
            .map((id) => byId.get(id))
            .filter((r): r is DbRecord => !!r && !r.sold);
        }
        const holdUntil = recs.reduce(
          (max, r) =>
            r.hold_until ? Math.max(max, new Date(r.hold_until).getTime()) : max,
          0
        );
        return {
          invoice: inv,
          buyer: (inv.buyer_username ?? recs[0]?.hold_buyer ?? "").trim(),
          recs,
          totals: bundleBreakdown(recs),
          holdUntil,
        };
      })
      .filter((p) => p.recs.length > 0)
      .sort((a, b) => b.invoice.created_at.localeCompare(a.invoice.created_at));
  }, [invoices, records, byId]);
  const pendingInvoiceIds = useMemo(
    () => new Set(pendingInvoices.map((p) => p.invoice.paypal_invoice_id)),
    [pendingInvoices]
  );

  // active hold, grouped per buyer. Records covered by a pending invoice
  // are listed under that invoice instead, so an order shows once.
  const activeHolds = useMemo(() => {
    const groups = new Map<string, DbRecord[]>();
    for (const r of records) {
      if (r.sold || !holdActive(r)) continue;
      if (r.paypal_invoice_id && pendingInvoiceIds.has(r.paypal_invoice_id)) continue;
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
  }, [records, pendingInvoiceIds]);

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
    setSelectionMode("sale");
    showOnly("listings");
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
    // Seed the buyer field from what the buyer typed on the shop, without
    // clobbering a name the admin already entered.
    if (req.buyer_username) {
      const name = req.buyer_username;
      setSaleBuyer((prev) => (prev.trim() ? prev : name));
    }
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

  // --- Pending invoices: sent-but-unpaid orders ---
  const [pendingBusy, setPendingBusy] = useState<null | {
    id: string;
    action: "check" | "cancel";
  }>(null);
  const [pendingCopiedId, setPendingCopiedId] = useState<string | null>(null);

  function loadPendingIntoSaleDesk(p: { buyer: string; recs: DbRecord[] }) {
    if (!applySaleSelection(p.recs.map((r) => r.id))) return;
    setSaleBuyer((prev) => (prev.trim() ? prev : p.buyer));
  }

  async function copyPendingLink(inv: Invoice) {
    if (!inv.recipient_view_url) return;
    if (await copyText(inv.recipient_view_url, "Copy the payment link")) {
      setPendingCopiedId(inv.paypal_invoice_id);
      setTimeout(() => setPendingCopiedId(null), 1600);
    }
  }

  async function pendingInvoiceFetch(id: string, method: "GET" | "DELETE") {
    const {
      data: { session: current },
    } = await supabase.auth.getSession();
    const res = await fetch(
      `/api/paypal-invoice?id=${encodeURIComponent(id)}`,
      {
        method,
        headers: { Authorization: `Bearer ${current?.access_token ?? ""}` },
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Ask PayPal where the invoice stands. Paid → the records are marked
  // sold to the buyer right away and the order moves to Fulfillment.
  async function checkPendingInvoice(p: {
    invoice: Invoice;
    buyer: string;
    recs: DbRecord[];
  }) {
    const id = p.invoice.paypal_invoice_id;
    if (pendingBusy) return;
    setPendingBusy({ id, action: "check" });
    try {
      const body = await pendingInvoiceFetch(id, "GET");
      if (body.invoice) upsertInvoiceLocal(body.invoice as Invoice);
      if (body.paid) {
        pushToast(
          "success",
          `Invoice ${id} is ${body.status} ✓ — marking ${p.recs.length} record${p.recs.length === 1 ? "" : "s"} sold to u/${p.buyer || "?"}`
        );
        await markRecordsSold(p.recs, p.buyer);
      } else {
        pushToast(
          "info",
          `Invoice ${id}: not paid yet (${body.status}).${
            body.recipientViewUrl && !p.invoice.recipient_view_url
              ? " Payment link saved."
              : ""
          }`
        );
      }
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "PayPal check failed");
    } finally {
      setPendingBusy(null);
    }
  }

  // Cancel on PayPal and put the records back on the shelf.
  async function cancelPendingInvoice(p: {
    invoice: Invoice;
    buyer: string;
    recs: DbRecord[];
  }) {
    const id = p.invoice.paypal_invoice_id;
    if (pendingBusy) return;
    if (
      !window.confirm(
        `Cancel invoice ${id}${p.buyer ? ` for u/${p.buyer}` : ""} on PayPal and release ${p.recs.length} record${p.recs.length === 1 ? "" : "s"}? The buyer's payment link stops working.`
      )
    )
      return;
    setPendingBusy({ id, action: "cancel" });
    try {
      const body = await pendingInvoiceFetch(id, "DELETE");
      const released = new Set<number>(body.releasedIds ?? []);
      const now = new Date().toISOString();
      setInvoices((prev) =>
        prev.map((i) =>
          i.paypal_invoice_id === id
            ? { ...i, status: "CANCELLED", cancelled_at: now, updated_at: now }
            : i
        )
      );
      setRecords((prev) =>
        prev.map((r) =>
          released.has(r.id)
            ? { ...r, paypal_invoice_id: null, hold_buyer: null, hold_until: null }
            : r
        )
      );
      pushToast("success", `Invoice ${id} cancelled — ${released.size} record${released.size === 1 ? "" : "s"} released.`);
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setPendingBusy(null);
    }
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
    const typedBuyer = parseResult?.refRequest?.buyer_username;
    if (typedBuyer) setSaleBuyer((prev) => (prev.trim() ? prev : typedBuyer));
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
    const plural = ids.length === 1 ? "" : "s";
    if (
      !window.confirm(
        field === "sold" && value
          ? `Mark all ${ids.length} unsold record${plural} in the current filter as sold? Each keeps its hold buyer (if any), records its current price as the sold price, and you'll be offered the Discogs removal once.`
          : `Set ${label} ${value ? "ON" : "OFF"} for all ${ids.length} record${plural} in the current filter?`
      )
    )
      return;
    if (field === "sold" && value) {
      setBulkSaving(true);
      try {
        await markRecordsSold(
          filteredRecords.filter((r) => !r.sold),
          ""
        );
      } finally {
        setBulkSaving(false);
      }
      return;
    }
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

  return (
    <>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Records Admin</h1>
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
        </div>

        {/* Section jump nav — the page is long; this stays pinned on scroll */}
        <nav
          aria-label="Page sections"
          className="sticky top-0 z-20 mt-6 flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-neutral-950/95 p-2 backdrop-blur"
        >
          {(
            [
              ["requests", "Requests", orderRequests.length],
              ["listings", "Listings", records.length],
              ["fulfillment", "Fulfillment", draftParcelCount],
              ["add", "Add"],
            ] as [SectionKey, string, number?][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => showOnly(key)}
              aria-current={collapsedSections.has(key) ? undefined : "true"}
              title="Show this section on its own"
              className={`rounded-lg border px-2.5 py-1 text-xs transition hover:bg-white hover:text-black ${
                collapsedSections.has(key)
                  ? "border-white/10"
                  : "border-white/40 bg-white/10"
              } ${
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

        {/* Interest by day — daily distinct shoppers across all listings */}
        {events.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-neutral-400">Interest by day</p>
              <p className="text-xs text-neutral-500">
                {dailyStrip.reduce((n, d) => n + d.looked, 0)} looked ·{" "}
                {dailyStrip.reduce((n, d) => n + d.asked, 0)} asked in the last
                14 days · <span className="text-green-400">●</span> = buy
                request
              </p>
            </div>
            <div className="mt-3 flex items-end gap-1.5">
              {dailyStrip.map((d) => (
                <div
                  key={d.key}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  title={`${d.label} · ${d.looked} looked · ${d.clicks} clicks · ${d.asked} asked`}
                >
                  <div className="flex h-16 w-full max-w-8 items-end">
                    <div
                      className={`w-full rounded-t ${
                        d.looked > 0 ? "bg-neutral-300" : "bg-white/10"
                      }`}
                      style={{
                        height:
                          d.looked > 0
                            ? `${Math.max(10, (d.looked / stripMax) * 100)}%`
                            : "2px",
                      }}
                    />
                  </div>
                  <div className="h-1.5">
                    {d.asked > 0 ? (
                      <div className="mx-auto h-1.5 w-1.5 rounded-full bg-green-400" />
                    ) : null}
                  </div>
                  <p className="text-[10px] leading-none text-neutral-500">
                    {d.key.slice(8).replace(/^0/, "")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
                        {req.buyer_username ? (
                          <span className="text-sm text-white">
                            u/{req.buyer_username}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-500">
                            no username given
                          </span>
                        )}
                        {req.record_ids.some((id) => {
                          const inv = byId.get(id)?.paypal_invoice_id;
                          return !!inv && pendingInvoiceIds.has(inv);
                        }) ? (
                          <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-300">
                            invoice sent
                          </span>
                        ) : null}
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

            {pendingInvoices.length > 0 ? (
              <>
                <h3 className="mt-8 text-lg font-medium">Pending invoices</h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Invoices sent but not paid. Clear the sale desk freely —
                  these stay here with the payment link. Check PayPal marks
                  the records sold the moment it reports paid.
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {pendingInvoices.map((p) => {
                    const inv = p.invoice;
                    const id = inv.paypal_invoice_id;
                    const busy = pendingBusy?.id === id ? pendingBusy.action : null;
                    const hoursLeft = Math.round((p.holdUntil - Date.now()) / 3600000);
                    const status = (inv.status ?? "SENT").toLowerCase();
                    return (
                      <div
                        key={id}
                        className="rounded-2xl border border-emerald-500/30 bg-white/5 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">
                            {p.buyer ? `u/${p.buyer}` : "(no buyer name)"}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              status === "draft"
                                ? "border-white/15 text-neutral-400"
                                : "border-emerald-500/40 text-emerald-300"
                            }`}
                          >
                            invoice {status}
                          </span>
                          <span className="font-mono text-xs text-neutral-500">
                            {id}
                          </span>
                          <span className="ml-auto text-xs text-neutral-500">
                            {timeAgo(inv.created_at)}
                            {" · "}
                            {p.holdUntil > Date.now() ? (
                              `~${hoursLeft}h hold left`
                            ) : (
                              <span className="text-amber-400">
                                {p.holdUntil ? "hold expired" : "not on hold"}
                              </span>
                            )}
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1 text-sm">
                          {p.recs.map((r) => (
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
                          Subtotal ${p.totals.subtotal} · Shipping $
                          {p.totals.shipping} ·{" "}
                          <span className="font-medium text-white">
                            Total ${inv.total ?? p.totals.total}
                          </span>
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {inv.recipient_view_url ? (
                            <>
                              <button
                                type="button"
                                className={buttonClass}
                                onClick={() => copyPendingLink(inv)}
                              >
                                {pendingCopiedId === id
                                  ? "Copied!"
                                  : "Copy payment link"}
                              </button>
                              <a
                                href={inv.recipient_view_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-neutral-400 underline hover:text-white"
                              >
                                Open ↗
                              </a>
                            </>
                          ) : (
                            <span className="text-xs text-neutral-500">
                              No payment link saved — Check PayPal fetches it.
                            </span>
                          )}
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={!!pendingBusy}
                            onClick={() => checkPendingInvoice(p)}
                          >
                            {busy === "check" ? "Checking…" : "Check PayPal"}
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => loadPendingIntoSaleDesk(p)}
                          >
                            Load into sale desk
                          </button>
                          <button
                            type="button"
                            className="text-xs text-neutral-500 underline transition hover:text-red-300 disabled:opacity-50"
                            disabled={!!pendingBusy}
                            onClick={() => cancelPendingInvoice(p)}
                          >
                            {busy === "cancel" ? "Cancelling…" : "Cancel invoice"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

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
                      {parseResult.refRequest.buyer_username
                        ? ` · u/${parseResult.refRequest.buyer_username}`
                        : ""}
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
              setInterestFilter(e.target.value as InterestFilter)
            }
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Interest: All</option>
            <option value="clicked-no-request">Clicked, no request</option>
            <option value="manual-off-market">
              Hand-priced, far from suggestion
            </option>
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
            value={soldFilter}
            onChange={(e) =>
              setSoldFilter(e.target.value as "all" | "sold" | "unsold")
            }
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Sold: All</option>
            <option value="sold">Sold only</option>
            <option value="unsold">Unsold only</option>
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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-neutral-500">
            {filteredRecords.length} of {records.length} records
          </p>
          {(() => {
            const soldOnDiscogs = records.filter(
              (r) => r.sold && r.discogs_release_id && !r.discogs_removed
            ).length;
            if (soldOnDiscogs === 0 && !discogsBulkBusy) return null;
            return discogsBulkBusy ? (
              <>
                <span className="text-sm text-amber-400">
                  {discogsBulkStatus}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    discogsBulkCancel.current = true;
                  }}
                  className="text-xs text-neutral-500 underline transition hover:text-white"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={removeAllSoldFromDiscogs}
                title="Removes every sold record that has a Discogs release id from your Discogs collection"
                className={buttonClass}
              >
                Remove {soldOnDiscogs} sold from Discogs
              </button>
            );
          })()}
        </div>
        {selectedIds.size > 0 && selectionMode === "weekly" ? (
          <div
            id="sale-desk"
            className="sticky top-12 z-10 mt-4 rounded-2xl border border-neutral-700 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">
                  {saleRecords.length} record{saleRecords.length === 1 ? "" : "s"}
                </span>{" "}
                <span className="text-neutral-400">
                  picked for the weekly post — adjust with the Sel checkboxes.
                </span>
              </p>
              <button
                type="button"
                onClick={clearSaleDesk}
                className="text-xs text-neutral-500 underline transition hover:text-white"
              >
                Clear
              </button>
            </div>
            {offFilterSelectedCount > 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                {offFilterSelectedCount} pick
                {offFilterSelectedCount === 1 ? " is" : "s are"} hidden by the
                current filters — clear filters to see them all.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/admin/reddit"
                className={buttonClass}
                title="The weekly post is built on the Reddit page from these picks"
              >
                Copy weekly post on Reddit page ({saleRecords.length})
              </Link>
              <button
                type="button"
                onClick={() => setSelectionMode("sale")}
                className={buttonClass}
                title="Treat this selection as a sale instead — opens the sale desk"
              >
                Open sale desk
              </button>
            </div>
          </div>
        ) : null}
        {selectedIds.size > 0 && selectionMode === "sale" ? (
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
                  {saleTotals.shipping}
                  {saleTotals.shipping === 0 ? " (free)" : ""} (
                  {saleTotals.parcels} parcel
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
                  {saleInvoice.warning
                    ? ""
                    : " Saved under Pending invoices — safe to Clear."}
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
        <div className="mt-4 max-h-[75vh] overflow-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[700px] text-sm">
            {/* Sticky header: the wrapper is the scroll container, so the th
                cells pin to its top. The bottom border lives in a shadow
                because collapsed-table borders don't travel with sticky
                cells in Chrome. */}
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-neutral-900 [&_th]:shadow-[inset_0_-1px_0_rgba(255,255,255,0.15)]">
              <tr className="text-left text-neutral-400">
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
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleRowExpanded(r.id)}
                          aria-expanded={expandedRowIds.has(r.id)}
                          title={
                            expandedRowIds.has(r.id)
                              ? "Hide details"
                              : "Edit genres, grades, notes, photos"
                          }
                          className={`mt-0.5 text-xs text-neutral-500 transition-transform hover:text-white ${
                            expandedRowIds.has(r.id) ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </button>
                        <div className="min-w-0">
                          <p className="font-medium text-white">
                            {r.artist} — {r.title}
                          </p>
                          <p className="text-xs text-neutral-500">{r.pressing}</p>
                          {expandedRowIds.has(r.id) ? null : (
                            <p className="mt-0.5 text-xs text-neutral-600">
                              {[
                                `${r.media}/${r.sleeve}`,
                                (r.genres ?? []).join(", ") || null,
                                r.collection || null,
                                (r.photo_urls ?? []).length
                                  ? `${(r.photo_urls ?? []).length} photo${(r.photo_urls ?? []).length === 1 ? "" : "s"}`
                                  : null,
                                (r.notes ?? "").trim() ? "notes" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                      {expandedRowIds.has(r.id) ? (
                        <>
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
                            disabled={savingIds.has(r.id)}
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
                            disabled={savingIds.has(r.id)}
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
                          disabled={savingIds.has(r.id)}
                          onClick={() => deleteRecord(r)}
                          title="Permanently delete this record — for copies that were never actually sold (e.g. no longer owned)"
                          className="text-neutral-500 underline underline-offset-2 transition hover:text-red-400"
                        >
                          Delete…
                        </button>
                      </p>
                        </>
                      ) : null}
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
                            disabled={savingIds.has(r.id)}
                            onClick={() => savePrice(r)}
                            className={buttonClass}
                          >
                            {savingIds.has(r.id) ? "…" : "Save"}
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
                          disabled={savingIds.has(r.id)}
                          onChange={(e) =>
                            updateRecord(r.id, {
                              manual_price: e.target.checked,
                            })
                          }
                          className="admin-checkbox"
                        />
                        manual
                      </label>
                      {market[r.id]?.suggested ? (
                        <p
                          className="mt-1 text-xs text-neutral-500"
                          title="Discogs price suggestion for this media grade, and the cheapest current listing — marked not comparable when it sits below half the grade suggestion (a junk copy, a non-US seller, or a foreign price converted to USD), in which case the price run ignores it"
                        >
                          sugg ${Math.round(market[r.id].suggested!)}
                          {market[r.id].lowest != null
                            ? ` · lowest $${Math.round(market[r.id].lowest!)}${
                                market[r.id].lowestPlausible === false
                                  ? " (not comparable)"
                                  : ""
                              }`
                            : ""}
                        </p>
                      ) : null}
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
                    <td className="px-3 py-3 whitespace-nowrap align-top">
                      {interest[r.id] ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setInterestDetailId((prev) =>
                                prev === r.id ? null : r.id
                              )
                            }
                            className="text-neutral-300 underline decoration-white/30 decoration-dotted underline-offset-4 transition hover:text-white"
                            title={`${interest[r.id].interest_events} clicks · ${interest[r.id].request_events} requests · last ${new Date(interest[r.id].last_event_at).toLocaleDateString()} — click for the day-by-day history`}
                          >
                            {interest[r.id].interest_sessions} looked
                            {interest[r.id].request_sessions > 0 ? (
                              <span className="text-green-400">
                                {" "}
                                · {interest[r.id].request_sessions} asked
                              </span>
                            ) : null}
                          </button>
                          {interestDetailId === r.id ? (
                            <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
                              <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                                By day · last 60 days
                              </p>
                              {interestDetailDays.length === 0 ? (
                                <p className="mt-1 text-neutral-500">
                                  No activity in the last 60 days
                                </p>
                              ) : (
                                <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1">
                                  {interestDetailDays.map((d) => (
                                    <li
                                      key={d.key}
                                      className="whitespace-nowrap text-neutral-400"
                                    >
                                      <span className="text-neutral-300">
                                        {d.label}
                                      </span>
                                      {d.looked > 0
                                        ? ` · ${d.looked} looked (${d.clicks} click${d.clicks === 1 ? "" : "s"})`
                                        : ""}
                                      {d.asked > 0 ? (
                                        <span className="text-green-400">
                                          {" "}
                                          · {d.asked} asked
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.listed}
                        disabled={savingIds.has(r.id)}
                        onChange={(e) => toggleListed(r, e.target.checked)}
                        className="admin-checkbox"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={r.sold}
                        disabled={savingIds.has(r.id)}
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
                                onClick={() => showOnly("fulfillment")}
                                title="The swap-bot trade confirmation for this order is copied from its Fulfillment card"
                                className="whitespace-nowrap text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                confirm in Fulfillment
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
                                onClick={() => showOnly("fulfillment")}
                                title="Tracking numbers are managed per parcel in the Fulfillment section"
                                className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                add tracking in Fulfillment
                              </button>
                            )}
                          </div>
                          {r.discogs_release_id ? (
                            <div className="flex items-center gap-2 text-xs">
                              {r.discogs_removed && !discogsStatus[r.id] ? (
                                <span className="text-green-400">
                                  Removed from Discogs ✓
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove "${r.artist} — ${r.title}" from your Discogs collection? This can't be undone from here.`
                                      )
                                    )
                                      removeFromDiscogs(r);
                                  }}
                                  className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                                >
                                  Remove from Discogs collection
                                </button>
                              )}
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
                            disabled={!holdBuyerInput.trim() || savingIds.has(r.id)}
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
            getAccessToken={getAccessToken}
            copyText={copyText}
            pushToast={pushToast}
            defaultThreadUrl={postUrl}
          />
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

    </>
  );
}
