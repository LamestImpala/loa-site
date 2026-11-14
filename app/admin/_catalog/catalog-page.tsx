"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LETTERS, artistLetter, bundleBreakdown } from "@/lib/records";
import type { DbRecord } from "@/lib/supabase";
import { HOLD_HOURS, holdExpiry } from "@/lib/admin/orders";
import { buyerLabel } from "@/lib/admin/buyers";
import {
  PUBLISH_PATCH,
  awaitsPriceRun,
  holdActive,
  holdUntilText,
  invoiceHold,
  isDraft,
  publishBlock,
} from "@/lib/admin/records";
import { discogsReady } from "@/lib/admin/fulfillment";
import { bucketEventsByDay } from "@/lib/admin/interest";
import {
  DEFAULT_FILTERS,
  FILTER_PARAMS,
  STATUS_FILTERS,
  filterRecords,
  filtersActive,
  filtersFromQuery,
  filtersToQuery,
  matchesStatus,
  sortRecords,
  type CatalogFilters,
  type InterestFilter,
  type SortKey,
  type StatusFilter,
} from "@/lib/admin/catalog-filter";
import { photoPaths } from "@/lib/admin/missing";
import { discogsStatusText, useAdmin, useSlice } from "../_shell/admin-provider";
import { NoteField } from "../_shell/inline-fields";
import { PageHeader } from "../_shell/primitives";
import { AddItemDrawer, GRADES } from "./add-item";
import { CatalogRow } from "./catalog-row";
import { DetailsEditor } from "./item-fields";
import { uploadRecordPhotos } from "./photos";
import { KINDS, KIND_LABELS, isRecord, itemSubtitle, kindOf } from "@/lib/items";
import {
  blurOnEnter,
  buttonClass,
  drawerClass,
  inputClass,
  pct,
  primaryButtonClass,
} from "../_shell/ui";

// What the three name fields are called for each kind of item: a poster's
// band and print name, a piece of gear's brand and model.
const NAME_LABELS = {
  record: { artist: "Artist", title: "Title" },
  poster: { artist: "Band", title: "Poster title" },
  gear: { artist: "Brand", title: "Model" },
} as const;

// The catalog: every item, with filters, the listings table, per-item
// editing, drafts and publishing, holds, sold state, Discogs removal, and
// adding an item.
// Where this session last left the catalog's view, as a query string —
// the nav link is a bare /admin/catalog, so this is what brings the
// filters back after a trip to another admin page.
let lastCatalogQuery = "";

// Where a sold record's order card lives on the Orders page.
const orderHref = (r: { order_id?: number | null }) =>
  r.order_id != null ? `/admin/ship/orders?order=${r.order_id}` : "/admin/ship/orders";

export function CatalogPage() {
  const router = useRouter();
  const {
    supabase,
    records,
    setRecords,
    setPending,
    interest,
    events,
    visits,
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
    readdToDiscogs,
    discogsReadding,
    markRecordsSold,
    confirm,
    placeOrder,
    shipments,
    orders,
    ordersById,
    renameBuyer,
    releaseHold: releaseRecordHold,
    unsellRecords,
    saleIds,
    setSaleIds,
    weeklyIds,
    setWeeklyIds,
    selectionMode,
    setSelectionMode,
    toggleSelected,
    clearSaleDesk,
    clearWeeklyPicks,
  } = useAdmin();
  // The Sel checkboxes edit one of two selections: the sale desk, or —
  // while picking for the weekly Reddit post — the weekly picks.
  const picking = selectionMode === "weekly";
  const selectedIds = picking ? weeklyIds : saleIds;
  const setSelectedIds = picking ? setWeeklyIds : setSaleIds;

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
  const [kindFilter, setKindFilter] = useState<CatalogFilters["kind"]>(initialView.filters.kind);
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialView.filters.status);
  const filters = useMemo<CatalogFilters>(
    () => ({
      search,
      kind: kindFilter,
      genre: genreFilter,
      collection: collectionFilter,
      letter: letterFilter,
      shown: shownFilter,
      sold: soldFilter,
      interest: interestFilter,
      status: statusFilter,
    }),
    [search, kindFilter, genreFilter, collectionFilter, letterFilter, shownFilter, soldFilter, interestFilter, statusFilter]
  );
  const viewQuery = useMemo(() => filtersToQuery(filters, sortBy).toString(), [filters, sortBy]);
  // Back to the whole list; the sort stays.
  function clearFilters() {
    setSearch(DEFAULT_FILTERS.search);
    setKindFilter(DEFAULT_FILTERS.kind);
    setGenreFilter(DEFAULT_FILTERS.genre);
    setCollectionFilter(DEFAULT_FILTERS.collection);
    setLetterFilter(DEFAULT_FILTERS.letter);
    setShownFilter(DEFAULT_FILTERS.shown);
    setSoldFilter(DEFAULT_FILTERS.sold);
    setInterestFilter(DEFAULT_FILTERS.interest);
    setStatusFilter(DEFAULT_FILTERS.status);
  }
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
  // Interest counts and Discogs context feed the table; raw events and
  // page visits only matter once a drawer opens (its day-by-day history).
  useSlice("interest");
  useSlice("market");
  useSlice("events", openId != null);
  useSlice("visits", openId != null);
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
  // The "Add item" drawer shares the right edge with the details drawer, so
  // opening one closes the other.
  const [adding, setAdding] = useState(false);
  const openRow = useCallback(
    (id: number | null) => {
      if (id != null) setAdding(false);
      openDrawer(id);
    },
    [openDrawer]
  );
  useEffect(() => {
    if (openId == null && !adding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (adding) setAdding(false);
      else openDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, adding, openDrawer]);

  // Rows carry `draft` once the records.draft migration is applied; until
  // then items are added the old way and nothing is ever a draft.
  const draftsSupported = useMemo(() => records.some((r) => r.draft !== undefined), [records]);

  function onAdded(added: DbRecord) {
    setAdding(false);
    const name = `"${added.artist} — ${added.title}"`;
    pushToast(
      "success",
      !isDraft(added)
        ? `Added ${name} ✓`
        : awaitsPriceRun(added)
          ? `Saved ${name} as a draft — the next price run prices it and puts it on the shop.`
          : `Saved ${name} as a draft — publish it from its drawer when it's ready.`
    );
    openDrawer(added.id);
  }

  const [uploadingId, setUploadingId] = useState<number | null>(null);

  async function uploadPhotos(r: DbRecord, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingId(r.id);
    try {
      const urls = await uploadRecordPhotos(supabase, r.id, Array.from(files));
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
        `Delete this photo of "${r.artist} — ${r.title}" permanently? It can't be undone.`,
        "Delete photo"
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
      pushToast("error", `Couldn't check boxes: ${parcelErr.message}`);
      return;
    }
    if ((parcels ?? []).length > 0) {
      pushToast(
        "error",
        `"${r.artist} — ${r.title}" is in a box — take it out on its order's card (Ship → Orders) first.`
      );
      return;
    }
    if (
      !(await confirm(
        `Delete "${r.artist} — ${r.title}" permanently? Its photos and price history go with it. Meant for records that were never actually sold — this can't be undone.`,
        "Delete permanently"
      ))
    )
      return;
    setSaving(r.id, true);
    const paths = photoPaths(r);
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
    const targets = discogsReady(records, shipments, orders);
    if (targets.length === 0) return;
    if (
      !(await confirm(
        `Remove ${targets.length} shipped record${targets.length === 1 ? "" : "s"} from your Discogs collection? This can't be undone. This paces itself for Discogs' rate limit, so it takes about 2 seconds per record.`,
        "Remove from Discogs"
      ))
    )
      return;
    setDiscogsBulkBusy(true);
    discogsBulkCancel.current = false;
    let removed = 0;
    let gone = 0;
    let ambiguous = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (discogsBulkCancel.current) break;
        const r = targets[i];
        setDiscogsBulkStatus(
          `Removing ${i + 1}/${targets.length}: ${r.artist} — ${r.title}`
        );
        setDiscogsStatus((prev) => ({ ...prev, [r.id]: "Removing…" }));
        const { outcome, error, folderId } = await discogsRemoveRequest(
          r.discogs_release_id!
        );
        if (outcome === "removed") removed++;
        else if (outcome === "gone") gone++;
        else if (outcome === "ambiguous") ambiguous++;
        else failed++;
        setDiscogsStatus((prev) => ({ ...prev, [r.id]: discogsStatusText(outcome, error) }));
        if (outcome === "removed" || outcome === "gone") await flagDiscogsRemoved(r.id, folderId);
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
      ...(ambiguous > 0
        ? [`${ambiguous} left for you — Discogs has more than one copy (see the record's drawer)`]
        : []),
      ...(failed > 0 ? [`${failed} failed`] : []),
      ...(discogsBulkCancel.current ? ["stopped early"] : []),
    ];
    pushToast(
      failed > 0 ? "error" : ambiguous > 0 ? "info" : "success",
      `Discogs cleanup: ${parts.join(", ")}.`
    );
  }

  // Inline hold editor (which row is asking for a buyer name, and the draft)
  const [holdEditId, setHoldEditId] = useState<number | null>(null);
  const [holdBuyerInput, setHoldBuyerInput] = useState("");

  async function confirmHold(r: DbRecord) {
    const buyer = holdBuyerInput.trim().replace(/^u\//, "");
    if (!buyer) return;
    // Same path as the desk's hold: the order is what lists it under the
    // Sell page's Awaiting payment.
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

  // Put a draft on the shop. It needs a price above $0 (and a record its
  // grades) first — the shop would otherwise show a $0 tag.
  const publish = useCallback(
    async (r: DbRecord) => {
      const name = `"${r.artist} — ${r.title}"`;
      const block = publishBlock(r);
      if (block) {
        pushToast("error", `Can't publish ${name} yet — ${block}.`);
        return;
      }
      if (await updateRecord(r.id, PUBLISH_PATCH, { quiet: true })) {
        pushToast("success", `${name} is on the shop ✓`);
      }
    },
    [pushToast, updateRecord]
  );

  // Hiding is reversible, so it gets an Undo toast rather than a confirm.
  // Ticking Shown on a draft is publishing it.
  const toggleListed = useCallback(
    async (r: DbRecord, listed: boolean) => {
      if (listed && isDraft(r)) return publish(r);
      const ok = await updateRecord(r.id, { listed });
      if (!ok || listed) return;
      pushToast("info", `Hidden "${r.artist} — ${r.title}" from the shop`, {
        label: "Undo",
        onClick: () => updateRecord(r.id, { listed: true }),
      });
    },
    [publish, pushToast, updateRecord]
  );

  // Artist, title and pressing, edited in the drawer. A blank artist or
  // title is dropped (the field snaps back): every list names items by them.
  async function saveName(r: DbRecord, field: "artist" | "title" | "pressing", next: string) {
    if (field !== "pressing" && !next) {
      pushToast("error", `The ${NAME_LABELS[kindOf(r)][field].toLowerCase()} can't be blank.`);
      return;
    }
    await updateRecord(r.id, { [field]: next });
  }

  async function releaseHold(r: DbRecord) {
    if (
      !(await confirm(
        `Release the hold on "${r.artist} — ${r.title}" for ${buyerLabel(r.hold_buyer)}? It goes back on the shop immediately.`,
        "Release hold"
      ))
    )
      return;
    await releaseRecordHold(r);
  }

  async function markSold(r: DbRecord, sold: boolean) {
    const name = `"${r.artist} — ${r.title}"`;
    if (!sold) {
      // Un-selling erases the sale — make sure it's deliberate.
      if (
        !(await confirm(
          `Un-sell ${name}? It goes back on the shop, and its sale is cleared: buyer, sold price and date, invoice link, and its place in any box.${
            r.discogs_removed ? " It already came out of your Discogs collection — re-add it there." : ""
          }`,
          "Un-sell"
        ))
      )
        return;
      setSaving(r.id, true);
      try {
        await unsellRecords([r]);
      } finally {
        setSaving(r.id, false);
      }
      return;
    }
    // Selling goes through the same path as the sale desk, so this also
    // puts the record in a paid order, carries a hold's buyer over, and
    // closes the matching order request. A deal or a different buyer is a
    // job for the sale desk.
    const buyer = (r.hold_buyer ?? "").trim();
    if (
      !(await confirm(
        `Mark ${name} sold${buyer ? ` to ${buyerLabel(buyer)}` : " with no buyer"} for $${r.negotiated_price ?? r.price}? For a different buyer or price, use "Sell on the desk" instead.`,
        "Mark sold"
      ))
    )
      return;
    setSaving(r.id, true);
    try {
      await markRecordsSold([r], "");
    } finally {
      setSaving(r.id, false);
    }
  }

  // Start a sale for this record on the Sell page's sale desk, where the buyer,
  // a negotiated price and the invoice are set.
  function sellOnDesk(r: DbRecord) {
    setSaleIds((prev) => new Set(prev).add(r.id));
    router.push("/admin/sell#sale-desk");
  }

  // Daily history for the record open in the drawer.
  const interestDetailDays = useMemo(
    () =>
      openId == null
        ? []
        : bucketEventsByDay(
            events.filter((e) => e.record_id === openId),
            visits.filter((v) => v.record_id === openId)
          ),
    [openId, events, visits]
  );

  const filteredRecords = useMemo(
    () => sortRecords(filterRecords(records, filters, { interest, market }), sortBy, interest),
    [records, filters, sortBy, interest, market]
  );
  // How many items each status chip would show, across the whole catalog.
  const statusCounts = useMemo(() => {
    const now = Date.now();
    return Object.fromEntries(
      STATUS_FILTERS.map((s) => [s.key, records.filter((r) => matchesStatus(r, s.key, now)).length])
    ) as Record<StatusFilter, number>;
  }, [records]);

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

  // Show or hide every record currently shown by the search filter. There
  // is deliberately no bulk sell or un-sell: a sale belongs to one buyer's
  // order, so it goes through the sale desk or the drawer, one order at a
  // time.
  async function toggleAllFiltered(field: "listed", value: boolean) {
    const changing = filteredRecords.filter((r) => r[field] !== value);
    // Turning Shown on publishes any drafts in the list — except ones with
    // no price (or grades) yet, which stay drafts.
    const notReady = value ? changing.filter((r) => isDraft(r) && publishBlock(r)) : [];
    const ids = changing.filter((r) => !notReady.includes(r)).map((r) => r.id);
    const skipped =
      notReady.length > 0
        ? ` ${notReady.length} draft${notReady.length === 1 ? "" : "s"} with no price yet stay${notReady.length === 1 ? "s" : ""} off the shop.`
        : "";
    if (ids.length === 0) {
      if (skipped) pushToast("info", `Nothing to show.${skipped}`);
      return;
    }
    const label = "Shown";
    const plural = ids.length === 1 ? "" : "s";
    if (
      !(await confirm(
        `Set ${label} ${value ? "ON" : "OFF"} for all ${ids.length} record${plural} in the current filter?${skipped}`,
        value ? "Turn on" : "Turn off"
      ))
    )
      return;
    setBulkSaving(true);
    const patch: Partial<DbRecord> =
      value && draftsSupported ? PUBLISH_PATCH : { [field]: value };
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
      <PageHeader
        title="Catalog"
        description={
          draftsSupported
            ? "Everything you sell. A new item starts as a draft, off the shop until it has a price. Shown controls whether an item is on the shop at all; Sold keeps it visible with a SOLD badge."
            : "Everything you sell. Shown controls whether an item is on the shop at all; Sold keeps it visible with a SOLD badge."
        }
        actions={
          <button
            type="button"
            onClick={() => {
              openDrawer(null);
              setAdding(true);
            }}
            className={primaryButtonClass}
          >
            Add item
          </button>
        }
      />
        <div className="mt-6 flex flex-wrap gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artist, title, label, genre…"
            className={`w-full max-w-md ${inputClass}`}
          />
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as CatalogFilters["kind"])}
            className={`${inputClass} [&>option]:bg-neutral-900`}
          >
            <option value="all">Kind: All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "record" ? "Records" : k === "poster" ? "Posters" : "Equipment"}
              </option>
            ))}
          </select>
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
        {/* One-click views of what needs attention; the number is how many
            items each would show. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
          {STATUS_FILTERS.filter((s) => draftsSupported || s.key !== "draft").map((s) => {
            const active = statusFilter === s.key;
            const n = statusCounts[s.key];
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(active ? "all" : s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? "border-white bg-white text-black"
                    : n > 0
                      ? "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
                      : "border-white/10 text-neutral-600 hover:text-neutral-300"
                }`}
              >
                {s.label}
                <span className={active ? "text-neutral-600" : "text-neutral-500"}>{n}</span>
              </button>
            );
          })}
          {filtersActive(filters) ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 text-xs text-neutral-400 underline underline-offset-2 transition hover:text-white"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-neutral-500">
            {filteredRecords.length} of {records.length} items
          </p>
          {(() => {
            // Shipped only — a paid order can still be refunded, and the
            // Discogs delete can't be undone.
            const soldOnDiscogs = discogsReady(records, shipments, orders).length;
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
                title="Removes every shipped record (whole order boxed and tracked, or handed over in person on Pack) that has a Discogs release id from your Discogs collection."
                className={buttonClass}
              >
                Remove {soldOnDiscogs} shipped from Discogs
              </button>
            );
          })()}
        </div>
        {picking ? (
          <div
            className="sticky top-12 z-10 mt-4 rounded-2xl border border-neutral-700 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">
                  {saleRecords.length} record{saleRecords.length === 1 ? "" : "s"}
                </span>{" "}
                <span className="text-neutral-400">
                  picked for the weekly post — adjust with the Sel checkboxes.
                  The sale desk is untouched.
                </span>
              </p>
              <button
                type="button"
                onClick={clearWeeklyPicks}
                title="Drop the weekly picks and go back to selecting for the sale desk"
                className="text-xs text-neutral-500 underline transition hover:text-white"
              >
                Clear picks
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
                title="Keep these picks for the Reddit page and hand the Sel checkboxes back to the sale desk"
              >
                Done picking
              </button>
            </div>
          </div>
        ) : null}
        {!picking && saleIds.size > 0 ? (
          <div
            className="sticky top-2 z-10 mt-4 rounded-2xl border border-amber-400/30 bg-neutral-950/95 p-4 backdrop-blur"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className="font-medium">
                  {saleRecords.length} record{saleRecords.length === 1 ? "" : "s"}
                </span>{" "}
                <span className="text-neutral-400">
                  on the sale desk · Subtotal ${saleTotals.subtotal}
                  {saleSoldCount > 0
                    ? ` · ${saleSoldCount} already sold`
                    : ""}
                </span>
              </p>
              <div className="flex items-center gap-3">
                <Link
                  href="/admin/sell#sale-desk"
                  className={buttonClass}
                  title="Copy the reply, hold, mark sold or invoice these on the Sell page"
                >
                  Open sale desk
                </Link>
                <button
                  type="button"
                  onClick={clearSaleDesk}
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
                      title={
                        picking
                          ? "Pick/unpick all records in the current search for the weekly post"
                          : "Select/deselect all records in the current search for the sale desk"
                      }
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
                    Nothing matches the current filters.{" "}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-neutral-300 underline underline-offset-2 transition hover:text-white"
                    >
                      Clear filters
                    </button>
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
                  onOpen={openRow}
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
              const names = NAME_LABELS[kindOf(r)];
              const blocked = isDraft(r) ? publishBlock(r) : null;
              return (
                <aside
                  role="dialog"
                  aria-label={`${r.artist} — ${r.title}`}
                  className={drawerClass}
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
                          {!isRecord(r) ? (
                            <span className="ml-2 rounded-full border border-amber-400/40 px-2 text-xs font-normal text-amber-300">
                              {KIND_LABELS[kindOf(r)]}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-neutral-500">{itemSubtitle(r)}</p>
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

                  {isDraft(r) ? (
                    <div className="mt-4 rounded-xl border border-sky-400/30 bg-sky-400/5 p-3">
                      <p className="text-sm font-medium text-sky-200">
                        Draft — not on the shop yet
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        {awaitsPriceRun(r)
                          ? "The next price run (6 AM) sets its price from Discogs and puts it on the shop. To publish sooner, set a price below."
                          : blocked
                            ? `To publish it, ${blocked}.`
                            : "It has a price — publish it when the listing looks right."}
                      </p>
                      <button
                        type="button"
                        disabled={!!blocked || savingIds.has(r.id)}
                        onClick={() => publish(r)}
                        className={`mt-2 ${primaryButtonClass}`}
                      >
                        Publish to the shop
                      </button>
                    </div>
                  ) : null}

                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-neutral-500">
                    Listing
                  </h3>
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex gap-2">
                          <NoteField
                            key={`artist-${r.id}`}
                            value={r.artist}
                            placeholder={names.artist}
                            title={`${names.artist} — saves when you click away`}
                            disabled={savingIds.has(r.id)}
                            onSave={(next) => saveName(r, "artist", next)}
                            className="min-w-0 flex-1"
                          />
                          <NoteField
                            key={`title-${r.id}`}
                            value={r.title}
                            placeholder={names.title}
                            title={`${names.title} — saves when you click away`}
                            disabled={savingIds.has(r.id)}
                            onSave={(next) => saveName(r, "title", next)}
                            className="min-w-0 flex-[1.4]"
                          />
                        </div>
                        {isRecord(r) ? (
                          <NoteField
                            key={`pressing-${r.id}`}
                            value={r.pressing}
                            placeholder="Pressing"
                            title="Pressing (year · label · format) — saves when you click away"
                            disabled={savingIds.has(r.id)}
                            onSave={(next) => saveName(r, "pressing", next)}
                            className="w-full"
                          />
                        ) : null}
                      </div>
                      {!isRecord(r) ? (
                        <DetailsEditor
                          r={r}
                          disabled={savingIds.has(r.id)}
                          onSave={(patch) => updateRecord(r.id, patch)}
                        />
                      ) : (
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
                            {r.media ? null : <option value="">Grade…</option>}
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
                            {r.sleeve ? null : <option value="">Grade…</option>}
                            {GRADES.map((g) => (
                              <option key={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      )}
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
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={r.sold}
                        disabled={savingIds.has(r.id) || (!r.sold && invoiceHold(r))}
                        onChange={(e) => markSold(r, e.target.checked)}
                        className="admin-checkbox"
                      />
                      Sold
                    </label>
                    {!r.sold && !holdActive(r) ? (
                      <button
                        type="button"
                        onClick={() => sellOnDesk(r)}
                        className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                      >
                        Sell on the desk →
                      </button>
                    ) : null}
                  </div>
                  {!r.sold && r.discogs_removed ? (
                    <p className="mt-2 text-xs text-amber-300">
                      For sale again, but it came out of your Discogs
                      collection.{" "}
                      {r.discogs_release_id ? (
                        <button
                          type="button"
                          disabled={discogsReadding.has(r.id)}
                          onClick={() => readdToDiscogs(r)}
                          className="text-amber-200 underline underline-offset-2 transition hover:text-white disabled:opacity-50"
                        >
                          {discogsReadding.has(r.id) ? "Re-adding…" : "Re-add to Discogs"}
                        </button>
                      ) : null}{" "}
                      <button
                        type="button"
                        onClick={() =>
                          updateRecord(r.id, { discogs_removed: false, discogs_folder_id: null })
                        }
                        className="text-neutral-400 underline underline-offset-2 transition hover:text-white"
                      >
                        I re-added it ✓
                      </button>
                    </p>
                  ) : null}
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
                                onClick={() => router.push(orderHref(r))}
                                title="The swap-bot trade confirmation for this order is copied from its card on the Orders page"
                                className="whitespace-nowrap text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                confirm on Orders
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
                            {/* Tracking lives on boxes on the Orders page —
                                shown read-only here so the two can't disagree */}
                            {r.tracking_number ? (
                              <span
                                className="font-mono text-xs text-neutral-400"
                                title="Tracking number, managed per box on the Orders page"
                              >
                                {r.tracking_number}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => router.push(orderHref(r))}
                                title="Tracking numbers are managed per box on the Orders page"
                                className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-white"
                              >
                                add tracking on Orders
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
                                        `Remove "${r.artist} — ${r.title}" from your Discogs collection? This can't be undone from here.`,
                                        "Remove from Discogs"
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
                              {/* The route wouldn't pick a copy (or failed):
                                  remove it on Discogs, then record that. */}
                              {!r.discogs_removed &&
                              discogsStatus[r.id] &&
                              !discogsStatus[r.id].includes("✓") &&
                              discogsStatus[r.id] !== "Removing…" ? (
                                <>
                                  <a
                                    href={`https://www.discogs.com/release/${r.discogs_release_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                                  >
                                    Open on Discogs ↗
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => flagDiscogsRemoved(r.id)}
                                    className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                                  >
                                    I removed it ✓
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : holdActive(r) ? (
                        <div className="flex flex-col gap-1 text-xs">
                          <span className="text-amber-300">
                            Held for {buyerLabel(r.hold_buyer)} {holdUntilText(r)}
                          </span>
                          {invoiceHold(r) ? (
                            <Link
                              href="/admin/sell#open-orders"
                              className="self-start text-neutral-500 underline underline-offset-2 transition hover:text-white"
                            >
                              On invoice {r.paypal_invoice_id} — cancel it under Awaiting payment on Sell
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => releaseHold(r)}
                              className="self-start text-neutral-500 underline underline-offset-2 transition hover:text-white"
                            >
                              Release hold
                            </button>
                          )}
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
                          title={`Reserve for a buyer for ${HOLD_HOURS} hours — the public card shows On hold, and the hold lists under Awaiting payment on the Sell page`}
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
                                      {d.visited > 0
                                        ? ` · ${d.visited} viewed`
                                        : ""}
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
                          href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${r.artist} ${r.title}${isRecord(r) ? " vinyl" : kindOf(r) === "poster" ? " poster" : ""}`)}&LH_Sold=1&LH_Complete=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                        >
                          eBay solds
                        </a>
                        {isRecord(r) ? (
                          <a
                            href={`https://www.popsike.com/php/quicksearch.php?searchtext=${encodeURIComponent(`${r.artist} ${r.title}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-neutral-500 underline underline-offset-2 transition hover:text-white"
                          >
                            Popsike
                          </a>
                        ) : null}
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

        {adding ? (
          <AddItemDrawer
            draftsSupported={draftsSupported}
            onClose={() => setAdding(false)}
            onAdded={onAdded}
          />
        ) : null}
    </>
  );
}
