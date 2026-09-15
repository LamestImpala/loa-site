import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { PackingSlip } from "./pack-list.ts";

// Packing slips: one 4×6 page per sealed box, for the thermal label
// printer at the packing table. The slip is the box's tag until the
// shipping label exists — Box # big at the top, who it's for, what's in
// it — and goes in the mailer. Prints at 100% on 4×6 stock.

export const THERMAL = { width: 288, height: 432 } as const; // 4×6 in at 72pt

const MARGIN = 18;
const INK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);

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

export async function packingSlips(slips: PackingSlip[]): Promise<Uint8Array> {
  if (slips.length === 0) throw new Error("No boxes to print slips for.");
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const width = THERMAL.width - 2 * MARGIN;

  for (const slip of slips) {
    const page = doc.addPage([THERMAL.width, THERMAL.height]);
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
      for (const line of wrap(s, font, size, width)) {
        text(line, size, font, { color });
        y -= 2;
      }
    };

    // Box number, with "n of m" beside it when the order spans boxes.
    const heading = `BOX #${slip.boxId}`;
    text(heading, 30, bold);
    if (slip.boxCount > 1) {
      const tag = `${slip.boxIndex} of ${slip.boxCount}`;
      page.drawText(tag, {
        x: THERMAL.width - MARGIN - regular.widthOfTextAtSize(tag, 12),
        y: y + 8,
        size: 12,
        font: regular,
        color: GREY,
      });
    }
    y -= 8;
    para(slip.buyer ? `u/${slip.buyer}` : "(no buyer)", 14, bold);
    if (slip.shipTo?.name) para(slip.shipTo.name, 12, regular);
    const place = [slip.shipTo?.city, slip.shipTo?.state, slip.shipTo?.postal_code]
      .filter(Boolean)
      .join(", ")
      .replace(/, (\d)/, " $1");
    if (place) para(place, 10, regular, GREY);
    if (!slip.shipTo?.name) para("no address on file", 10, regular, GREY);

    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: THERMAL.width - MARGIN, y },
      thickness: 0.75,
      color: INK,
    });
    y -= 6;

    const n = slip.records.length;
    para(`${n} record${n === 1 ? "" : "s"}`, 9, regular, GREY);
    y -= 2;
    slip.records.forEach((r, i) => {
      para(`${i + 1}. ${r.artist} — ${r.title}`, 11, bold);
      const detail = [r.pressing, `${r.media} / ${r.sleeve}`].filter(Boolean).join(" · ");
      para(detail, 8, regular, GREY);
      y -= 3;
    });

    const packed = slip.packedAt
      ? ` · packed ${new Date(slip.packedAt).toLocaleDateString("en-US")}`
      : "";
    page.drawText(pdfSafe(`Curiouser Records · Phoenix, AZ${packed}`), {
      x: MARGIN,
      y: MARGIN - 6,
      size: 7,
      font: regular,
      color: GREY,
    });
  }
  return doc.save();
}
