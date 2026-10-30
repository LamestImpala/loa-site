import type { DbRecord } from "../supabase.ts";
import type { EmailAttachment } from "../email.ts";

// Photos attached to mail sent from the Inbox. They are always files in
// the public record-photos bucket (a listing's photos, or ones uploaded
// from the reply box), so Resend can fetch them by URL and nothing big
// passes through the site. Pure; the route and the picker share it.

export const PHOTO_ATTACHMENT_LIMIT = 12;
const BUCKET_PATH = "/storage/v1/object/public/record-photos/";

export type PhotoAttachment = {
  url: string;
  filename: string;
  recordId: number;
};

export function recordPhotoPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}${BUCKET_PATH}`;
}

// Only files in our own public bucket, with a real path after the prefix.
export function isRecordPhotoUrl(url: string, supabaseUrl: string): boolean {
  const prefix = recordPhotoPrefix(supabaseUrl);
  if (!url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  return rest.length > 0 && !/[?#\s]/.test(rest);
}

function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function extensionOf(url: string): string {
  const m = url.match(/\.([a-z0-9]{2,5})$/i);
  const ext = m ? m[1].toLowerCase() : "jpg";
  return ext === "jpeg" ? "jpg" : ext;
}

// "pearl-jam-benaroya-hall-2.jpg": what the buyer sees in their client.
export function attachmentFilename(
  record: Pick<DbRecord, "artist" | "title">,
  url: string,
  index: number
): string {
  const base = slug(`${record.artist} ${record.title}`) || "record";
  return `${base}-${index + 1}.${extensionOf(url)}`;
}

// Every listing photo of the given records, numbered per record.
export function listingPhotos(
  records: Pick<DbRecord, "id" | "artist" | "title" | "photo_urls">[]
): PhotoAttachment[] {
  const out: PhotoAttachment[] = [];
  for (const r of records) {
    (r.photo_urls ?? []).forEach((url, i) => {
      out.push({ url, filename: attachmentFilename(r, url, i), recordId: r.id });
    });
  }
  return out;
}

// Server-side check of what the page sent: our bucket only, capped,
// deduped, filenames reduced to safe characters.
export function parseAttachments(
  raw: unknown,
  supabaseUrl: string
): { ok: true; attachments: EmailAttachment[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments must be a list" };
  if (raw.length > PHOTO_ATTACHMENT_LIMIT) {
    return { ok: false, error: `At most ${PHOTO_ATTACHMENT_LIMIT} photos per email` };
  }
  const seen = new Set<string>();
  const attachments: EmailAttachment[] = [];
  for (const item of raw) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!isRecordPhotoUrl(url, supabaseUrl)) {
      return { ok: false, error: "Only photos from the record-photos bucket can be attached" };
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const wanted = typeof item?.filename === "string" ? item.filename : "";
    const safe = wanted.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
    const filename = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{2,5}$/.test(safe)
      ? safe
      : `photo-${attachments.length + 1}.${extensionOf(url)}`;
    attachments.push({ path: url, filename });
  }
  return { ok: true, attachments };
}
