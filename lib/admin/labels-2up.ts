import { PDFDocument, type PDFEmbeddedPage } from "pdf-lib";

// PayPal issues one PDF per shipping label: a letter page with the 6×4
// label drawn in the top half and nothing below. Half-sheet label stock
// (two 8.5×5.5 peel labels per sheet) matches that layout, so a second
// label belongs exactly one half-sheet lower on the same page. This
// combines several label PDFs into one, two per sheet, taking only the top
// half of each source so nothing can bleed into the other slot. Everything
// stays at 100% scale — the point is that it lands on the labels.

export const LETTER = { width: 612, height: 792 } as const;
export const HALF = LETTER.height / 2; // 396pt = 5.5in, one half-sheet label

export type LabelSource = { name: string; bytes: Uint8Array | ArrayBuffer };
export type CombineOptions = {
  // The first sheet in the tray already had its top label peeled off, so
  // leave that slot empty and start on the bottom one.
  startOnBottom?: boolean;
};

// How many sheets `labels` labels need.
export function sheetCount(labels: number, startOnBottom = false) {
  return Math.ceil((labels + (startOnBottom ? 1 : 0)) / 2);
}

const TOLERANCE = 2; // points — PayPal's pages are exactly 612×792

function isLetter(width: number, height: number) {
  return (
    Math.abs(width - LETTER.width) <= TOLERANCE &&
    Math.abs(height - LETTER.height) <= TOLERANCE
  );
}

const inches = (pt: number) => (pt / 72).toFixed(1);

export async function combineLabels(
  sources: LabelSource[],
  opts: CombineOptions = {}
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const labels: PDFEmbeddedPage[] = [];

  for (const src of sources) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(src.bytes);
    } catch {
      throw new Error(`${src.name} isn't a readable PDF.`);
    }
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const { width, height } = pages[i].getSize();
      if (!isLetter(width, height)) {
        const where = pages.length > 1 ? `${src.name} page ${i + 1}` : src.name;
        throw new Error(
          `${where} is ${inches(width)}×${inches(height)} in, not a letter page. Only PayPal's letter-size label PDFs can be combined.`
        );
      }
      // Top half only. pdf-lib shifts the box to the origin, so the
      // embedded page is 612×396 with the label where it was.
      labels.push(
        await out.embedPage(pages[i], {
          left: 0,
          bottom: HALF,
          right: LETTER.width,
          top: LETTER.height,
        })
      );
    }
  }
  if (labels.length === 0) throw new Error("No pages to combine.");

  const slots: (PDFEmbeddedPage | null)[] = opts.startOnBottom
    ? [null, ...labels]
    : labels;
  for (let i = 0; i < slots.length; i += 2) {
    const page = out.addPage([LETTER.width, LETTER.height]);
    const top = slots[i];
    const bottom = slots[i + 1];
    if (top) page.drawPage(top, { x: 0, y: HALF });
    if (bottom) page.drawPage(bottom, { x: 0, y: 0 });
  }
  return out.save();
}
