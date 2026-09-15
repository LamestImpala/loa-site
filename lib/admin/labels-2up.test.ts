// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import {
  combineLabels,
  detectLayout,
  HALF,
  layoutOfSizes,
  LETTER,
  sheetCount,
  THERMAL,
} from "./labels-2up.ts";

// A stand-in for a PayPal label: letter page, 6×4 box centered in the top
// half, plus a stray mark in the bottom half that must not survive.
async function label(name: string, size: [number, number] = [612, 792]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(size);
  page.drawRectangle({ x: 90, y: 450, width: 432, height: 288, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 90, y: 100, width: 100, height: 100, color: rgb(1, 0, 0) });
  return { name, bytes: await doc.save() };
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

// The form XObjects a page draws, with their BBox, in the order placed.
function forms(doc: PDFDocument, pageIndex: number) {
  const page = doc.getPage(pageIndex);
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return [];
  return xobjects.entries().map(([, ref]) => {
    const stream = doc.context.lookup(ref, PDFStream);
    return stream.dict
      .lookup(PDFName.of("BBox"), PDFArray)
      .asArray()
      .map((n) => (n as PDFNumber).asNumber());
  });
}

// A page's content stream as text, for checking where each slot landed.
function content(doc: PDFDocument, pageIndex: number) {
  const contents = doc.getPage(pageIndex).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const stream = doc.context.lookup(ref) as PDFRawStream;
      return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    })
    .join("\n");
}

// A 4×6 thermal label, portrait unless told otherwise.
async function thermal(name: string, landscape = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage(landscape ? [432, 288] : [288, 432]);
  page.drawRectangle({ x: 20, y: 20, width: 100, height: 40, color: rgb(0, 0, 0) });
  return { name, bytes: await doc.save() };
}

test("sheetCount pairs labels, with an optional empty first slot; thermal is one per page", () => {
  assert.equal(sheetCount(1), 1);
  assert.equal(sheetCount(2), 1);
  assert.equal(sheetCount(3), 2);
  assert.equal(sheetCount(2, true), 2);
  assert.equal(sheetCount(1, true), 1);
  assert.equal(sheetCount(3, true, "thermal"), 3);
});

test("layout is detected from the page sizes; mixed batches and odd sizes are refused", async () => {
  assert.equal(await detectLayout([await thermal("a.pdf"), await thermal("b.pdf", true)]), "thermal");
  assert.equal(await detectLayout([await label("a.pdf")]), "half-sheet");
  assert.throws(
    () => layoutOfSizes([{ name: "a", width: 288, height: 432 }, { name: "b.pdf", width: 612, height: 792 }]),
    /Mixed label formats — b\.pdf is 8\.5×11\.0 in/
  );
  assert.throws(
    () => layoutOfSizes([{ name: "odd.pdf", width: 300, height: 300 }]),
    /odd\.pdf is 4\.2×4\.2 in — not a 4×6 label or a letter page/
  );
});

test("thermal: pages copied as-is in order, landscape turned upright", async () => {
  const bytes = await combineLabels([
    await thermal("a.pdf"),
    await thermal("b.pdf", true),
    await thermal("c.pdf"),
  ]);
  const doc = await load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const [a, b, c] = doc.getPages();
  assert.deepEqual(a.getSize(), { width: THERMAL.width, height: THERMAL.height });
  assert.equal(a.getRotation().angle, 0);
  assert.deepEqual(b.getSize(), { width: THERMAL.height, height: THERMAL.width });
  assert.equal(b.getRotation().angle, 90);
  assert.equal(c.getRotation().angle, 0);
});

test("asking for the other layout is refused with the fix", async () => {
  await assert.rejects(
    combineLabels([await label("a.pdf")], { layout: "thermal" }),
    /set PayPal's label format to 4×6/
  );
  await assert.rejects(
    combineLabels([await thermal("a.pdf")], { layout: "half-sheet" }),
    /These are 4×6 labels/
  );
});

test("three labels become two letter sheets, two-up", async () => {
  const bytes = await combineLabels([
    await label("a.pdf"),
    await label("b.pdf"),
    await label("c.pdf"),
  ]);
  const doc = await load(bytes);
  assert.equal(doc.getPageCount(), 2);
  for (const page of doc.getPages()) {
    assert.deepEqual(page.getSize(), { width: LETTER.width, height: LETTER.height });
  }
  // Every placed form is clipped to the top half of its source.
  assert.deepEqual(forms(doc, 0), [
    [0, HALF, LETTER.width, LETTER.height],
    [0, HALF, LETTER.width, LETTER.height],
  ]);
  assert.deepEqual(forms(doc, 1), [[0, HALF, LETTER.width, LETTER.height]]);
  // Slot A sits at the fold, slot B at the page origin.
  const text = content(doc, 0);
  assert.match(text, /1 0 0 1 0 396 cm/);
  assert.match(text, /1 0 0 1 0 0 cm/);
});

test("startOnBottom leaves the first top slot empty", async () => {
  const bytes = await combineLabels(
    [await label("a.pdf"), await label("b.pdf")],
    { startOnBottom: true }
  );
  const doc = await load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(forms(doc, 0).length, 1);
  assert.equal(forms(doc, 1).length, 1);
  const text = content(doc, 0);
  assert.match(text, /1 0 0 1 0 0 cm/);
  assert.doesNotMatch(text, /1 0 0 1 0 396 cm/);
});

test("every page of a multi-page source counts as a label", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    doc.addPage([612, 792]).drawRectangle({ x: 90, y: 450, width: 432, height: 288 });
  }
  const bytes = await combineLabels([{ name: "three.pdf", bytes: await doc.save() }]);
  assert.equal((await load(bytes)).getPageCount(), 2);
});

test("a letter batch with one 4×6 label in it is refused by name", async () => {
  await assert.rejects(
    combineLabels([await label("a.pdf"), await label("b.pdf"), await label("thermal.pdf", [288, 432])]),
    /Mixed label formats — thermal\.pdf is 4\.0×6\.0 in/
  );
});

test("garbage bytes are refused by name", async () => {
  await assert.rejects(
    combineLabels([{ name: "notes.txt", bytes: new TextEncoder().encode("hello") }]),
    /notes\.txt isn't a readable PDF/
  );
});
