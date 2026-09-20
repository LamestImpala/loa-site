"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LETTERS, artistLetter, bundleBreakdown } from "@/lib/records";
import type { DbRecord } from "@/lib/supabase";
import { HOLD_HOURS, holdExpiry } from "@/lib/admin/orders";
import { holdActive } from "@/lib/admin/records";
import { bucketEventsByDay } from "@/lib/admin/interest";
import { detectCollection } from "@/lib/admin/collection";
import {
  FILTER_PARAMS,
  filterRecords,
  filtersFromQuery,
  filtersToQuery,
  sortRecords,
  type InterestFilter,
  type SortKey,
} from "@/lib/admin/catalog-filter";
import { useAdmin, useSlice } from "../_shell/admin-provider";
import { CatalogRow } from "./catalog-row";
import { blurOnEnter, buttonClass, inputClass, pct } from "../_shell/ui";

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


// The catalog: every record, with filters, the listings table, per-record
// editing, holds, sold state, Discogs removal, and adding a record.
// Where this session last left the catalog's view, as a query string —
// the nav link is a bare /admin/catalog, so this is what brings the
// filters back after a trip to another admin page.
let lastCatalogQuery = "";

export function CatalogPage() {
  const router = useRouter();
  const {
    supabase,
    records,
    setRecords,
    setPending,
    interest,
    events,
    market,
    pushToast,
    savingIds,
    setSaving,
    updateRecord,
    discogsStatus,
    setDiscogsStatus,
    discogsRemoveRequest,
    flagDiscogsRemoved,
    removeFromDiscogs,
    markRecordsSold,
    confirm,
    placeOrder,
    ordersById,
    renameBuyer,
    releaseHold: releaseRecordHold,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    toggleSelected,
    clearSelection,
  } = useAdmin();

  // The view (search, filters, sort) starts from the URL — or, arriving
  // on a bare /admin/catalog, from where this session last left it — and
  // is written back as it changes, so a reload, a bookmark, and a trip to
  // the inbox and back all land on the same list.
  const searchParams = useSearchParams();
  const [initialView] = useState(() =>
    filtersFromQuery(
      FILTER_PARAMS.some((k) => searchParams.has(k))
        ? searchParams
        : new URLSearchParams(lastCatalogQuery)
    )
  );
  const [search, setSearch] = useState(initialView.filters.search);
  const [sortBy, setSortBy] = useState<SortKey>(initialView.sort);
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [buyerEdits, setBuyerEdits] = useState<Record<number, string>>({});
  const [soldPriceEdits, setSoldPriceEdits] = useState<Record<number, string>>({});
  const [genreRowEdits, setGenreRowEdits] = useState<Record<number, string>>({});
  const [collectionRowEdits, setCollectionRowEdits] = useState<Record<number, string>>({});
  const [notesEdits, setNotesEdits] = useState<Record<number, string>>({});
  const [genreFilter, setGenreFilter] = useState(initialView.filters.genre);
  const [collectionFilter, setCollectionFilter] = useState(
    initialView.filters.collection
  );
  const [interestFilter, setInterestFilter] = useState<InterestFilter>(
    initialView.filters.interest
  );
  const [letterFilter, setLetterFilter] = useState<string | null>(
    initialView.filters.letter
  );
  const [shownFilter, setShownFilter] = useState<"all" | "shown" | "hidden">(
    initialView.filters.shown
  );
  const [soldFilter, setSoldFilter] = useState<"all" | "sold" | "unsold">(
    initialView.filters.sold
  );
  const viewQuery = useMemo(
    () =>
      filtersToQuery(
        {
          search,
          genre: genreFilter,
          collection: collectionFilter,
          letter: letterFilter,
          shown: shownFilter,
          sold: soldFilter,
          interest: interestFilter,
        },
        sortBy
      ).toString(),
    [search, genreFilter, collectionFilter, letterFilter, shownFilter, soldFilter, interestFilter, sortBy]
  );
  // history.replaceState keeps useSearchParams in sync without a
  // navigation, so typing in the search box never re-routes.
  useEffect(() => {
    lastCatalogQuery = viewQuery;
    const next = new URLSearchParams(viewQuery);
    const record = new URLSearchParams(window.location.search).get("record");
    if (record) next.set("record", record);
    const qs = next.toString();
    if (qs === window.location.search.replace(/^\?/, "")) return;
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [viewQuery]);
  // The record open in the details drawer, from ?record=ID so a drawer can
  // be linked to (and survives a reload). Replaced, not pushed, so the
  // back button leaves the catalog rather than walking through records.
  const openId = Number(searchParams.get("record")) || null;
  // Interest counts and Discogs context feed the table; raw events only
  // matter once a drawer opens (its day-by-day history).
  useSlice("interest");
  useSlice("market");
  useSlice("events", openId != null);
  const openRecord = useMemo(
    () => (openId == null ? null : records.find((r) => r.id === openId) ?? null),
    [records, openId]
  );
  const openDrawer = useCallback(
    (id: number | null) => {
      // Keep the view's params; only ?record= changes.
      const next = new URLSearchParams(window.location.search);
      if (id == null) next.delete("record");
      else next.set("record", String(id));
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    []
  );
  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, openDrawer]);

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
      !(await confirm(
        `Delete this photo of "${r.artist} — ${r.title}" permanently? It can't be undone.`
      ))
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
      !(await confirm(
        `Delete "${r.artist} — ${r.title}" permanently? Its photos and price history go with it. Meant for records that were never actually sold — this can't be undone.`
      ))
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

  // Row and drawer price fields share these; the row passes its own draft
  // so the callback stays stable while other rows are being edited.
  const setPriceDraft = useCallback((id: number, value: string) => {
    setPriceEdits((prev) => ({ ...prev, [id]: value }));
  }, []);
  const savePrice = useCallback(
    async (r: DbRecord, raw: string | undefined) => {
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
    },
    [pushToast, updateRecord]
  );

  // The buyer's name lives on the order when there is one, so the rename
  // reaches every record and parcel in it; orderless sales edit the row.
  async function saveBuyer(r: DbRecord) {
    const value = (buyerEdits[r.id] ?? "").trim().replace(/^u\//, "");
    if (value === (r.buyer_username ?? "")) return;
    const order = r.order_id != null ? ordersById.get(r.order_id) : null;
    if (order) await renameBuyer(order, value);
    else await updateRecord(r.id, { buyer_username: value });
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

  const [discogsBulkBusy, setDiscogsBulkBusy] = useState(false);
  const [discogsBulkStatus, setDiscogsBulkStatus] = useState("");
  const discogsBulkCancel = useRef(false);

  async function removeAllSoldFromDiscogs() {
    const targets = records.filter(
      (r) => r.sold && r.discogs_release_id && !r.discogs_removed
    );
    if (targets.length === 0) return;
    if (
      !(await confirm(
        `Remove ${targets.length} sold record${targets.length === 1 ? "" : "s"} from your Discogs collection? This paces itself for Discogs' rate limit, so it takes about 2 seconds per record.`
      ))
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
    // Same path as the desk's hold: the order is what lists it under the
    // inbox's Open orders.
    if (!(await placeOrder([r], buyer, "held"))) return;
    const ok = await updateRecord(r.id, {
      hold_buyer: buyer,
      hold_until: holdExpiry(),
    });
    if (ok) {
      setHoldEditId(null);
      setHoldBuyerInput("");
    }
  }

  // Hiding is reversible, so it gets an Undo toast rather than a confirm.
  const toggleListed = useCallback(
    async (r: DbRecord, listed: boolean) => {
      const ok = await updateRecord(r.id, { listed });
      if (!ok || listed) return;
      pushToast("info", `Hidden "${r.artist} — ${r.title}" from the shop`, {
        label: "Undo",
        onClick: () => updateRecord(r.id, { listed: true }),
      });
    },
    [pushToast, updateRecord]
  );

  async function releaseHold(r: DbRecord) {
    if (
      !(await confirm(
        `Release the hold on "${r.artist} — ${r.title}" for u/${r.hold_buyer}? It goes back on the shop immediately.`
      ))
    )
      return;
    await releaseRecordHold(r);
  }

  async function markSold(r: DbRecord, sold: boolean) {
    // Un-selling erases the sale date — make sure it's deliberate.
    if (
      !sold &&
      !(await confirm(
        `Un-mark "${r.artist} — ${r.title}" as sold? This clears its sold date.`
      ))
    )
      return;
    // Un-selling takes the record out of its order too.
    if (!sold) {
      await updateRecord(r.id, {
        sold: false,
        sold_at: null,
        order_id: null,
        negotiated_price: null,
        picked_at: null,
      });
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

  // Daily history for the record open in the drawer.
  const interestDetailDays = useMemo(
    () =>
      openId == null
        ? []
        : bucketEventsByDay(events.filter((e) => e.record_id === openId)),
    [openId, events]
  );

  const filteredRecords = useMemo(
    () =>
      sortRecords(
        filterRecords(
          records,
          {
            search,
            genre: genreFilter,
            collection: collectionFilter,
            letter: letterFilter,
            shown: shownFilter,
            sold: soldFilter,
            interest: interestFilter,
          },
          { interest, market }
        ),
        sortBy,
        interest
      ),
    [records, search, sortBy, genreFilter, collectionFilter, letterFilter, shownFilter, soldFilter, interestFilter, interest, market]
  );

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
      !(await confirm(
        field === "sold" && value
          ? `Mark all ${ids.length} unsold record${plural} in the current filter as sold? Each keeps its hold buyer (if any), records its current price as the sold price, and you'll be offered the Discogs removal once.`
          : `Set ${label} ${value ? "ON" : "OFF"} for all ${ids.length} record${plural} in the current filter?`
      ))
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
      <h1 className="mt-6 text-3xl font-semibold">Catalog</h1>
        {/* Records editor */}
        <h2 className="mt-12 text-xl font-medium">
            Listings{" "}
            <span className="text-sm text-neutral-400">
              ({records.length} records)
            </span>
        </h2>
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
                onClick={clearSelection}
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
            className="sticky top-2 z-10 mt-4 rounded-2xl border border-amber-400/30 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">
                  {saleRecords.length} record{saleRecords.length === 1 ? "" : "s"}
                </span>{" "}
                <span className="text-neutral-400">
                  selected for the sale desk · Subtotal ${saleTotals.subtotal}
                  {saleSoldCount > 0
                    ? ` · ${saleSoldCount} already sold`
                    : ""}
                </span>
              </p>
              <div className="flex items-center gap-3">
                <Link
                  href="/admin"
                  className={buttonClass}
                  title="Copy the reply, hold, mark sold or invoice these on the Inbox page"
                >
                  Open sale desk
                </Link>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-neutral-500 underline transition hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
            {offFilterSelectedCount > 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                {offFilterSelectedCount} selected record
                {offFilterSelectedCount === 1 ? " is" : "s are"} hidden by the
                current filters but still included.
              </p>
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
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-neutral-500"
                  >
                    No records match the current filters — try clearing the
                    search or a filter above.
                  </td>
                </tr>
              ) : null}
              {filteredRecords.map((r) => (
                <CatalogRow
                  key={r.id}
                  r={r}
                  selected={selectedIds.has(r.id)}
                  isOpen={openId === r.id}
                  saving={savingIds.has(r.id)}
                  priceDraft={priceEdits[r.id]}
                  stats={market[r.id]}
                  interest={interest[r.id]}
                  onToggleSelected={toggleSelected}
                  onOpen={openDrawer}
                  onDraftPrice={setPriceDraft}
                  onSavePrice={savePrice}
                  onToggleListed={toggleListed}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Record details drawer — one record at a time, deep-linked via ?record= */}
        {openRecord
          ? (() => {
              const r = openRecord;
              const edited =
                priceEdits[r.id] !== undefined &&
                priceEdits[r.id] !== String(r.price);
              return (
                <aside
                  role="dialog"
                  aria-label={`${r.artist} — ${r.title}`}
                  className="fixed inset-y-0 right-0 z-40 flex w-[460px] max-w-full flex-col overflow-y-auto border-l border-white/15 bg-neutral-950 p-5 shadow-2xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {r.cover_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.cover_image}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-medium text-white">
                          {r.artist} — {r.title}
                        </p>
                        <p className="text-xs text-neutral-500">{r.pressing}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDrawer(null)}
                      aria-label="Close"
                      title="Close (Esc)"
                      className="text-xl leading-none text-neutral-500 transition hover:text-white"
                    >
                      ×
                    </button>
                  </div>

                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-neutral-500">
                    Listing
                  </h3>
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

                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-neutral-500">
                    Pricing
                  </h3>
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
                            if (e.key === "Enter" && edited) savePrice(r, priceEdits[r.id]);
                          }}
                          className={`w-20 ${inputClass}`}
                        />
                        {edited ? (
                          <button
                            type="button"
                            disabled={savingIds.has(r.id)}
                            onClick={() => savePrice(r, priceEdits[r.id])}
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

                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-neutral-500">
                    Sale
                  </h3>
                  <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
                    <input
                      type="checkbox"
                      checked={r.sold}
                      disabled={savingIds.has(r.id)}
                      onChange={(e) => markSold(r, e.target.checked)}
                      className="admin-checkbox"
                    />
                    Sold
                  </label>
                  <div className="mt-2">
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
                                onClick={() => router.push("/admin")}
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
                                onClick={() => router.push("/admin")}
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
                                  onClick={async () => {
                                    if (
                                      (await confirm(
                                        `Remove "${r.artist} — ${r.title}" from your Discogs collection? This can't be undone from here.`
                                      ))
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
                            Hold {HOLD_HOURS}h
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
                          title={`Reserve for a buyer for ${HOLD_HOURS} hours — the public card shows On hold, and the hold lists under Open orders`}
                          className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          Hold…
                        </button>
                      )}
                  </div>

                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-neutral-500">
                    Interest
                  </h3>
                  {interest[r.id] ? (
                    <p className="mt-1 text-sm text-neutral-300">
                      {interest[r.id].interest_sessions} looked
                      {interest[r.id].request_sessions > 0
                        ? ` · ${interest[r.id].request_sessions} asked`
                        : ""}{" "}
                      <span className="text-xs text-neutral-500">
                        · last {new Date(interest[r.id].last_event_at).toLocaleDateString()}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-500">No shopper activity yet.</p>
                  )}
                          {(
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
                          )}

                  <div className="mt-6 border-t border-white/10 pt-3">
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
                  </div>
                </aside>
              );
            })()
          : null}

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
    </>
  );
}
