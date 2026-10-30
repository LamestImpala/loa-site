"use client";

import { useMemo, useState } from "react";
import type { DbRecord } from "@/lib/supabase";
import {
  PHOTO_ATTACHMENT_LIMIT,
  attachmentFilename,
  listingPhotos,
  type PhotoAttachment,
} from "@/lib/admin/attachments";
import { useAdmin } from "../_shell/admin-provider";
import { resizeImage } from "../_shell/resize-image";
import { inputClass } from "../_shell/ui";

// Photos to attach to an email from the Inbox: the listing photos of the
// records in play, each toggleable, plus an upload button for fresh
// shots of a copy. Uploads are resized on the way up, go to the same
// record-photos bucket, and join the listing unless that's unticked.
// The parent owns the selection so it can send it and then clear it.
export function PhotoPicker({
  records,
  selected,
  onChange,
}: {
  records: DbRecord[];
  selected: PhotoAttachment[];
  onChange: (next: PhotoAttachment[]) => void;
}) {
  const { supabase, updateRecord, pushToast } = useAdmin();
  const [uploadForId, setUploadForId] = useState<number | null>(null);
  const [addToListing, setAddToListing] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Uploads kept off the listing still need a thumbnail here.
  const [extra, setExtra] = useState<PhotoAttachment[]>([]);

  const available = useMemo(() => {
    const base = listingPhotos(records);
    const known = new Set(base.map((p) => p.url));
    return [...base, ...extra.filter((p) => !known.has(p.url))];
  }, [records, extra]);
  const target = records.find((r) => r.id === uploadForId) ?? records[0] ?? null;
  const isOn = (url: string) => selected.some((p) => p.url === url);

  function toggle(p: PhotoAttachment) {
    if (isOn(p.url)) {
      onChange(selected.filter((x) => x.url !== p.url));
      return;
    }
    if (selected.length >= PHOTO_ATTACHMENT_LIMIT) {
      pushToast("info", `At most ${PHOTO_ATTACHMENT_LIMIT} photos per email.`);
      return;
    }
    onChange([...selected, p]);
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || !target || uploading) return;
    setUploading(true);
    try {
      const existing = target.photo_urls ?? [];
      const offset = addToListing
        ? existing.length
        : existing.length + extra.filter((p) => p.recordId === target.id).length;
      const added: PhotoAttachment[] = [];
      const urls: string[] = [];
      for (const [i, file] of Array.from(files).entries()) {
        const { blob, ext, contentType } = await resizeImage(file);
        const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 40);
        const folder = addToListing ? `${target.id}` : `replies/${target.id}`;
        const path = `${folder}/${Date.now()}-${i}-${stem || "photo"}.${ext}`;
        const { error } = await supabase.storage
          .from("record-photos")
          .upload(path, blob, { contentType });
        if (error) throw new Error(error.message);
        const { data } = supabase.storage.from("record-photos").getPublicUrl(path);
        urls.push(data.publicUrl);
        added.push({
          url: data.publicUrl,
          filename: attachmentFilename(target, data.publicUrl, offset + i),
          recordId: target.id,
        });
      }
      if (addToListing) {
        await updateRecord(target.id, { photo_urls: [...existing, ...urls] });
      } else {
        setExtra((prev) => [...prev, ...added]);
      }
      const room = Math.max(0, PHOTO_ATTACHMENT_LIMIT - selected.length);
      onChange([...selected, ...added.slice(0, room)]);
      if (added.length > room) {
        pushToast("info", `Uploaded ${added.length}; only ${room} more fit in this email.`);
      }
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  const labelOf = (id: number) => {
    const r = records.find((x) => x.id === id);
    return r ? `${r.artist} — ${r.title}` : "";
  };

  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
        <span>
          Photos to attach{" "}
          <span className="text-neutral-200">
            {selected.length} of {available.length}
          </span>
        </span>
        {available.length > 1 ? (
          <>
            <button
              type="button"
              className="underline-offset-2 hover:text-white hover:underline"
              onClick={() => onChange(available.slice(0, PHOTO_ATTACHMENT_LIMIT))}
            >
              all
            </button>
            <button
              type="button"
              className="underline-offset-2 hover:text-white hover:underline"
              onClick={() => onChange([])}
            >
              none
            </button>
          </>
        ) : null}
      </div>
      {available.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {available.map((p) => {
            const on = isOn(p.url);
            return (
              <button
                key={p.url}
                type="button"
                onClick={() => toggle(p)}
                aria-pressed={on}
                title={`${labelOf(p.recordId)} · ${p.filename}`}
                className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 transition ${
                  on ? "border-amber-400" : "border-transparent opacity-50 hover:opacity-90"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                {on ? (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-amber-400 px-1 text-[10px] font-semibold leading-4 text-black">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">
          No photos of {records.length === 1 ? "this record" : "these records"} yet
          — upload some to send them.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {records.length > 1 ? (
          <select
            value={target?.id ?? ""}
            onChange={(e) => setUploadForId(Number(e.target.value))}
            className={`max-w-xs py-1 text-xs ${inputClass}`}
            aria-label="Record the uploaded photos are of"
          >
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.artist} — {r.title}
              </option>
            ))}
          </select>
        ) : null}
        <label
          className={`cursor-pointer rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white hover:text-black ${
            uploading || !target ? "pointer-events-none opacity-40" : ""
          }`}
          title={target ? `Upload photos of ${labelOf(target.id)}` : undefined}
        >
          {uploading ? "Uploading…" : "+ Upload photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading || !target}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={addToListing}
            onChange={(e) => setAddToListing(e.target.checked)}
          />
          also add to the listing
        </label>
      </div>
    </div>
  );
}
