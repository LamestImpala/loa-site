// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachmentFilename,
  isRecordPhotoUrl,
  listingPhotos,
  parseAttachments,
} from "./attachments.ts";

const SB = "https://example.supabase.co";
const P = `${SB}/storage/v1/object/public/record-photos/`;

test("record photo urls: our public bucket only, no query strings", () => {
  assert.equal(isRecordPhotoUrl(`${P}290/1-front.jpg`, SB), true);
  assert.equal(isRecordPhotoUrl(`${P}290/1-front.jpg`, `${SB}/`), true);
  assert.equal(isRecordPhotoUrl(P, SB), false);
  assert.equal(isRecordPhotoUrl(`${P}290/a.jpg?x=1`, SB), false);
  assert.equal(isRecordPhotoUrl(`${SB}/storage/v1/object/public/other/a.jpg`, SB), false);
  assert.equal(isRecordPhotoUrl("https://evil.example/record-photos/a.jpg", SB), false);
});

test("filenames: slug of artist and title, numbered, extension from the url", () => {
  const r = { artist: "Pearl Jam", title: "Benaroya Hall" };
  assert.equal(attachmentFilename(r, `${P}290/x.JPEG`, 0), "pearl-jam-benaroya-hall-1.jpg");
  assert.equal(attachmentFilename(r, `${P}290/x.png`, 2), "pearl-jam-benaroya-hall-3.png");
  assert.equal(attachmentFilename({ artist: "Björk", title: "Début!" }, `${P}1/x`, 0), "bjork-debut-1.jpg");
  assert.equal(attachmentFilename({ artist: "", title: "" }, `${P}1/x.jpg`, 0), "record-1.jpg");
});

test("listing photos: every photo of every record, numbered per record", () => {
  const photos = listingPhotos([
    { id: 1, artist: "A", title: "B", photo_urls: [`${P}1/a.jpg`, `${P}1/b.jpg`] },
    { id: 2, artist: "C", title: "D", photo_urls: [] },
    { id: 3, artist: "E", title: "F", photo_urls: [`${P}3/c.jpg`] },
  ]);
  assert.deepEqual(
    photos.map((p) => [p.recordId, p.filename]),
    [[1, "a-b-1.jpg"], [1, "a-b-2.jpg"], [3, "e-f-1.jpg"]]
  );
});

test("parse: missing is none; bad urls refused; dedupe; unsafe filenames replaced; cap", () => {
  assert.deepEqual(parseAttachments(undefined, SB), { ok: true, attachments: [] });
  assert.equal(parseAttachments("x", SB).ok, false);
  assert.equal(parseAttachments([{ url: "https://evil.example/a.jpg", filename: "a.jpg" }], SB).ok, false);
  const r = parseAttachments(
    [
      { url: `${P}1/a.jpg`, filename: "pearl-jam-1.jpg" },
      { url: `${P}1/a.jpg`, filename: "dup.jpg" },
      { url: `${P}1/b.png`, filename: "../../etc/passwd" },
    ],
    SB
  );
  assert.deepEqual(r, {
    ok: true,
    attachments: [
      { path: `${P}1/a.jpg`, filename: "pearl-jam-1.jpg" },
      { path: `${P}1/b.png`, filename: "photo-2.png" },
    ],
  });
  const many = Array.from({ length: 13 }, (_, i) => ({ url: `${P}1/${i}.jpg`, filename: `${i}.jpg` }));
  assert.equal(parseAttachments(many, SB).ok, false);
});
