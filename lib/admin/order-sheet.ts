import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OrderSheetOrder } from "./pack-list.ts";
import { fit, pdfSafe } from "./packing-slips.ts";

// Order sheet: one Letter page, two columns, of every order on the packing
// table and each record still to go into its mailer — a checkbox for the
// order and one per record, ticked at the table. Printed on the office
// printer, not the thermal. The type steps down until everything fits on
// one page; only a really big day spills onto a second.

export const LETTER = { width: 612, height: 792 } as const; // 8.5×11 in at 72pt

const MARGIN = 36;
const GUTTER = 20;
const COLUMNS = 2;
const COL_WIDTH = (LETTER.width - 2 * MARGIN - GUTTER * (COLUMNS - 1)) / COLUMNS;
const HEADER = 44; // title, count line, rule
const FOOTER = 14;
const COL_TOP = LETTER.height - MARGIN - HEADER;
const COL_HEIGHT = COL_TOP - MARGIN - FOOTER;
const SCALES = [1, 0.9, 0.8, 0.72] as const;

const INK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);

type Line =
  | { kind: "order"; order: OrderSheetOrder; cont: boolean }
  | { kind: "record"; record: OrderSheetOrder["records"][number] };

type Placed = { line: Line; page: number; col: number; y: number }; // y: top of the line

const heights = (s: number) => ({ order: 15 * s, record: 12 * s, gap: 7 * s });

// Flow the orders down the columns. An order moves whole to the next
// column when it doesn't fit what's left of this one; only an order
// taller than a whole column splits, with a "(cont.)" heading.
export function layoutOrderSheet(orders: OrderSheetOrder[], scale: number) {
  const h = heights(scale);
  const placed: Placed[] = [];
  let page = 0;
  let col = 0;
  let used = 0;
  const advance = () => {
    col++;
    if (col === COLUMNS) {
      col = 0;
      page++;
    }
    used = 0;
  };
  const put = (line: Line, height: number) => {
    placed.push({ line, page, col, y: COL_TOP - used });
    used += height;
  };
  for (const order of orders) {
    if (used > 0) used += h.gap;
    const block = h.order + order.records.length * h.record;
    if (used + block > COL_HEIGHT && block <= COL_HEIGHT) advance();
    if (used + h.order + h.record > COL_HEIGHT) advance();
    put({ kind: "order", order, cont: false }, h.order);
    for (const record of order.records) {
      if (used + h.record > COL_HEIGHT) {
        advance();
        put({ kind: "order", order, cont: true }, h.order);
      }
      put({ kind: "record", record }, h.record);
    }
  }
  return { placed, pages: page + 1 };
}

// The largest type that fits on one page, else the smallest over as many
// pages as it takes.
export function fitOrderSheet(orders: OrderSheetOrder[]) {
  for (const scale of SCALES) {
    const layout = layoutOrderSheet(orders, scale);
    if (layout.pages === 1) return { scale, ...layout };
  }
  const scale = SCALES[SCALES.length - 1];
  return { scale, ...layoutOrderSheet(orders, scale) };
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
  printedAt: Date = new Date()
): Promise<Uint8Array> {
  if (orders.length === 0) throw new Error("No orders to print a sheet for.");
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const { scale, placed, pages } = fitOrderSheet(orders);
  const h = heights(scale);

  const recordCount = orders.reduce((n, o) => n + o.records.length, 0);
  const date = printedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const pdfPages = Array.from({ length: pages }, (_, p) => {
    const page = doc.addPage([LETTER.width, LETTER.height]);
    let y = LETTER.height - MARGIN - 18;
    page.drawText("PACKING SHEET", { x: MARGIN, y, size: 18, font: bold, color: INK });
    rightText(
      page,
      pages > 1 ? `${date} · page ${p + 1} of ${pages}` : date,
      regular,
      10,
      LETTER.width - MARGIN,
      y + 4
    );
    y -= 14;
    page.drawText(
      pdfSafe(
        `${orders.length} order${orders.length === 1 ? "" : "s"} · ${recordCount} record${recordCount === 1 ? "" : "s"} · tick each record as it goes in the mailer, then the order`
      ),
      { x: MARGIN, y, size: 9, font: regular, color: GREY }
    );
    y -= 7;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: LETTER.width - MARGIN, y },
      thickness: 0.75,
      color: INK,
    });
    page.drawText("Curiouser Records · Phoenix, AZ", {
      x: MARGIN,
      y: MARGIN - 4,
      size: 7,
      font: regular,
      color: GREY,
    });
    return page;
  });

  for (const { line, page: p, col, y: top } of placed) {
    const page = pdfPages[p];
    const x = MARGIN + col * (COL_WIDTH + GUTTER);
    const right = x + COL_WIDTH;
    if (line.kind === "order") {
      const size = 10.5 * scale;
      const baseline = top - size;
      const o = line.order;
      const box = 9 * scale;
      checkbox(page, x, baseline, box, size);
      const tail = line.cont
        ? "(cont.)"
        : `${o.records.length} rec${o.records.length === 1 ? "" : "s"}`;
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
      const tail = [r.boxId != null ? `Box #${r.boxId}` : "", `${r.media}/${r.sleeve}`]
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
