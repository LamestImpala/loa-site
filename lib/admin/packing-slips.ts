import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ManifestRow, PackingSlip } from "./pack-list.ts";

// Packing slips: one 4×6 page per sealed box, for the thermal label
// printer at the packing table. The slip is the box's tag until the
// shipping label exists — Box # big at the top, who it's for, what's in
// it — and goes in the mailer. Prints at 100% on 4×6 stock.
//
// The ship manifest below is the other 4×6: one checklist of every box
// on the table, ticked as each label goes on.

export const THERMAL = { width: 288, height: 432 } as const; // 4×6 in at 72pt

const MARGIN = 18;
const INK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);
const WIDTH = THERMAL.width - 2 * MARGIN;

// The standard fonts only encode WinAnsi; pdf-lib throws on anything
// else. Fold accents where possible and replace the rest, so a title in
// another script prints as "?" rather than failing the whole sheet.
const WIN_ANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("")
);
export function pdfSafe(text: string): string {
  return [...text.normalize("NFC")]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x20 && code <= 0x7e) return ch;
      if (/\s/.test(ch)) return " ";
      if (code > 0xa0 && code <= 0xff) return ch;
      if (WIN_ANSI_EXTRA.has(ch)) return ch;
      const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const foldedCode = folded.codePointAt(0) ?? 0;
      if (folded.length === 1 && foldedCode >= 0x20 && foldedCode <= 0x7e) return folded;
      if (/\s/.test(ch)) return " ";
      return "?";
    })
    .join("");
}

// Greedy word wrap at a width, in points, for one font size.
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// One line, cut with an ellipsis rather than wrapped, for rows that
// must stay one line tall.
export function fit(text: string, font: PDFFont, size: number, width: number): string {
  let s = pdfSafe(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// Top-down text cursor over one page: each call draws below the last.
function cursor(page: PDFPage) {
  let y = THERMAL.height - MARGIN;
  const text = (
    s: string,
    size: number,
    font: PDFFont,
    opts: { color?: ReturnType<typeof rgb>; x?: number } = {}
  ) => {
    y -= size;
    page.drawText(pdfSafe(s), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font,
      color: opts.color ?? INK,
    });
  };
  const para = (s: string, size: number, font: PDFFont, color = INK) => {
    for (const line of wrap(s, font, size, WIDTH)) {
      text(line, size, font, { color });
      y -= 2;
    }
  };
  const right = (s: string, size: number, font: PDFFont, atY: number, color = GREY) =>
    page.drawText(pdfSafe(s), {
      x: THERMAL.width - MARGIN - font.widthOfTextAtSize(pdfSafe(s), size),
      y: atY,
      size,
      font,
      color,
    });
  const rule = () => {
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: THERMAL.width - MARGIN, y },
      thickness: 0.75,
      color: INK,
    });
    y -= 6;
  };
  const footer = (s: string, font: PDFFont) =>
    page.drawText(pdfSafe(s), { x: MARGIN, y: MARGIN - 6, size: 7, font, color: GREY });
  return {
    get y() {
      return y;
    },
    set y(v: number) {
      y = v;
    },
    text,
    para,
    right,
    rule,
    footer,
  };
}

const place = (shipTo: PackingSlip["shipTo"]) =>
  [shipTo?.city, shipTo?.state, shipTo?.postal_code]
    .filter(Boolean)
    .join(", ")
    .replace(/, (\d)/, " $1");

export async function packingSlips(slips: PackingSlip[]): Promise<Uint8Array> {
  if (slips.length === 0) throw new Error("No boxes to print slips for.");
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  for (const slip of slips) {
    const page = doc.addPage([THERMAL.width, THERMAL.height]);
    const c = cursor(page);

    // Box number, with "n of m" beside it when the order spans boxes.
    c.text(`BOX #${slip.boxId}`, 30, bold);
    if (slip.boxCount > 1) c.right(`${slip.boxIndex} of ${slip.boxCount}`, 12, regular, c.y + 8);
    c.y -= 8;
    c.para(slip.buyer ? `u/${slip.buyer}` : "(no buyer)", 14, bold);
    if (slip.shipTo?.name) c.para(slip.shipTo.name, 12, regular);
    const where = place(slip.shipTo);
    if (where) c.para(where, 10, regular, GREY);
    if (!slip.shipTo?.name) c.para("no address on file", 10, regular, GREY);

    c.rule();

    const n = slip.records.length;
    c.para(`${n} record${n === 1 ? "" : "s"}`, 9, regular, GREY);
    c.y -= 2;
    slip.records.forEach((r, i) => {
      c.para(`${i + 1}. ${r.artist} — ${r.title}`, 11, bold);
      const detail = [r.pressing, `${r.media} / ${r.sleeve}`].filter(Boolean).join(" · ");
      c.para(detail, 8, regular, GREY);
      c.y -= 3;
    });

    const packed = slip.packedAt
      ? ` · packed ${new Date(slip.packedAt).toLocaleDateString("en-US")}`
      : "";
    c.footer(`Curiouser Records · Phoenix, AZ${packed}`, regular);
  }
  return doc.save();
}

// Ship manifest: one 4×6 checklist of every package still open on the
// fulfillment board, in the same Box # order as the slips and the label
// sheet. Each row is a checkbox, the Box # (or "No box" for an order
// whose records aren't boxed in the app), the buyer, the record count,
// "n of m" for an order that spans boxes and the tracking's last four
// once a label exists, then the ship-to name and place — the name is
// what the PayPal label prints, so the box and its label match by eye.
// Ticked as each package is ready to go. Continues onto more pages.

const ROW = 28; // points per box row: 11pt line, 8pt line, gap
const BOX = 9; // checkbox side
const HEADER = 30 + 6 + 9 + 12 + 4; // title, gap, count line, rule, breathing room
const FOOTER = MARGIN + 6;
export const MANIFEST_ROWS_PER_PAGE = Math.floor(
  (THERMAL.height - MARGIN - HEADER - FOOTER) / ROW
);

export async function shipManifest(
  rows: ManifestRow[],
  printedAt: Date = new Date()
): Promise<Uint8Array> {
  if (rows.length === 0) throw new Error("No packages to print a manifest for.");
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const pages: ManifestRow[][] = [];
  for (let i = 0; i < rows.length; i += MANIFEST_ROWS_PER_PAGE)
    pages.push(rows.slice(i, i + MANIFEST_ROWS_PER_PAGE));
  const boxes = rows.length;
  const records = rows.reduce((n, r) => n + r.records, 0);
  const date = printedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  pages.forEach((pageRows, p) => {
    const page = doc.addPage([THERMAL.width, THERMAL.height]);
    const c = cursor(page);

    c.text("SHIP DAY", 20, bold);
    c.right(pages.length > 1 ? `${date} · page ${p + 1} of ${pages.length}` : date, 9, regular, c.y + 4);
    c.y -= 6;
    c.text(
      `${boxes} package${boxes === 1 ? "" : "s"} · ${records} record${records === 1 ? "" : "s"} · tick as each is ready to go`,
      9,
      regular,
      { color: GREY }
    );
    c.rule();
    c.y -= 4;

    for (const r of pageRows) {
      const top = c.y;
      // Checkbox, centred on the first line.
      page.drawRectangle({
        x: MARGIN,
        y: top - 11 + (11 - BOX) / 2,
        width: BOX,
        height: BOX,
        borderWidth: 0.75,
        borderColor: INK,
      });
      const left = MARGIN + BOX + 7;
      const n = r.records;
      const tail = [
        `${n} rec${n === 1 ? "" : "s"}`,
        r.boxCount > 1 ? `${r.boxIndex} of ${r.boxCount}` : "",
        r.boxId == null ? "not boxed" : r.tracking ? `…${r.tracking.slice(-4)}` : "no label",
      ]
        .filter(Boolean)
        .join(" · ");
      const tailWidth = regular.widthOfTextAtSize(pdfSafe(tail), 9);
      const head = r.boxId == null ? "No box" : `Box #${r.boxId}`;
      c.text(head, 11, bold, { x: left, color: r.boxId == null ? GREY : INK });
      const buyerX = left + bold.widthOfTextAtSize(head, 11) + 8;
      const buyerWidth = THERMAL.width - MARGIN - tailWidth - 6 - buyerX;
      page.drawText(fit(r.buyer ? `u/${r.buyer}` : "(no buyer)", regular, 11, buyerWidth), {
        x: buyerX,
        y: c.y,
        size: 11,
        font: regular,
        color: INK,
      });
      c.right(tail, 9, regular, c.y + 1);
      c.y -= 3;
      const who = [r.shipTo?.name, place(r.shipTo)].filter(Boolean).join(" · ") || "no address on file";
      c.text(fit(who, regular, 8, THERMAL.width - MARGIN - left), 8, regular, { x: left, color: GREY });
      c.y = top - ROW;
    }

    c.footer("Curiouser Records · Phoenix, AZ", regular);
  });
  return doc.save();
}
