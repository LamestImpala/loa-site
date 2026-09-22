import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OrderSheetOrder } from "./pack-list.ts";
import { fit, pdfSafe, THERMAL } from "./packing-slips.ts";

// Order sheet: every paid order not yet dropped off and each of its
// records — a checkbox for the order and one per record, ticked at the
// table. Two page shapes: one Letter page in two columns for the office
// printer, or 4×6 labels in one column for the thermal. The type steps
// down until everything fits on one page, but never below the sheet's
// smallest scale — past that it continues onto more pages.

export const LETTER = { width: 612, height: 792 } as const; // 8.5×11 in at 72pt

export type SheetGeometry = {
  width: number;
  height: number;
  margin: number;
  columns: number;
  gutter: number;
  header: number; // title, count line, rule
  footer: number;
  titleSize: number;
  hint: boolean; // the "tick each record…" line under the title
  scales: readonly number[]; // largest first; the last is the floor
};

export const LETTER_SHEET: SheetGeometry = {
  ...LETTER,
  margin: 36,
  columns: 2,
  gutter: 20,
  header: 44,
  footer: 14,
  titleSize: 18,
  hint: true,
  scales: [1, 0.9, 0.8, 0.72],
};

// Record text bottoms out at 0.8 × 8.5 = 6.8pt — sharp at 203 dpi.
export const THERMAL_SHEET: SheetGeometry = {
  ...THERMAL,
  margin: 14,
  columns: 1,
  gutter: 0,
  header: 34,
  footer: 10,
  titleSize: 14,
  hint: false,
  scales: [1, 0.9, 0.8],
};

const frame = (g: SheetGeometry) => {
  const colTop = g.height - g.margin - g.header;
  return {
    colTop,
    colHeight: colTop - g.margin - g.footer,
    colWidth: (g.width - 2 * g.margin - g.gutter * (g.columns - 1)) / g.columns,
  };
};

const INK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);

type Line =
  | { kind: "order"; order: OrderSheetOrder; cont: boolean }
  | { kind: "record"; record: OrderSheetOrder["records"][number]; order: OrderSheetOrder };

// When every record of an order is in the same place (all loose, or all
// in one box), the box goes on the order's heading line and the record
// rows keep their full width for the title.
function oneBox(o: OrderSheetOrder): OrderSheetOrder["records"][number] | null {
  const [first] = o.records;
  return o.records.every((r) => r.boxId === first.boxId) ? first : null;
}

const boxLabel = (r: { boxId: number | null; labeled: boolean }) =>
  r.boxId != null ? `Box #${r.boxId}${r.labeled ? " labeled" : ""}` : "";

type Placed = { line: Line; page: number; col: number; y: number }; // y: top of the line

const heights = (s: number) => ({ order: 15 * s, record: 12 * s, gap: 7 * s });

// Flow the orders down the columns. An order moves whole to the next
// column when it doesn't fit what's left of this one; only an order
// taller than a whole column splits, with a "(cont.)" heading.
export function layoutOrderSheet(
  orders: OrderSheetOrder[],
  scale: number,
  sheet: SheetGeometry = LETTER_SHEET
) {
  const h = heights(scale);
  const { colTop, colHeight } = frame(sheet);
  const placed: Placed[] = [];
  let page = 0;
  let col = 0;
  let used = 0;
  const advance = () => {
    col++;
    if (col === sheet.columns) {
      col = 0;
      page++;
    }
    used = 0;
  };
  const put = (line: Line, height: number) => {
    placed.push({ line, page, col, y: colTop - used });
    used += height;
  };
  for (const order of orders) {
    if (used > 0) used += h.gap;
    const block = h.order + order.records.length * h.record;
    if (used + block > colHeight && block <= colHeight) advance();
    if (used + h.order + h.record > colHeight) advance();
    put({ kind: "order", order, cont: false }, h.order);
    for (const record of order.records) {
      if (used + h.record > colHeight) {
        advance();
        put({ kind: "order", order, cont: true }, h.order);
      }
      put({ kind: "record", record, order }, h.record);
    }
  }
  return { placed, pages: page + 1 };
}

// The largest type that fits on one page, else the smallest over as many
// pages as it takes.
export function fitOrderSheet(orders: OrderSheetOrder[], sheet: SheetGeometry = LETTER_SHEET) {
  for (const scale of sheet.scales) {
    const layout = layoutOrderSheet(orders, scale, sheet);
    if (layout.pages === 1) return { scale, ...layout };
  }
  const scale = sheet.scales[sheet.scales.length - 1];
  return { scale, ...layoutOrderSheet(orders, scale, sheet) };
}

function checkbox(page: PDFPage, x: number, baseline: number, side: number, size: number) {
  page.drawRectangle({
    x,
    y: baseline + (size * 0.72 - side) / 2,
    width: side,
    height: side,
    borderWidth: 0.75,
    borderColor: INK,
  });
}

function rightText(page: PDFPage, s: string, font: PDFFont, size: number, xRight: number, y: number) {
  const t = pdfSafe(s);
  page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color: GREY });
}

export async function orderSheetPdf(
  orders: OrderSheetOrder[],
  { sheet = LETTER_SHEET, printedAt = new Date() }: { sheet?: SheetGeometry; printedAt?: Date } = {}
): Promise<Uint8Array> {
  if (orders.length === 0) throw new Error("No orders to print a sheet for.");
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const { scale, placed, pages } = fitOrderSheet(orders, sheet);
  const h = heights(scale);
  const { margin, gutter } = sheet;
  const { colWidth } = frame(sheet);

  const recordCount = orders.reduce((n, o) => n + o.records.length, 0);
  const date = printedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const pdfPages = Array.from({ length: pages }, (_, p) => {
    const page = doc.addPage([sheet.width, sheet.height]);
    const small = sheet.titleSize < 18;
    let y = sheet.height - margin - sheet.titleSize;
    page.drawText("PACKING SHEET", { x: margin, y, size: sheet.titleSize, font: bold, color: INK });
    rightText(
      page,
      pages > 1 ? `${date} · ${small ? "" : "page "}${p + 1} of ${pages}` : date,
      regular,
      small ? 8 : 10,
      sheet.width - margin,
      y + (small ? 3 : 4)
    );
    y -= small ? 11 : 14;
    const counts = `${orders.length} order${orders.length === 1 ? "" : "s"} · ${recordCount} record${recordCount === 1 ? "" : "s"}`;
    page.drawText(
      pdfSafe(sheet.hint ? `${counts} · tick each record as it goes in the mailer, then the order` : counts),
      { x: margin, y, size: small ? 8 : 9, font: regular, color: GREY }
    );
    y -= small ? 5 : 7;
    page.drawLine({
      start: { x: margin, y },
      end: { x: sheet.width - margin, y },
      thickness: 0.75,
      color: INK,
    });
    page.drawText("Curiouser Records · Phoenix, AZ", {
      x: margin,
      y: margin - (small ? 7 : 4),
      size: small ? 6 : 7,
      font: regular,
      color: GREY,
    });
    return page;
  });

  for (const { line, page: p, col, y: top } of placed) {
    const page = pdfPages[p];
    const x = margin + col * (colWidth + gutter);
    const owner = line.kind === "record" ? line.order : null;
    const right = x + colWidth;
    if (line.kind === "order") {
      const size = 10.5 * scale;
      const baseline = top - size;
      const o = line.order;
      const box = 9 * scale;
      checkbox(page, x, baseline, box, size);
      const shared = oneBox(o);
      const tail = [
        shared ? boxLabel(shared) : "",
        line.cont ? "(cont.)" : `${o.records.length} rec${o.records.length === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const tailSize = 8 * scale;
      const tailWidth = regular.widthOfTextAtSize(tail, tailSize);
      const left = x + box + 5;
      const buyer = o.buyer ? `u/${o.buyer}` : "(no buyer)";
      const name = o.shipToName ? `  ${o.shipToName}` : "";
      const avail = right - tailWidth - 6 - left;
      const buyerText = fit(buyer, bold, size, avail);
      page.drawText(buyerText, { x: left, y: baseline, size, font: bold, color: INK });
      const nameX = left + bold.widthOfTextAtSize(buyerText, size);
      const nameAvail = right - tailWidth - 6 - nameX;
      if (name && nameAvail > 20)
        page.drawText(fit(name, regular, 8.5 * scale, nameAvail), {
          x: nameX,
          y: baseline,
          size: 8.5 * scale,
          font: regular,
          color: GREY,
        });
      rightText(page, tail, regular, tailSize, right, baseline);
      page.drawLine({
        start: { x, y: top - h.order + 2 * scale },
        end: { x: right, y: top - h.order + 2 * scale },
        thickness: 0.4,
        color: GREY,
      });
    } else {
      const r = line.record;
      const size = 8.5 * scale;
      const baseline = top - size - 1.5 * scale;
      const box = 7 * scale;
      const indent = x + 12 * scale;
      checkbox(page, indent, baseline, box, size);
      const tail = [owner && oneBox(owner) ? "" : boxLabel(r), `${r.media}/${r.sleeve}`]
        .filter(Boolean)
        .join(" · ");
      const tailSize = 7.5 * scale;
      const tailWidth = regular.widthOfTextAtSize(pdfSafe(tail), tailSize);
      const left = indent + box + 5;
      page.drawText(fit(`${r.artist} — ${r.title}`, regular, size, right - tailWidth - 6 - left), {
        x: left,
        y: baseline,
        size,
        font: regular,
        color: INK,
      });
      rightText(page, tail, regular, tailSize, right, baseline);
    }
  }
  return doc.save();
}
