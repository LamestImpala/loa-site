import { PDFDocument, degrees, type PDFEmbeddedPage } from "pdf-lib";

// Shipping labels come out of PayPal's Shipping Center one PDF per label,
// in whichever format its setting says:
//
//   thermal    — a 4×6 page, for the label printer. Every page is copied
//                as-is into one document, in the order given, so a batch
//                prints in box order with one print job.
//   half-sheet — a letter page with the 6×4 label drawn in the top half
//                (the old format). Two labels go on one sheet, top half of
//                each source only so nothing bleeds into the other slot,
//                at 100% so they land on half-sheet label stock.
//
// The layout is detected from the pages; a batch that mixes the two is
// refused rather than guessed at.

export const LETTER = { width: 612, height: 792 } as const;
export const HALF = LETTER.height / 2; // 396pt = 5.5in, one half-sheet label
export const THERMAL = { width: 288, height: 432 } as const; // 4×6 in

export type Layout = "thermal" | "half-sheet";
export type LabelSource = { name: string; bytes: Uint8Array | ArrayBuffer };
export type CombineOptions = {
  // Detected from the pages when omitted.
  layout?: Layout;
  // Half-sheet only: the first sheet in the tray already had its top label
  // peeled off, so leave that slot empty and start on the bottom one.
  startOnBottom?: boolean;
};

// How many sheets `labels` labels need.
export function sheetCount(labels: number, startOnBottom = false, layout: Layout = "half-sheet") {
  if (layout === "thermal") return labels;
  return Math.ceil((labels + (startOnBottom ? 1 : 0)) / 2);
}

const TOLERANCE = 2; // points — PayPal's pages are exactly the nominal size

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
const isLetter = (w: number, h: number) => near(w, LETTER.width) && near(h, LETTER.height);
const isThermalPortrait = (w: number, h: number) =>
  near(w, THERMAL.width) && near(h, THERMAL.height);
const isThermalLandscape = (w: number, h: number) =>
  near(w, THERMAL.height) && near(h, THERMAL.width);

const inches = (pt: number) => (pt / 72).toFixed(1);

type Loaded = { src: LabelSource; doc: PDFDocument };

async function loadAll(sources: LabelSource[]): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const src of sources) {
    try {
      out.push({ src, doc: await PDFDocument.load(src.bytes) });
    } catch {
      throw new Error(`${src.name} isn't a readable PDF.`);
    }
  }
  return out;
}

function pageLabel(src: LabelSource, doc: PDFDocument, i: number) {
  return doc.getPageCount() > 1 ? `${src.name} page ${i + 1}` : src.name;
}

// Thermal when every page is 4×6, half-sheet when every page is letter.
export function layoutOfSizes(
  pages: { name: string; width: number; height: number }[]
): Layout {
  if (pages.length === 0) throw new Error("No pages to combine.");
  const kinds = pages.map((p) =>
    isThermalPortrait(p.width, p.height) || isThermalLandscape(p.width, p.height)
      ? "thermal"
      : isLetter(p.width, p.height)
        ? "half-sheet"
        : null
  );
  const odd = pages[kinds.indexOf(null)];
  if (odd) {
    throw new Error(
      `${odd.name} is ${inches(odd.width)}×${inches(odd.height)} in — not a 4×6 label or a letter page.`
    );
  }
  const thermal = kinds.filter((k) => k === "thermal").length;
  if (thermal > 0 && thermal < kinds.length) {
    // Name the odd one out — on a tie, the letter page, since 4×6 is the
    // format going forward.
    const first = pages[kinds.indexOf(thermal >= kinds.length / 2 ? "half-sheet" : "thermal")];
    throw new Error(
      `Mixed label formats — ${first.name} is ${inches(first.width)}×${inches(first.height)} in while the others aren't. Combine one format at a time.`
    );
  }
  return thermal > 0 ? "thermal" : "half-sheet";
}

export async function detectLayout(sources: LabelSource[]): Promise<Layout> {
  const loaded = await loadAll(sources);
  return layoutOfSizes(
    loaded.flatMap(({ src, doc }) =>
      doc.getPages().map((p, i) => ({ name: pageLabel(src, doc, i), ...p.getSize() }))
    )
  );
}

export async function combineLabels(
  sources: LabelSource[],
  opts: CombineOptions = {}
): Promise<Uint8Array> {
  const loaded = await loadAll(sources);
  const sizes = loaded.flatMap(({ src, doc }) =>
    doc.getPages().map((p, i) => ({ name: pageLabel(src, doc, i), ...p.getSize() }))
  );
  const detected = layoutOfSizes(sizes);
  const layout = opts.layout ?? detected;
  if (layout !== detected) {
    throw new Error(
      layout === "thermal"
        ? `These are letter pages — set PayPal's label format to 4×6 for the thermal printer, or use the half-sheet layout.`
        : `These are 4×6 labels — print them on the thermal printer, or use the thermal layout.`
    );
  }
  return layout === "thermal" ? combineThermal(loaded) : combineHalfSheet(loaded, opts);
}

// Every page copied as-is; a landscape 6×4 is turned upright so the
// whole batch feeds the printer the same way.
async function combineThermal(loaded: Loaded[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const { doc } of loaded) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (isThermalLandscape(width, height)) {
        page.setRotation(degrees((page.getRotation().angle + 90) % 360));
      }
      out.addPage(page);
    }
  }
  return out.save();
}

async function combineHalfSheet(
  loaded: Loaded[],
  opts: CombineOptions
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const labels: PDFEmbeddedPage[] = [];
  for (const { doc } of loaded) {
    for (const page of doc.getPages()) {
      // Top half only. pdf-lib shifts the box to the origin, so the
      // embedded page is 612×396 with the label where it was.
      labels.push(
        await out.embedPage(page, {
          left: 0,
          bottom: HALF,
          right: LETTER.width,
          top: LETTER.height,
        })
      );
    }
  }
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
