"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type {
  DbRecord,
  Invoice,
  MarketSnapshotRow,
  OrderRequest,
  PendingPriceChange,
  PriceRun,
  RecordEventRow,
  RecordInterest,
  RedditPost,
  Shipment,
} from "@/lib/supabase";
import { latestMarket, loadSnapshots, type MarketMap } from "@/lib/admin/market";
import { holdActive } from "@/lib/admin/records";
import { useAdminSession } from "../admin-gate";
import type { Toast } from "./ui";

// Everything the admin pages share: the signed-in Supabase client, the
// loaded tables, the toast/clipboard helpers, and the sale-desk selection.
// It lives in the /admin layout, so it survives navigation between pages —
// select records on one page, invoice them on another.

export type PostedInfo = { ids: number[]; posted_at: string | null };
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

type AdminContextValue = {
  supabase: SupabaseClient;
  session: Session;
  getAccessToken: () => Promise<string>;

  records: DbRecord[];
  setRecords: Setter<DbRecord[]>;
  shipments: Shipment[];
  setShipments: Setter<Shipment[]>;
  invoices: Invoice[];
  setInvoices: Setter<Invoice[]>;
  pending: PendingPriceChange[];
  setPending: Setter<PendingPriceChange[]>;
  runs: PriceRun[];
  orderRequests: OrderRequest[];
  setOrderRequests: Setter<OrderRequest[]>;
  interest: Record<number, RecordInterest>;
  events: RecordEventRow[];
  market: MarketMap;
  redditPosts: RedditPost[];
  setRedditPosts: Setter<RedditPost[]>;
  postUrl: string;
  setPostUrl: Setter<string>;
  postedInfo: PostedInfo;
  setPostedInfo: Setter<PostedInfo>;

  loading: boolean;
  loadError: string;
  setLoadError: Setter<string>;
  loadData: () => Promise<void>;

  toasts: Toast[];
  pushToast: (kind: Toast["kind"], text: string, action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  clipboardFallback: { title: string; text: string } | null;
  setClipboardFallback: Setter<{ title: string; text: string } | null>;
  copyText: (text: string, fallbackTitle: string) => Promise<boolean>;

  // Rows with a save in flight, so two quick blur-saves on different rows
  // don't re-enable each other early.
  savingIds: Set<number>;
  setSaving: (id: number, on: boolean) => void;
  updateRecord: (id: number, patch: Partial<DbRecord>) => Promise<boolean>;
  upsertInvoiceLocal: (inv: Invoice) => void;
  byId: Map<number, DbRecord>;

  // Discogs collection removal, per record, with the last outcome per id.
  discogsStatus: Record<number, string>;
  setDiscogsStatus: Setter<Record<number, string>>;
  discogsRemoveRequest: (
    releaseId: number
  ) => Promise<{ outcome: "removed" | "gone" | "failed"; error?: string }>;
  flagDiscogsRemoved: (id: number) => Promise<void>;
  removeFromDiscogs: (r: DbRecord) => Promise<void>;
  // The one mark-sold path: sale desk, paid invoice, row and bulk checkboxes.
  markRecordsSold: (targets: DbRecord[], buyer: string) => Promise<void>;

  // Sale-desk selection. `selectionMode` says why records are selected:
  // the sale desk (default) or the weekly Reddit post.
  selectedIds: Set<number>;
  setSelectedIds: Setter<Set<number>>;
  selectionMode: "sale" | "weekly";
  setSelectionMode: Setter<"sale" | "weekly">;
  saleBuyer: string;
  setSaleBuyer: Setter<string>;
  saleEmail: string;
  setSaleEmail: Setter<string>;
  toggleSelected: (id: number) => void;
  clearSelection: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}

let toastSeq = 0;

export function AdminProvider({ children }: { children: ReactNode }) {
  const { supabase, session } = useAdminSession();

  const [records, setRecords] = useState<DbRecord[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pending, setPending] = useState<PendingPriceChange[]>([]);
  const [runs, setRuns] = useState<PriceRun[]>([]);
  const [orderRequests, setOrderRequests] = useState<OrderRequest[]>([]);
  const [interest, setInterest] = useState<Record<number, RecordInterest>>({});
  // Raw shopper events for the last 60 days, newest first (capped at 5000).
  const [events, setEvents] = useState<RecordEventRow[]>([]);
  const [market, setMarket] = useState<MarketMap>({});
  const [redditPosts, setRedditPosts] = useState<RedditPost[]>([]);
  const [postUrl, setPostUrl] = useState("");
  // What the last weekly post covered — mirrors settings.reddit_post_records.
  const [postedInfo, setPostedInfo] = useState<PostedInfo>({
    ids: [],
    posted_at: null,
  });

  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [clipboardFallback, setClipboardFallback] = useState<null | {
    title: string;
    text: string;
  }>(null);

  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const setSaving = useCallback((id: number, on: boolean) => {
    setSavingIds((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState<"sale" | "weekly">("sale");
  const [saleBuyer, setSaleBuyer] = useState("");
  const [saleEmail, setSaleEmail] = useState("");

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

  const getAccessToken = useCallback(async () => {
    const {
      data: { session: current },
    } = await supabase.auth.getSession();
    return current?.access_token ?? "";
  }, [supabase]);

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
      eventsRes,
      shipmentsRes,
      invoicesRes,
      snapshotsRes,
      redditPostsRes,
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
        .from("record_events")
        .select("record_id,event_type,session_id,created_at")
        .gte(
          "created_at",
          new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
        )
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("shipments")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("invoices").select("*"),
      loadSnapshots(supabase),
      supabase
        .from("reddit_posts")
        .select("*")
        .order("created_at", { ascending: false }),
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
    // The rest are non-fatal — an error leaves that panel empty, but say so
    // instead of failing silently.
    if (shipmentsRes.error) {
      pushToast("error", `Shipments didn't load: ${shipmentsRes.error.message}`);
    }
    if (interestRes.error) {
      pushToast("error", `Interest data didn't load: ${interestRes.error.message}`);
    }
    if (eventsRes.error) {
      pushToast("error", `Interest history didn't load: ${eventsRes.error.message}`);
    }
    if (invoicesRes.error) {
      pushToast("error", `Invoice costs didn't load: ${invoicesRes.error.message}`);
    }
    // Without market data, picks fall back to random order and the post
    // just omits the scarcity/demand callouts.
    if (snapshotsRes.error) {
      pushToast("error", `Market data didn't load: ${snapshotsRes.error.message}`);
    }
    setMarket(
      latestMarket((snapshotsRes.data ?? []) as unknown as MarketSnapshotRow[])
    );
    if (redditPostsRes.error) {
      pushToast("error", `Post archive didn't load: ${redditPostsRes.error.message}`);
    }
    setRedditPosts((redditPostsRes.data ?? []) as RedditPost[]);
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
    setInterest(
      Object.fromEntries(
        ((interestRes.data ?? []) as RecordInterest[]).map((x) => [
          x.record_id,
          x,
        ])
      )
    );
    setEvents((eventsRes.data ?? []) as RecordEventRow[]);
  }, [supabase, pushToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Flag this browser so the owner's own shop browsing isn't tracked.
  useEffect(() => {
    try {
      localStorage.setItem("cr_no_track", "1");
    } catch {}
  }, []);

  const updateRecord = useCallback(
    async (id: number, patch: Partial<DbRecord>) => {
      setSaving(id, true);
      const { error } = await supabase
        .from("records")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      setSaving(id, false);
      if (error) {
        pushToast("error", `Save failed: ${error.message}`);
        return false;
      }
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
      pushToast("success", "Saved ✓");
      return true;
    },
    [supabase, pushToast, setSaving]
  );

  const upsertInvoiceLocal = useCallback((inv: Invoice) => {
    setInvoices((prev) =>
      prev.some((i) => i.paypal_invoice_id === inv.paypal_invoice_id)
        ? prev.map((i) =>
            i.paypal_invoice_id === inv.paypal_invoice_id ? { ...i, ...inv } : i
          )
        : [...prev, inv]
    );
  }, []);

  const byId = useMemo(
    () => new Map(records.map((r) => [r.id, r])),
    [records]
  );
  const [discogsStatus, setDiscogsStatus] = useState<Record<number, string>>({});

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

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode("sale");
    setSaleBuyer("");
    setSaleEmail("");
  }

  const value: AdminContextValue = {
    supabase,
    session,
    getAccessToken,
    records,
    setRecords,
    shipments,
    setShipments,
    invoices,
    setInvoices,
    pending,
    setPending,
    runs,
    orderRequests,
    setOrderRequests,
    interest,
    events,
    market,
    redditPosts,
    setRedditPosts,
    postUrl,
    setPostUrl,
    postedInfo,
    setPostedInfo,
    loading,
    loadError,
    setLoadError,
    loadData,
    toasts,
    pushToast,
    dismissToast,
    clipboardFallback,
    setClipboardFallback,
    copyText,
    savingIds,
    setSaving,
    updateRecord,
    upsertInvoiceLocal,
    byId,
    discogsStatus,
    setDiscogsStatus,
    discogsRemoveRequest,
    flagDiscogsRemoved,
    removeFromDiscogs,
    markRecordsSold,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    saleBuyer,
    setSaleBuyer,
    saleEmail,
    setSaleEmail,
    toggleSelected,
    clearSelection,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
