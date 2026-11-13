"use client";

/*
 * The Catalog's "Add item" drawer: a record fetched from Discogs, or a
 * poster / piece of equipment typed in by hand, with photos of the actual
 * copy taken at the same time. Everything is saved as a draft — off the
 * shop until it has a price (see isDraft in lib/admin/records.ts).
 */
import { useEffect, useMemo, useState } from "react";
import type { DbRecord, ItemDetails, ItemKind } from "@/lib/supabase";
import { KINDS, KIND_LABELS } from "@/lib/items";
import { releaseDetailsFromDiscogs, type ReleaseDetails } from "@/lib/record-info";
import { detectCollection } from "@/lib/admin/collection";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, drawerClass, inputClass, primaryButtonClass } from "../_shell/ui";
import { ConditionSelect, DetailsInputs } from "./item-fields";
import { uploadRecordPhotos } from "./photos";

export const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"];

type RecordForm = {
  discogs_release_id: number;
  artist: string;
  title: string;
  pressing: string;
  media: string; // "" until graded — a record can't be saved without both
  sleeve: string;
  price: string;
  cover_image: string;
  genres: string; // comma-separated in the form; stored as text[]
  collection: string;
  details: ReleaseDetails; // tracklist, country, barcode, styles for the record page
};

// A poster or a piece of equipment typed in by hand — nothing on Discogs
// to fetch. Brand goes in artist and model in title for gear.
type ItemForm = {
  kind: Exclude<ItemKind, "record">;
  artist: string;
  title: string;
  price: string;
  condition: string;
  notes: string;
  details: ItemDetails;
};

const emptyItem = (kind: ItemForm["kind"]): ItemForm => ({
  kind,
  artist: kind === "poster" ? "Pearl Jam" : "",
  title: "",
  price: "0",
  condition: "",
  notes: "",
  details: {},
});

const byArtistTitle = (a: DbRecord, b: DbRecord) =>
  (a.artist + a.title).localeCompare(b.artist + b.title);

export function AddItemDrawer({
  draftsSupported,
  onClose,
  onAdded,
}: {
  // False until the records.draft migration is applied: items are then
  // added the old way (on the shop at once).
  draftsSupported: boolean;
  onClose: () => void;
  onAdded: (added: DbRecord) => void;
}) {
  const { supabase, setRecords, pushToast } = useAdmin();
  const [kind, setKind] = useState<ItemKind>("record");
  const [releaseInput, setReleaseInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [record, setRecord] = useState<RecordForm | null>(null);
  const [item, setItem] = useState<ItemForm>(() => emptyItem("poster"));
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Thumbnails for the photos picked so far.
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function pickKind(next: ItemKind) {
    setKind(next);
    setError("");
    if (next !== "record" && item.kind !== next) setItem(emptyItem(next));
  }

  async function fetchRelease() {
    setError("");
    // accept a bare ID or a pasted Discogs URL
    const match = releaseInput.match(/release\/(\d+)/) ?? releaseInput.match(/(\d+)/);
    if (!match) {
      setError("Paste a Discogs release URL or ID.");
      return;
    }
    const releaseId = Number(match[1]);
    setFetching(true);
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
        rel.images?.find((im: { type: string }) => im.type === "primary") ?? rel.images?.[0];
      setRecord({
        discogs_release_id: releaseId,
        artist: rel.artists?.map((a: { name: string }) => a.name).join(", ") ?? "",
        title: rel.title ?? "",
        pressing,
        media: "",
        sleeve: "",
        price: "0",
        cover_image: primary?.uri ?? rel.thumb ?? "",
        genres: (rel.genres ?? []).join(", "),
        collection: detectCollection(rel),
        details: releaseDetailsFromDiscogs(rel),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch release");
    } finally {
      setFetching(false);
    }
  }

  // What the insert adds for a draft; nothing before the migration.
  const draftFields = draftsSupported ? { listed: false, draft: true } : {};

  // Insert the row, then put its photos up under the new id.
  async function save(row: Record<string, unknown>) {
    setError("");
    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("records")
      .insert({ ...row, ...draftFields })
      .select()
      .single();
    if (insertError) {
      setSaving(false);
      setError(insertError.message);
      return;
    }
    let added = data as DbRecord;
    if (photos.length > 0) {
      try {
        const photo_urls = await uploadRecordPhotos(supabase, added.id, photos);
        const { error: photoError } = await supabase
          .from("records")
          .update({ photo_urls })
          .eq("id", added.id);
        if (photoError) throw new Error(photoError.message);
        added = { ...added, photo_urls };
      } catch (e) {
        // The item is saved either way; the drawer that opens next has
        // its own "+ Photos".
        pushToast(
          "error",
          `Saved, but the photos didn't upload (${e instanceof Error ? e.message : "unknown error"}) — add them in the drawer.`
        );
      }
    }
    setSaving(false);
    setRecords((prev) => [...prev, added].sort(byArtistTitle));
    onAdded(added);
  }

  function saveRecord() {
    if (!record) return;
    const price = Number(record.price);
    if (!record.artist.trim() || !record.title.trim() || !Number.isFinite(price) || price < 0) {
      setError("Artist, title, and a valid price (0 is fine) are required.");
      return;
    }
    if (!record.media || !record.sleeve) {
      setError("Grade the media and the sleeve — the price is worked out from the media grade.");
      return;
    }
    void save({
      artist: record.artist.trim(),
      title: record.title.trim(),
      pressing: record.pressing.trim(),
      media: record.media,
      sleeve: record.sleeve,
      price,
      cover_image: record.cover_image,
      discogs_release_id: record.discogs_release_id,
      genres: record.genres
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean),
      collection: record.collection.trim() || null,
      ...record.details,
    });
  }

  function saveItem() {
    const d = item;
    const price = Number(d.price);
    if (!d.artist.trim() || !d.title.trim() || !Number.isFinite(price) || price < 0) {
      setError(
        d.kind === "gear"
          ? "Brand, model, and a valid price (0 is fine) are required."
          : "Band, poster title, and a valid price (0 is fine) are required."
      );
      return;
    }
    const details: ItemDetails = {};
    for (const [k, v] of Object.entries(d.details) as [keyof ItemDetails, string | undefined][]) {
      if (v && v.trim()) details[k] = v.trim();
    }
    void save({
      kind: d.kind,
      artist: d.artist.trim(),
      title: d.title.trim(),
      price,
      condition: d.condition || null,
      details,
      notes: d.notes.trim(),
      pressing: "",
      media: "",
      sleeve: "",
      cover_image: "",
      genres: [],
      collection: null,
      discogs_release_id: null,
      manual_price: true, // nothing on Discogs to price it from
      tracklist: [],
      country: "",
      barcode: "",
      styles: [],
    });
  }

  const price = Number(kind === "record" ? record?.price : item.price);
  const hint = !draftsSupported
    ? "It goes on the shop as soon as it's added."
    : kind === "record" && price === 0
      ? "Saved as a draft, off the shop. The next price run (6 AM) sets its price from Discogs — the cheapest comparable listing + $6, or 85% of the suggestion for its grade — and puts it on the shop."
      : price > 0
        ? "Saved as a draft, off the shop. Check it over in its drawer, then Publish."
        : "Saved as a draft, off the shop. Give it a price in its drawer, then Publish.";
  const saveLabel = saving
    ? "Saving…"
    : draftsSupported
      ? "Save draft"
      : `Add ${KIND_LABELS[kind].toLowerCase()}`;

  const photoPicker = (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {previews.map((url, i) => (
          <span key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
              title="Leave this photo out"
              aria-label={`Leave out photo ${i + 1}`}
              className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-red-800 text-center text-[10px] leading-4 text-white"
            >
              ×
            </button>
          </span>
        ))}
        <label
          className="cursor-pointer rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black"
          title="Photos of the actual copy — shown on the shop with an “Actual copy pictured” badge"
        >
          + Photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setPhotos((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Photos of the actual copy. Optional — they can go on later too.
      </p>
    </div>
  );

  const gradeSelect = (label: string, field: "media" | "sleeve") => (
    <label className="flex items-center gap-2 text-sm text-neutral-400">
      {label}
      <select
        value={record?.[field] ?? ""}
        onChange={(e) => record && setRecord({ ...record, [field]: e.target.value })}
        className={`${inputClass} [&>option]:bg-neutral-900`}
      >
        <option value="">Grade…</option>
        {GRADES.map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
    </label>
  );

  return (
    <aside role="dialog" aria-label="Add an item" className={drawerClass}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Add an item</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="text-xl leading-none text-neutral-500 transition hover:text-white"
        >
          ×
        </button>
      </div>

      <div
        className="mt-4 inline-flex self-start rounded-lg border border-white/15 p-0.5 text-sm"
        role="tablist"
        aria-label="What kind of item"
      >
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => pickKind(k)}
            className={`rounded-md px-3 py-1 transition ${
              kind === k ? "bg-white text-black" : "text-neutral-400 hover:text-white"
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {kind === "record" ? (
        <>
          <p className="mt-4 text-sm text-neutral-400">
            Paste a Discogs release URL or ID and Fetch fills in the details and cover art.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              autoFocus
              value={releaseInput}
              onChange={(e) => setReleaseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchRelease();
              }}
              placeholder="discogs.com/release/16426854-…  or  16426854"
              className={`min-w-0 flex-1 ${inputClass}`}
            />
            <button type="button" onClick={fetchRelease} disabled={fetching} className={buttonClass}>
              {fetching ? "Fetching…" : "Fetch"}
            </button>
          </div>
          {record ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex gap-3">
                {record.cover_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={record.cover_image}
                    alt="Cover"
                    className="h-20 w-20 shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <input
                    type="text"
                    value={record.artist}
                    onChange={(e) => setRecord({ ...record, artist: e.target.value })}
                    placeholder="Artist"
                    aria-label="Artist"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={record.title}
                    onChange={(e) => setRecord({ ...record, title: e.target.value })}
                    placeholder="Title"
                    aria-label="Title"
                    className={inputClass}
                  />
                </div>
              </div>
              <input
                type="text"
                value={record.pressing}
                onChange={(e) => setRecord({ ...record, pressing: e.target.value })}
                placeholder="Pressing"
                aria-label="Pressing"
                className={inputClass}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={record.genres}
                  onChange={(e) => setRecord({ ...record, genres: e.target.value })}
                  placeholder="Genres (comma-separated)"
                  aria-label="Genres"
                  className={`min-w-0 flex-1 ${inputClass}`}
                />
                <input
                  type="text"
                  value={record.collection}
                  onChange={(e) => setRecord({ ...record, collection: e.target.value })}
                  placeholder="Collection (VMP…)"
                  aria-label="Collection"
                  className={`w-36 ${inputClass}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {gradeSelect("Media", "media")}
                {gradeSelect("Sleeve", "sleeve")}
                <label className="flex items-center gap-2 text-sm text-neutral-400">
                  $
                  <input
                    type="number"
                    min="0"
                    value={record.price}
                    onChange={(e) => setRecord({ ...record, price: e.target.value })}
                    title="Leave at 0 to let the price run set it"
                    className={`w-24 ${inputClass}`}
                  />
                </label>
              </div>
              {photoPicker}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <input
            type="text"
            autoFocus
            value={item.artist}
            onChange={(e) => setItem({ ...item, artist: e.target.value })}
            placeholder={kind === "poster" ? "Band" : "Brand"}
            aria-label={kind === "poster" ? "Band" : "Brand"}
            className={inputClass}
          />
          <input
            type="text"
            value={item.title}
            onChange={(e) => setItem({ ...item, title: e.target.value })}
            placeholder={kind === "poster" ? "Poster title, e.g. Wrigley Field 2016 Night 1" : "Model"}
            aria-label={kind === "poster" ? "Poster title" : "Model"}
            className={inputClass}
          />
          <DetailsInputs
            kind={kind}
            values={item.details}
            onChange={(key, value) =>
              setItem((prev) => ({ ...prev, details: { ...prev.details, [key]: value } }))
            }
          />
          <textarea
            value={item.notes}
            onChange={(e) => setItem({ ...item, notes: e.target.value })}
            placeholder="Notes shown to buyers"
            rows={2}
            className={`w-full resize-y ${inputClass}`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <ConditionSelect
              kind={kind}
              value={item.condition}
              onChange={(condition) => setItem({ ...item, condition })}
            />
            <label className="flex items-center gap-2 text-sm text-neutral-400">
              $
              <input
                type="number"
                min="0"
                value={item.price}
                onChange={(e) => setItem({ ...item, price: e.target.value })}
                className={`w-24 ${inputClass}`}
              />
            </label>
          </div>
          {photoPicker}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {kind !== "record" || record ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={kind === "record" ? saveRecord : saveItem}
              disabled={saving}
              className={primaryButtonClass}
            >
              {saveLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-sm text-neutral-500 transition hover:text-white"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">{hint}</p>
        </div>
      ) : null}
    </aside>
  );
}
